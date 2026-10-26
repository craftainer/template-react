"""Tests for ``template_sync.py`` and the executable bits CI relies on.

Stdlib ``unittest`` only (see this directory's README); run with
``python3 -m unittest discover -s .github/scripts -p 'test_*.py'`` -- the
``scripts-tests`` prek hook does exactly that.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import template_sync
import template_sync_manifest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = Path(__file__).resolve().parent


def is_exec(path: Path) -> bool:
    # The mode bits, not os.access(): some bind-mounted filesystems report
    # every file as executable to os.access().
    """Whether the owner-execute bit is set on ``path``."""
    return bool(path.stat().st_mode & stat.S_IXUSR)


def write(path: Path, content: bytes, mode: int) -> None:
    """Write ``content`` to ``path`` (creating parents) and set its mode."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    path.chmod(mode)


class ApplyReplaceExecutableBitTest(unittest.TestCase):
    """``template_sync.apply_replace`` keeps the executable bit in step with the template."""

    def setUp(self) -> None:
        """Create a template and an instance directory in a temp dir."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.old, self.new, self.instance = root / "old", root / "new", root / "instance"

    def apply(self, path: str) -> dict[str, list[str]]:
        """Run ``template_sync``'s replace step for ``path`` and return what it reports."""
        return template_sync.apply_replace(self.old, self.new, self.instance, {path})

    def test_same_content_gains_executable_bit(self) -> None:
        """Same content, template executable: the instance copy becomes executable."""
        # Regression: a template fix of 644 -> 755 with no content change.
        write(self.old / "s.sh", b"#!/bin/sh\n", 0o644)
        write(self.new / "s.sh", b"#!/bin/sh\n", 0o755)
        write(self.instance / "s.sh", b"#!/bin/sh\n", 0o644)
        result = self.apply("s.sh")
        self.assertEqual(result["updated"], ["s.sh"])
        self.assertEqual(stat.S_IMODE((self.instance / "s.sh").stat().st_mode), 0o755)

    def test_same_content_loses_executable_bit(self) -> None:
        """Same content, template not executable: the instance copy loses the bit."""
        write(self.old / "s.sh", b"x\n", 0o755)
        write(self.new / "s.sh", b"x\n", 0o644)
        write(self.instance / "s.sh", b"x\n", 0o755)
        self.assertEqual(self.apply("s.sh")["updated"], ["s.sh"])
        self.assertFalse(is_exec(self.instance / "s.sh"))

    def test_identical_content_and_mode_is_not_reported(self) -> None:
        """Identical content and mode is not reported as a change."""
        for root in (self.old, self.new, self.instance):
            write(root / "s.sh", b"x\n", 0o755)
        self.assertEqual(self.apply("s.sh"), {"updated": [], "removed": []})

    def test_changed_content_copies_the_executable_bit(self) -> None:
        """Changed content brings the template's executable bit along."""
        write(self.old / "s.sh", b"a\n", 0o644)
        write(self.new / "s.sh", b"b\n", 0o755)
        write(self.instance / "s.sh", b"a\n", 0o644)
        self.assertEqual(self.apply("s.sh")["updated"], ["s.sh"])
        self.assertEqual((self.instance / "s.sh").read_bytes(), b"b\n")
        self.assertTrue(is_exec(self.instance / "s.sh"))

    def test_new_file_keeps_the_executable_bit(self) -> None:
        """A new file keeps the template's executable bit."""
        write(self.new / "s.sh", b"x\n", 0o755)
        self.instance.mkdir()
        self.assertEqual(self.apply("s.sh")["updated"], ["s.sh"])
        self.assertTrue(is_exec(self.instance / "s.sh"))

    def test_symlinked_destination_is_not_chmodded_through(self) -> None:
        """A symlinked destination is left alone: chmod would change its target."""
        write(self.old / "s.sh", b"x\n", 0o644)
        write(self.new / "s.sh", b"x\n", 0o755)
        target = self.instance / "target.sh"
        write(target, b"x\n", 0o644)
        (self.instance / "s.sh").symlink_to(target)
        self.assertEqual(self.apply("s.sh"), {"updated": [], "removed": []})
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)

    def test_symlinked_destination_is_not_overwritten_through(self) -> None:
        """Changed content never writes through a symlinked destination."""
        write(self.old / "s.sh", b"a\n", 0o644)
        write(self.new / "s.sh", b"b\n", 0o644)
        target = self.instance / "target.sh"
        write(target, b"a\n", 0o644)
        (self.instance / "s.sh").symlink_to(target)
        self.assertEqual(self.apply("s.sh"), {"updated": [], "removed": []})
        self.assertEqual(target.read_bytes(), b"a\n")

    def test_symlinked_destination_is_not_removed(self) -> None:
        """A file removed upstream is not deleted when the instance links it elsewhere."""
        write(self.old / "s.sh", b"x\n", 0o644)
        target = self.instance / "target.sh"
        write(target, b"x\n", 0o644)
        (self.instance / "s.sh").symlink_to(target)
        self.assertEqual(self.apply("s.sh"), {"updated": [], "removed": []})
        self.assertTrue((self.instance / "s.sh").is_symlink())
        self.assertTrue(target.exists())

    def test_removed_upstream_regular_file_is_removed(self) -> None:
        """The plain removal path still deletes the instance's copy."""
        write(self.old / "s.sh", b"x\n", 0o644)
        write(self.instance / "s.sh", b"x\n", 0o644)
        self.assertEqual(self.apply("s.sh"), {"updated": [], "removed": ["s.sh"]})
        self.assertFalse((self.instance / "s.sh").exists())


class TierPathsGlobTest(unittest.TestCase):
    """``template_sync.tier_paths`` expands glob entries in every tier."""

    def setUp(self) -> None:
        """Create a template checkout with files for each tier."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for rel in (
            "scripts/release-a.sh",
            "scripts/release-b.sh",
            "scripts/other.sh",
            "docs/adrs/0001-x.md",
            "docs/adrs/README.md",
            "cfg/one.json",
            "cfg/sub/two.json",
            ".git/config",
        ):
            write(self.root / rel, b"x\n", 0o644)

    def paths(self, tier: str, patterns: list[str]) -> set[str]:
        """Return ``tier_paths`` for a manifest holding ``patterns`` in ``tier``."""
        tiers: dict[str, list[str]] = {"replace": [], "ignore": [], "merge": []}
        tiers[tier] = patterns
        return template_sync.tier_paths(self.root, tiers, tier)

    def test_glob_in_each_tier(self) -> None:
        """A glob entry expands to its files whichever tier it is in."""
        for tier in ("replace", "merge", "ignore"):
            self.assertEqual(
                self.paths(tier, ["scripts/release-*.sh"]),
                {"scripts/release-a.sh", "scripts/release-b.sh"},
                tier,
            )

    def test_star_spans_directories_like_the_manifest(self) -> None:
        """``*`` crosses ``/`` exactly as ``template_sync_manifest.matches`` does."""
        self.assertEqual(
            self.paths("replace", ["cfg/*.json"]), {"cfg/one.json", "cfg/sub/two.json"}
        )

    def test_bracket_glob(self) -> None:
        """Character classes alongside ``*`` work (``docs/adrs/[0-9]*.md``)."""
        self.assertEqual(self.paths("merge", ["docs/adrs/[0-9]*.md"]), {"docs/adrs/0001-x.md"})

    def test_several_globs_walk_the_tree_once(self) -> None:
        """Each glob is matched against one shared listing, not its own walk."""
        with mock.patch.object(
            template_sync, "relative_files", wraps=template_sync.relative_files
        ) as walk:
            found = self.paths(
                "replace", ["scripts/release-*.sh", "cfg/*.json", "docs/adrs/[0-9]*"]
            )
        self.assertEqual(walk.call_count, 1)
        self.assertEqual(len(found), 5)

    def test_literal_entries_never_walk_the_tree(self) -> None:
        """Only globs need the full listing."""
        with mock.patch.object(template_sync, "relative_files") as walk:
            self.paths("replace", ["scripts/other.sh", "cfg/"])
        walk.assert_not_called()

    def test_glob_matching_nothing(self) -> None:
        """A glob that matches nothing contributes no paths and does not fail."""
        self.assertEqual(self.paths("replace", ["scripts/nope-*.sh"]), set())

    def test_glob_never_reaches_into_dot_git(self) -> None:
        """``.git`` is never expanded into."""
        self.assertEqual(self.paths("replace", ["*config"]), set())

    def test_glob_overlapping_another_tier_is_excluded(self) -> None:
        """A path also matched by another tier is not returned (existing rule)."""
        tiers = {"replace": ["scripts/*.sh"], "ignore": ["scripts/other.sh"], "merge": []}
        self.assertEqual(
            template_sync.tier_paths(self.root, tiers, "replace"),
            {"scripts/release-a.sh", "scripts/release-b.sh"},
        )

    def test_apply_syncs_glob_entries_end_to_end(self) -> None:
        """``apply`` copies a replace-tier glob match into the instance."""
        old, instance = self.root / "old", self.root / "instance"
        old.mkdir()
        instance.mkdir()
        manifest = self.root / "manifest.yml"
        manifest.write_text("replace:\n  - scripts/release-*.sh\n")
        parser = template_sync.build_parser()
        args = parser.parse_args(
            [
                "apply",
                "--manifest",
                str(manifest),
                "--old-ref",
                str(old),
                "--new-ref",
                str(self.root),
                "--instance-root",
                str(instance),
            ]
        )
        self.assertEqual(args.func(args), 0)
        self.assertTrue((instance / "scripts/release-a.sh").is_file())
        self.assertFalse((instance / "scripts/other.sh").exists())


class InstanceSkillTierTest(unittest.TestCase):
    """A per-skill ``replace`` entry leaves room for an instance's own skill."""

    def test_base_and_instance_skills_each_match_one_tier(self) -> None:
        """Base skill dirs match only replace, the instance's only ignore."""
        tiers = {
            "replace": [".claude/skills/base-skill/", ".claude/agents/base-agent.md"],
            "ignore": [".claude/skills/own-skill/", ".claude/agents/own-agent.md"],
            "merge": [".claude/README.md"],
        }
        expected = {
            ".claude/skills/base-skill/SKILL.md": ["replace"],
            ".claude/skills/base-skill/references/x.md": ["replace"],
            ".claude/skills/own-skill/SKILL.md": ["ignore"],
            ".claude/skills/own-skill/references/x.md": ["ignore"],
            ".claude/agents/base-agent.md": ["replace"],
            ".claude/agents/own-agent.md": ["ignore"],
            ".claude/README.md": ["merge"],
        }
        for path, tier in expected.items():
            self.assertEqual(template_sync_manifest.classify(path, tiers), tier, path)

    def test_whole_directory_replace_overlaps_an_instance_skill(self) -> None:
        """The old ``.claude/skills/`` entry is why this layout is needed."""
        tiers = {
            "replace": [".claude/skills/"],
            "ignore": [".claude/skills/own-skill/"],
            "merge": [],
        }
        self.assertEqual(
            template_sync_manifest.classify(".claude/skills/own-skill/SKILL.md", tiers),
            ["replace", "ignore"],
        )

    def unlisted_skills_and_agents(self, root: Path) -> list[str]:
        """Return the skills/agents under ``root`` that are neither ignored nor listed in ``replace``.

        Also asserts the manifest has no whole-directory ``.claude/skills/`` or
        ``.claude/agents/`` entry. Anything the merged tiers (base manifest plus
        an instance's local ``ignore`` file) classify as ``ignore`` is an
        instance's own and is skipped.
        """
        manifest = root / ".github/template-sync-manifest.yml"
        tiers, errors = template_sync_manifest.load_tiers(manifest)
        self.assertEqual(errors, [])
        replace = tiers["replace"]
        self.assertNotIn(".claude/skills/", replace)
        self.assertNotIn(".claude/agents/", replace)
        missing = []
        for skill in sorted((root / ".claude/skills").iterdir()):
            if not skill.is_dir():
                continue
            entry = f".claude/skills/{skill.name}/"
            if "ignore" in template_sync_manifest.classify(f"{entry}SKILL.md", tiers):
                continue
            if entry not in replace:
                missing.append(entry)
        for agent in sorted((root / ".claude/agents").glob("*.md")):
            entry = f".claude/agents/{agent.name}"
            if "ignore" in template_sync_manifest.classify(entry, tiers):
                continue
            if entry not in replace:
                missing.append(entry)
        return missing

    def test_base_manifest_lists_skills_individually(self) -> None:
        """Base's manifest keeps every skill/agent separate, leaving room for an instance's."""
        self.assertEqual(self.unlisted_skills_and_agents(REPO_ROOT), [])

    def make_layout(self, root: Path, local_ignore: list[str]) -> None:
        """Write a repo with one listed skill/agent and one unlisted skill/agent."""
        (root / ".github").mkdir()
        (root / ".github/template-sync-manifest.yml").write_text(
            "replace:\n  - .claude/skills/base-skill/\n  - .claude/agents/base-agent.md\n"
        )
        if local_ignore:
            lines = "".join(f"  - {entry}\n" for entry in local_ignore)
            (root / ".github" / template_sync_manifest.LOCAL_MANIFEST_NAME).write_text(
                f"ignore:\n{lines}"
            )
        for name in ("base-skill", "extra-skill"):
            (root / ".claude/skills" / name).mkdir(parents=True)
            (root / ".claude/skills" / name / "SKILL.md").write_text(name)
        (root / ".claude/agents").mkdir(parents=True, exist_ok=True)
        for name in ("base-agent", "extra-agent"):
            (root / f".claude/agents/{name}.md").write_text(name)

    def test_guard_skips_ignored_instance_skill_and_agent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_layout(root, [".claude/skills/extra-skill/", ".claude/agents/extra-agent.md"])
            self.assertEqual(self.unlisted_skills_and_agents(root), [])

    def test_guard_catches_unlisted_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_layout(root, [".claude/agents/extra-agent.md"])
            self.assertEqual(self.unlisted_skills_and_agents(root), [".claude/skills/extra-skill/"])

    def test_guard_catches_unlisted_agent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_layout(root, [".claude/skills/extra-skill/"])
            self.assertEqual(
                self.unlisted_skills_and_agents(root), [".claude/agents/extra-agent.md"]
            )

    def test_apply_removes_tombstoned_skill_and_spares_instance_skill(self) -> None:
        """A deleted base skill's kept ``replace`` line lets sync remove it from instances."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old, new, instance = root / "old", root / "new", root / "instance"
            files = {
                old: {"gone": "old gone", "kept": "old kept"},
                new: {"kept": "new kept"},
                instance: {"gone": "old gone", "kept": "old kept", "mine": "mine"},
            }
            for base, skills in files.items():
                for name, text in skills.items():
                    f = base / ".claude/skills" / name / "SKILL.md"
                    f.parent.mkdir(parents=True)
                    f.write_text(text)
            manifest = root / "manifest.yml"
            manifest.write_text("replace:\n  - .claude/skills/gone/\n  - .claude/skills/kept/\n")
            args = template_sync.build_parser().parse_args(
                [
                    "apply",
                    "--manifest",
                    str(manifest),
                    "--old-ref",
                    str(old),
                    "--new-ref",
                    str(new),
                    "--instance-root",
                    str(instance),
                ]
            )
            self.assertEqual(args.func(args), 0)
            skills = instance / ".claude/skills"
            self.assertFalse((skills / "gone/SKILL.md").exists())
            self.assertEqual((skills / "kept/SKILL.md").read_text(), "new kept")
            self.assertEqual((skills / "mine/SKILL.md").read_text(), "mine")


class ApplyMergeTest(unittest.TestCase):
    """``template_sync.apply_merge`` reports only real changes and leaves links alone."""

    def setUp(self) -> None:
        """Create old/new template checkouts and an instance in a temp dir."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.old, self.new, self.instance = (self.root / n for n in ("old", "new", "instance"))
        write(self.old / "m.txt", b"a\nb\nc\n", 0o644)
        write(self.new / "m.txt", b"a\nB\nc\n", 0o644)
        write(self.instance / "m.txt", b"a\nb\nc\nd\n", 0o644)

    def apply(self) -> dict[str, list[str]]:
        """Run the merge step for ``m.txt``."""
        return template_sync.apply_merge(self.old, self.new, self.instance, {"m.txt"})

    def test_second_run_changes_and_reports_nothing(self) -> None:
        """Re-running the same old->new sync leaves the tree alone and lists no files."""
        # Regression: a re-run reported every merge-tier file as "merged" again.
        self.assertEqual(self.apply(), {"merged": ["m.txt"], "conflicts": [], "binary": []})
        merged = (self.instance / "m.txt").read_bytes()
        self.assertEqual(merged, b"a\nB\nc\nd\n")
        self.assertEqual(self.apply(), {"merged": [], "conflicts": [], "binary": []})
        self.assertEqual((self.instance / "m.txt").read_bytes(), merged)

    def test_instance_already_equal_to_new_is_not_reported(self) -> None:
        """A file the instance already has at the new version is not "merged"."""
        write(self.instance / "m.txt", b"a\nB\nc\n", 0o644)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": [], "binary": []})

    def test_untouched_instance_file_keeps_its_other_mode_bits(self) -> None:
        """Taking the new version outright rewrites content, not the instance's mode."""
        # Regression: copy2 copied the template's whole mode over the instance file's.
        write(self.instance / "m.txt", b"a\nb\nc\n", 0o664)
        self.assertEqual(self.apply()["merged"], ["m.txt"])
        self.assertEqual((self.instance / "m.txt").read_bytes(), b"a\nB\nc\n")
        self.assertEqual(stat.S_IMODE((self.instance / "m.txt").stat().st_mode), 0o664)

    def test_untouched_instance_file_gains_the_upstream_executable_bit(self) -> None:
        """Like the replace tier, an upstream 644 -> 755 change reaches an untouched file."""
        write(self.new / "m.txt", b"a\nB\nc\n", 0o755)
        write(self.instance / "m.txt", b"a\nb\nc\n", 0o664)
        self.assertEqual(self.apply()["merged"], ["m.txt"])
        self.assertEqual(stat.S_IMODE((self.instance / "m.txt").stat().st_mode), 0o775)

    def test_merged_file_keeps_its_mode_like_the_fast_path(self) -> None:
        """Both ways of updating an existing file leave its mode alone."""
        write(self.instance / "m.txt", b"a\nb\nc\nd\n", 0o755)
        self.assertEqual(self.apply()["merged"], ["m.txt"])
        self.assertEqual(stat.S_IMODE((self.instance / "m.txt").stat().st_mode), 0o755)

    def test_text_conflict_is_not_listed_as_binary(self) -> None:
        """A conflict with markers is not a binary one."""
        write(self.instance / "m.txt", b"a\nZ\nc\n", 0o644)
        result = self.apply()
        self.assertEqual(result["conflicts"], ["m.txt"])
        self.assertEqual(result["binary"], [])

    def test_symlinked_instance_file_is_not_merged_through(self) -> None:
        """Like the replace tier, a deliberately linked instance file is left alone."""
        target = self.root / "real.txt"
        target.write_bytes(b"a\nb\nc\nd\n")
        (self.instance / "m.txt").unlink()
        (self.instance / "m.txt").symlink_to(target)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": [], "binary": []})
        self.assertEqual(target.read_bytes(), b"a\nb\nc\nd\n")

    def test_dangling_symlink_is_not_written_through(self) -> None:
        """A dangling link is not "missing": copying would create its target."""
        (self.instance / "m.txt").unlink()
        dangling = self.root / "nowhere.txt"
        (self.instance / "m.txt").symlink_to(dangling)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": [], "binary": []})
        self.assertFalse(dangling.exists())


class MergeFileErrorTest(unittest.TestCase):
    """``git merge-file`` errors raise; only binary input and real conflicts report True."""

    def setUp(self) -> None:
        """Create a temp dir for the three merge inputs."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def merge(self) -> bool:
        """Run ``merge_file`` on the ours/base/theirs files."""
        root = self.root
        return template_sync.merge_file(root / "ours", root / "base", root / "theirs")

    def test_conflict_is_reported_as_true(self) -> None:
        """Overlapping edits are a conflict: True, markers written."""
        write(self.root / "base", b"a\nb\nc\n", 0o644)
        write(self.root / "theirs", b"a\nX\nc\n", 0o644)
        write(self.root / "ours", b"a\nY\nc\n", 0o644)
        self.assertTrue(self.merge())

    def test_clean_merge_is_reported_as_false(self) -> None:
        """A merge without overlapping edits is not a conflict."""
        write(self.root / "base", b"a\nb\nc\n", 0o644)
        write(self.root / "theirs", b"a\nB\nc\n", 0o644)
        write(self.root / "ours", b"a\nb\nc\nd\n", 0o644)
        self.assertFalse(self.merge())

    def test_missing_input_raises_instead_of_reporting_a_conflict(self) -> None:
        """A missing file makes git exit 255; that must raise."""
        write(self.root / "base", b"a\n", 0o644)
        write(self.root / "ours", b"a\n", 0o644)
        with self.assertRaises(RuntimeError):
            template_sync.merge_file(self.root / "ours", self.root / "base", self.root / "none")

    def test_binary_file_is_a_conflict_and_left_untouched(self) -> None:
        """A binary merge-tier file lands in ``conflicts``; the instance keeps its bytes."""
        # Regression: git exits 255 for binary input, which became a sync-wide exit 2.
        old, new, instance = (self.root / n for n in ("old", "new", "instance"))
        write(old / "b.bin", b"a\x00b\n", 0o644)
        write(new / "b.bin", b"a\x00c\n", 0o644)
        write(instance / "b.bin", b"a\x00d\n", 0o644)
        result = template_sync.apply_merge(old, new, instance, {"b.bin"})
        self.assertEqual(result, {"merged": [], "conflicts": ["b.bin"], "binary": ["b.bin"]})
        self.assertEqual((instance / "b.bin").read_bytes(), b"a\x00d\n")

    def test_binary_file_untouched_by_the_instance_is_updated(self) -> None:
        """A binary file the instance never changed takes the new version, no conflict."""
        old, new, instance = (self.root / n for n in ("old", "new", "instance"))
        write(old / "b.bin", b"a\x00b\n", 0o644)
        write(new / "b.bin", b"a\x00c\n", 0o644)
        write(instance / "b.bin", b"a\x00b\n", 0o644)
        result = template_sync.apply_merge(old, new, instance, {"b.bin"})
        self.assertEqual(result, {"merged": ["b.bin"], "conflicts": [], "binary": []})
        self.assertEqual((instance / "b.bin").read_bytes(), b"a\x00c\n")

    def test_binary_file_already_at_the_new_version_is_skipped(self) -> None:
        """An instance binary equal to the new one is neither merged nor a conflict."""
        old, new, instance = (self.root / n for n in ("old", "new", "instance"))
        write(old / "b.bin", b"a\x00b\n", 0o644)
        write(new / "b.bin", b"a\x00c\n", 0o644)
        write(instance / "b.bin", b"a\x00c\n", 0o644)
        result = template_sync.apply_merge(old, new, instance, {"b.bin"})
        self.assertEqual(result, {"merged": [], "conflicts": [], "binary": []})

    def test_binary_new_file_without_prior_version_is_a_conflict(self) -> None:
        """A newly merge-tier binary file has no base; it is still a conflict, not an error."""
        old, new, instance = (self.root / n for n in ("old", "new", "instance"))
        write(new / "b.bin", b"a\x00c\n", 0o644)
        write(instance / "b.bin", b"a\x00d\n", 0o644)
        result = template_sync.apply_merge(old, new, instance, {"b.bin"})
        self.assertEqual(result["conflicts"], ["b.bin"])


class CmdApplyExitCodeTest(unittest.TestCase):
    """``template_sync.cmd_apply`` exits 2 on any error, never the traceback's 1 (= conflicts)."""

    def setUp(self) -> None:
        """Create a temp dir and an empty manifest."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.manifest = self.root / "manifest.yml"
        self.manifest.write_text("")

    def _apply_args(self, manifest: Path) -> argparse.Namespace:
        """Build ``apply`` arguments over empty checkouts and the given manifest."""
        return argparse.Namespace(
            manifest=manifest, old_ref=self.root, new_ref=self.root, instance_root=self.root
        )

    def _exit_code(self, args: argparse.Namespace) -> int:
        """Run ``cmd_apply`` with stderr captured."""
        with contextlib.redirect_stderr(io.StringIO()):
            return template_sync.cmd_apply(args)

    def test_returns_error_code_on_merge_error(self) -> None:
        """``apply`` exits 2 (not the conflict code 1) when a merge errors."""
        with (
            mock.patch.object(template_sync, "parse_manifest", return_value={}),
            mock.patch.object(template_sync, "tier_paths", return_value=set()),
            mock.patch.object(template_sync, "apply_replace", return_value={}),
            mock.patch.object(template_sync, "apply_merge", side_effect=RuntimeError("boom")),
        ):
            self.assertEqual(self._exit_code(self._apply_args(self.manifest)), 2)

    def test_returns_error_code_on_missing_manifest(self) -> None:
        """An unreadable manifest is an error (2), not an uncaught traceback (1)."""
        self.assertEqual(self._exit_code(self._apply_args(self.root / "absent.yml")), 2)

    def test_returns_error_code_on_undecodable_manifest(self) -> None:
        """A manifest that is not UTF-8 (UnicodeDecodeError) exits 2."""
        self.manifest.write_bytes(b"\xff\xfe")
        self.assertEqual(self._exit_code(self._apply_args(self.manifest)), 2)

    def test_returns_error_code_on_tier_paths_failure(self) -> None:
        """A failure while expanding tiers to paths exits 2."""
        with mock.patch.object(template_sync, "tier_paths", side_effect=OSError("denied")):
            self.assertEqual(self._exit_code(self._apply_args(self.manifest)), 2)

    def test_returns_error_code_on_unexpected_exception(self) -> None:
        """Even a bug (here a KeyError) exits 2, not the traceback's 1 (= conflicts)."""
        with mock.patch.object(template_sync, "tier_paths", side_effect=KeyError("bug")):
            self.assertEqual(self._exit_code(self._apply_args(self.manifest)), 2)

    def test_does_not_catch_base_exceptions(self) -> None:
        """Ctrl-C and ``SystemExit`` still propagate."""
        with (
            mock.patch.object(template_sync, "tier_paths", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            self._exit_code(self._apply_args(self.manifest))

    def test_logs_the_traceback(self) -> None:
        """The traceback reaches stderr, so a crash is diagnosable from the job log."""
        with (
            mock.patch.object(template_sync, "tier_paths", side_effect=KeyError("bug")),
            self.assertLogs(template_sync.log, level="ERROR") as logged,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            template_sync.cmd_apply(self._apply_args(self.manifest))
        self.assertIn("KeyError", "".join(logged.output))

    def test_source_has_no_blanket_except_suppression(self) -> None:
        """No ``noqa: BLE001``: instances that don't select BLE flag it as unused (RUF100)."""
        self.assertNotIn("noqa: BLE", Path(template_sync.__file__).read_text())


class CheckApplyTest(unittest.TestCase):
    """``check-apply`` stops a crash that exits 1 from being read as merge conflicts."""

    def setUp(self) -> None:
        """Create a temp dir for the summary file."""
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.summary = Path(self._tmp.name) / "summary.json"

    def check(self, exit_code: int) -> tuple[int, str]:
        """Run ``cmd_check_apply``; return its status and stdout."""
        args = argparse.Namespace(exit_code=exit_code, summary=self.summary)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            return template_sync.cmd_check_apply(args), out.getvalue()

    def write_summary(self, conflicts: list[str]) -> None:
        """Write an ``apply``-shaped summary with the given conflicts."""
        self.summary.write_text(
            json.dumps({"replace": {}, "merge": {"merged": [], "conflicts": conflicts}})
        )

    def test_clean_run(self) -> None:
        """Exit 0 with a conflict-free summary passes."""
        self.write_summary([])
        self.assertEqual(self.check(0), (0, "conflicts=0\n"))

    def test_conflicts(self) -> None:
        """Exit 1 with listed conflicts passes and reports them."""
        self.write_summary(["a.txt"])
        self.assertEqual(self.check(1), (0, "conflicts=1\n"))

    def test_crash_exiting_1_with_empty_summary_fails(self) -> None:
        """A SyntaxError exits 1 with nothing on stdout: not conflicts."""
        self.summary.write_text("")
        self.assertEqual(self.check(1), (2, ""))

    def test_missing_summary_fails(self) -> None:
        """No summary file at all fails for either status."""
        self.assertEqual(self.check(0)[0], 2)
        self.assertEqual(self.check(1)[0], 2)

    def test_exit_1_without_conflicts_fails(self) -> None:
        """Exit 1 contradicting a conflict-free summary fails."""
        self.write_summary([])
        self.assertEqual(self.check(1)[0], 2)

    def test_exit_0_with_conflicts_fails(self) -> None:
        """Exit 0 contradicting listed conflicts fails."""
        self.write_summary(["a.txt"])
        self.assertEqual(self.check(0)[0], 2)

    def test_malformed_summary_fails(self) -> None:
        """A summary of the wrong shape fails."""
        self.summary.write_text('{"merge": []}')
        self.assertEqual(self.check(1)[0], 2)

    def test_deeply_nested_summary_fails_instead_of_crashing(self) -> None:
        """A summary that overflows the JSON parser's recursion limit is rejected."""
        self.summary.write_text("[" * 200_000)
        self.assertEqual(self.check(1), (2, ""))

    def test_error_exit_fails(self) -> None:
        """Exit 2 (or any other status) fails even with a valid summary."""
        self.write_summary([])
        self.assertEqual(self.check(2)[0], 2)

    def test_workflow_calls_check_apply_before_advancing_state(self) -> None:
        """The sync workflow routes ``apply``'s status through ``check-apply``."""
        text = (REPO_ROOT / ".github/workflows/template-sync.yml").read_text()
        self.assertIn("template_sync.py check-apply", text)
        self.assertLess(text.index("check-apply"), text.index("name: Update sync state"))


def _apply_step_script() -> str:
    """Return the shell of the ``Apply replace and merge tiers`` step of template-sync.yml."""
    text = (REPO_ROOT / ".github/workflows/template-sync.yml").read_text()
    step = re.search(
        r"- name: Apply replace and merge tiers\n.*?\n        run: \|\n(.*?)\n\n      - name:",
        text,
        re.DOTALL,
    )
    assert step is not None  # noqa: S101 -- test helper
    return "\n".join(line[10:] for line in step.group(1).splitlines())


class ApplyStepTest(unittest.TestCase):
    """The workflow's apply step keeps ``apply``'s exit status and fails closed."""

    FAKE = (
        "import json, os, sys\n"
        f"sys.path.insert(0, {str(SCRIPTS_DIR)!r})\n"
        "if sys.argv[1] == 'apply':\n"
        "    print(os.environ['FAKE_SUMMARY'])\n"
        "    raise SystemExit(int(os.environ['FAKE_RC']))\n"
        "import template_sync\n"
        "raise SystemExit(template_sync.main())\n"
    )

    def run_step(self, rc: int, summary: str) -> tuple[subprocess.CompletedProcess[str], str]:
        """Run the step with a fake ``apply``; return the process and ``$GITHUB_OUTPUT``."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / "template-new/.github/scripts"
            scripts.mkdir(parents=True)
            (scripts / "template_sync.py").write_text(self.FAKE)
            out = root / "output"
            out.touch()
            script = _apply_step_script().replace("/tmp/", f"{tmp}/")
            result = subprocess.run(  # noqa: S603 -- fixed argv
                ["bash", "-e", "-c", script],  # noqa: S607
                env={
                    **os.environ,
                    "GITHUB_OUTPUT": str(out),
                    "GITHUB_WORKSPACE": tmp,
                    "FAKE_RC": str(rc),
                    "FAKE_SUMMARY": summary,
                },
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            return result, out.read_text()

    CLEAN = json.dumps({"replace": {}, "merge": {"merged": [], "conflicts": []}})
    CONFLICTS = json.dumps({"replace": {}, "merge": {"merged": [], "conflicts": ["a"]}})

    def test_clean_and_conflicts_pass(self) -> None:
        """Exit 0 and exit 1 with a matching summary pass and print the summary."""
        for rc, summary, output in (
            (0, self.CLEAN, "conflicts=0"),
            (1, self.CONFLICTS, "conflicts=1"),
        ):
            result, out = self.run_step(rc, summary)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(out.strip(), output)
            self.assertIn(summary, result.stdout)

    def test_error_exit_is_preserved(self) -> None:
        """An ``apply`` error (2) fails the job with 2, not 1, and names the status."""
        result, out = self.run_step(2, self.CLEAN)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("exit 2", result.stdout + result.stderr)
        self.assertEqual(out, "")

    def test_other_statuses_are_preserved(self) -> None:
        """A kill signal's status (137) is reported as such."""
        result, _ = self.run_step(137, "")
        self.assertEqual(result.returncode, 137, result.stderr)

    def test_crash_exiting_1_fails_closed(self) -> None:
        """Exit 1 without a conflict summary is a crash: the job fails, with an error status."""
        result, out = self.run_step(1, "")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(out, "")

    def test_only_the_validated_line_reaches_github_output(self) -> None:
        """Extra stdout from check-apply is never written to ``$GITHUB_OUTPUT``."""
        fake = self.FAKE.replace(
            "import template_sync\n",
            "if sys.argv[1] == 'check-apply':\n"
            "    print('conflicts=0\\nevil=1')\n"
            "    raise SystemExit(0)\n"
            "import template_sync\n",
        )
        self.assertNotEqual(fake, self.FAKE)  # the replace must have applied
        with mock.patch.object(ApplyStepTest, "FAKE", fake):
            result, out = self.run_step(0, self.CLEAN)
        self.assertEqual(out, "")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("unexpected line", result.stderr)

    def test_summary_is_not_printed_as_valid_before_validation(self) -> None:
        """A rejected summary is printed only under a "not validated" label."""
        result, _ = self.run_step(2, self.CLEAN)
        text = result.stdout
        self.assertIn("not validated", text)
        self.assertLess(text.index("not validated"), text.index(self.CLEAN))


class BinaryConflictVisibilityTest(unittest.TestCase):
    """A binary conflict has no markers, so the PR body and the job log must say so."""

    SUMMARY = {
        "replace": {"updated": [], "removed": []},
        "merge": {"merged": [], "conflicts": ["b.bin", "t.txt"], "binary": ["b.bin"]},
    }

    def test_pr_body_labels_the_binary_conflict(self) -> None:
        """Each conflict line says which kind it is."""
        body = template_sync.pr_body(self.SUMMARY, "v1.0.0", "v1.1.0", "o/t")
        self.assertIn("binary conflict, no markers", body.split("`b.bin`")[0].splitlines()[-1])
        self.assertIn("conflict, needs manual resolution**): `t.txt`", body)

    def test_pr_body_accepts_a_summary_without_the_binary_key(self) -> None:
        """A summary from an older apply still renders."""
        old = {**self.SUMMARY, "merge": {"merged": [], "conflicts": ["t.txt"]}}
        self.assertIn("`t.txt`", template_sync.pr_body(old, "v1.0.0", "v1.1.0", "o/t"))

    def test_apply_warns_about_the_binary_conflict(self) -> None:
        """``apply`` prints a ``::warning::`` annotation naming the file."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old, new, instance = (root / n for n in ("old", "new", "instance"))
            write(old / "b.bin", b"a\x00b\n", 0o644)
            write(new / "b.bin", b"a\x00c\n", 0o644)
            write(instance / "b.bin", b"a\x00d\n", 0o644)
            manifest = root / "manifest.yml"
            manifest.write_text("merge:\n  - b.bin\n")
            args = argparse.Namespace(
                manifest=manifest, old_ref=old, new_ref=new, instance_root=instance
            )
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                status = template_sync.cmd_apply(args)
        self.assertEqual(status, template_sync.EXIT_CONFLICTS)
        self.assertIn("::warning file=b.bin::binary merge conflict", err.getvalue())

    def test_warning_escapes_the_path(self) -> None:
        """Characters that end an annotation property are percent-encoded."""
        self.assertEqual(
            template_sync._annotation_escape("a,b:c%d\n.bin", prop=True), "a%2Cb%3Ac%25d%0A.bin"
        )


_SCRIPT_PATH_RE = re.compile(r"(?<![\w.-])(\.github/scripts/[\w.-]+\.sh)\b")
# What may sit between an interpreter and the script path: a `./` or a
# `${{ ... }}/` prefix, quotes. Stripped from the text before the path.
_PATH_PREFIX_RE = re.compile(r"""["']?(?:\$\{\{[^}]*\}\}/|\$\{?GITHUB_WORKSPACE\}?/|\./)?["']?$""")
# An interpreter (optionally by path, with flags) ending the text before a path.
_INTERPRETER_RE = re.compile(
    r"(?:^|[\s;&|(])(?:\S*/)?(?:bash|sh|source|\.)(?:\s+-(?!\w*c)\S+)*\s+$"
)


def directly_invoked_scripts(workflow_text: str) -> set[str]:
    """`.github/scripts/*.sh` paths a workflow runs as the command itself.

    Covers one-line and `run: |` block steps (every non-comment line is
    checked), `./x.sh` and bare `x.sh`, and a `${{ ... }}/` prefix. A path
    handed to `bash`/`sh`/`source`/`.` (with or without flags) is not direct:
    those don't need the execute bit.
    """
    invoked: set[str] = set()
    for line in workflow_text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        for m in _SCRIPT_PATH_RE.finditer(line):
            before = _PATH_PREFIX_RE.sub("", line[: m.start()], count=1)
            if not _INTERPRETER_RE.search(before):
                invoked.add(m.group(1))
    return invoked


class DirectlyInvokedScriptsAreExecutableTest(unittest.TestCase):
    """A workflow step that names a script as the command needs mode 755 (exit 126 otherwise)."""

    def test_every_directly_invoked_script_is_executable(self) -> None:
        """Every script a workflow runs directly has its execute bit set."""
        invoked: set[str] = set()
        for workflow in (REPO_ROOT / ".github" / "workflows").glob("*.yml"):
            invoked |= directly_invoked_scripts(workflow.read_text())
        self.assertTrue(invoked, "expected the moderate-* workflows to invoke scripts directly")
        for rel in sorted(invoked):
            self.assertTrue(is_exec(REPO_ROOT / rel), f"{rel} is not executable")

    def test_detection(self) -> None:
        """``directly_invoked_scripts`` separates direct from interpreted invocations."""
        direct = {
            "run: .github/scripts/a.sh": "a",
            "run: ./.github/scripts/a.sh arg": "a",
            "  run: |\n    set -e\n    .github/scripts/a.sh\n": "a",
            "  run: |\n    echo hi && ./.github/scripts/a.sh": "a",
            'run: "${{ github.workspace }}/.github/scripts/a.sh"': "a",
            "run: ${{ github.workspace }}/.github/scripts/a.sh x": "a",
            "run: bash .github/scripts/a.sh | .github/scripts/b.sh": "b",
            "run: cd x; bash -e a.sh && ./.github/scripts/b.sh": "b",
            'run: bash -c "./.github/scripts/a.sh"': "a",
            "run: bash -ec .github/scripts/a.sh": "a",
        }
        for text, name in direct.items():
            self.assertEqual(directly_invoked_scripts(text), {f".github/scripts/{name}.sh"}, text)
        interpreted = [
            "run: bash .github/scripts/a.sh",
            "run: bash ./.github/scripts/a.sh",
            "run: bash -eu .github/scripts/a.sh",
            "run: /bin/bash ${{ github.workspace }}/.github/scripts/a.sh",
            "  run: |\n    sh .github/scripts/a.sh",
            "run: bash $GITHUB_WORKSPACE/.github/scripts/a.sh",
            'run: bash "${GITHUB_WORKSPACE}/.github/scripts/a.sh"',
            "run: source .github/scripts/a.sh",
            "run: . .github/scripts/a.sh",
            'run: bash "${{ github.workspace }}/.github/scripts/a.sh"',
            "# run: .github/scripts/a.sh",
            "run: python .github/scripts/a.py",
        ]
        for text in interpreted:
            self.assertEqual(directly_invoked_scripts(text), set(), text)

    def test_claude_hook_is_executable(self) -> None:
        """The Claude hook script is executable."""
        # .claude/settings.json runs it directly as a hook command.
        self.assertTrue(is_exec(REPO_ROOT / ".claude" / "hooks" / "self-check.sh"))


# An instance that implements `publish-packages` replaces base's default, so
# DefaultPublishPackagesTest only describes (and can only test) a Makefile
# that kept it.
DEFAULT_PUBLISH_PACKAGES_MARKER = "doesn't implement publish-packages"


def keeps_default_publish_packages(makefile_text: str) -> bool:
    """Whether a Makefile still has base's default error message (comments don't count)."""
    code = "\n".join(
        line for line in makefile_text.splitlines() if not line.lstrip().startswith("#")
    )
    return DEFAULT_PUBLISH_PACKAGES_MARKER in code


class KeepsDefaultPublishPackagesTest(unittest.TestCase):
    """``keeps_default_publish_packages`` tells base's default Makefile target from an override."""

    def test_both_branches(self) -> None:
        """The marker matches the default message and nothing else."""
        self.assertTrue(
            keeps_default_publish_packages(
                "publish-packages:\n"
                '\t@echo "error: Makefile doesn\'t implement publish-packages" >&2\n'
            )
        )
        self.assertFalse(keeps_default_publish_packages("publish-packages:\n\tnpm publish\n"))
        # A comment mentioning the phrase is not the default.
        self.assertFalse(
            keeps_default_publish_packages(
                "# we don't implement publish-packages yet\npublish-packages:\n\tnpm publish\n"
            )
        )


class MakefileDefinesPublishPackagesTest(unittest.TestCase):
    """Every instance defines `publish-packages` (base's default or its own)."""

    def test_target_is_defined(self) -> None:
        """A Makefile without the target fails the release with "No rule to make target"."""
        makefile = REPO_ROOT / "Makefile"
        self.assertTrue(makefile.is_file(), "no Makefile at the repository root")
        self.assertRegex(makefile.read_text(), r"(?m)^publish-packages:")


@unittest.skipUnless(shutil.which("make"), "make not installed")
@unittest.skipUnless(
    (REPO_ROOT / "Makefile").is_file()
    and keeps_default_publish_packages((REPO_ROOT / "Makefile").read_text()),
    "this Makefile implements publish-packages itself",
)
class DefaultPublishPackagesTest(unittest.TestCase):
    """base's default `publish-packages` fails loudly when a package publish is configured."""

    def run_target(self, **env: str) -> subprocess.CompletedProcess[str]:
        """Run ``make publish-packages`` with the given env and no inherited ``*_PUBLISH``."""
        clean = {k: v for k, v in os.environ.items() if not k.endswith("_PUBLISH")}
        return subprocess.run(  # noqa: S603 -- fixed argv, trusted tool
            ["make", "-s", "-C", str(REPO_ROOT), "publish-packages"],  # noqa: S607
            env={**clean, **env},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_no_publish_variable_is_a_noop(self) -> None:
        """With no ``*_PUBLISH`` variable (or an empty one) the target succeeds."""
        self.assertEqual(self.run_target().returncode, 0)
        self.assertEqual(self.run_target(NPM_PUBLISH="").returncode, 0)

    def test_any_publish_variable_fails_with_a_clear_message(self) -> None:
        """Any ``*_PUBLISH`` variable makes the default target fail and name the variable."""
        for var in ("PYPI_PUBLISH", "NPM_PUBLISH", "CARGO_PUBLISH"):
            result = self.run_target(**{var: "1"})
            self.assertNotEqual(result.returncode, 0, var)
            self.assertIn(
                f"sets {var} but its Makefile doesn't implement publish-packages", result.stderr
            )


if __name__ == "__main__":
    unittest.main()
