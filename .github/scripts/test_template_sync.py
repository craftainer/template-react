"""Tests for ``template_sync.py`` and the executable bits CI relies on.

Stdlib ``unittest`` only (see this directory's README); run with
``python3 -m unittest discover -s .github/scripts -p 'test_*.py'`` -- the
``scripts-tests`` prek hook does exactly that.
"""

from __future__ import annotations

import argparse
import contextlib
import io
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

REPO_ROOT = Path(__file__).resolve().parents[2]


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
        self.assertEqual(self.apply(), {"merged": ["m.txt"], "conflicts": []})
        merged = (self.instance / "m.txt").read_bytes()
        self.assertEqual(merged, b"a\nB\nc\nd\n")
        self.assertEqual(self.apply(), {"merged": [], "conflicts": []})
        self.assertEqual((self.instance / "m.txt").read_bytes(), merged)

    def test_instance_already_equal_to_new_is_not_reported(self) -> None:
        """A file the instance already has at the new version is not "merged"."""
        write(self.instance / "m.txt", b"a\nB\nc\n", 0o644)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": []})

    def test_symlinked_instance_file_is_not_merged_through(self) -> None:
        """Like the replace tier, a deliberately linked instance file is left alone."""
        target = self.root / "real.txt"
        target.write_bytes(b"a\nb\nc\nd\n")
        (self.instance / "m.txt").unlink()
        (self.instance / "m.txt").symlink_to(target)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": []})
        self.assertEqual(target.read_bytes(), b"a\nb\nc\nd\n")

    def test_dangling_symlink_is_not_written_through(self) -> None:
        """A dangling link is not "missing": copying would create its target."""
        (self.instance / "m.txt").unlink()
        dangling = self.root / "nowhere.txt"
        (self.instance / "m.txt").symlink_to(dangling)
        self.assertEqual(self.apply(), {"merged": [], "conflicts": []})
        self.assertFalse(dangling.exists())


class MergeFileErrorTest(unittest.TestCase):
    """``git merge-file`` exit 255 is an error, not a conflict."""

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

    def test_binary_file_error_propagates_from_apply_merge(self) -> None:
        """A binary merge-tier file fails the sync rather than landing in ``conflicts``."""
        old, new, instance = (self.root / n for n in ("old", "new", "instance"))
        write(old / "b.bin", b"a\x00b\n", 0o644)
        write(new / "b.bin", b"a\x00c\n", 0o644)
        write(instance / "b.bin", b"a\x00d\n", 0o644)
        with self.assertRaises(RuntimeError):
            template_sync.apply_merge(old, new, instance, {"b.bin"})

    def test_cmd_apply_returns_error_code_on_merge_error(self) -> None:
        """``apply`` exits 2 (not the conflict code 1) when a merge errors."""
        manifest = self.root / "manifest.yml"
        manifest.write_text("")
        args = argparse.Namespace(
            manifest=manifest, old_ref=self.root, new_ref=self.root, instance_root=self.root
        )
        with (
            mock.patch.object(template_sync, "parse_manifest", return_value={}),
            mock.patch.object(template_sync, "tier_paths", return_value=set()),
            mock.patch.object(template_sync, "apply_replace", return_value={}),
            mock.patch.object(template_sync, "apply_merge", side_effect=RuntimeError("boom")),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(template_sync.cmd_apply(args), 2)

    def _apply_args(self, manifest: Path) -> argparse.Namespace:
        """Build ``apply`` arguments over empty checkouts and the given manifest."""
        return argparse.Namespace(
            manifest=manifest, old_ref=self.root, new_ref=self.root, instance_root=self.root
        )

    def _exit_code(self, args: argparse.Namespace) -> int:
        """Run ``cmd_apply`` with stderr captured."""
        with contextlib.redirect_stderr(io.StringIO()):
            return template_sync.cmd_apply(args)

    def test_cmd_apply_returns_error_code_on_missing_manifest(self) -> None:
        """An unreadable manifest is an error (2), not an uncaught traceback (1)."""
        self.assertEqual(self._exit_code(self._apply_args(self.root / "absent.yml")), 2)

    def test_cmd_apply_returns_error_code_on_undecodable_manifest(self) -> None:
        """A manifest that is not UTF-8 (UnicodeDecodeError) exits 2."""
        manifest = self.root / "manifest.yml"
        manifest.write_bytes(b"\xff\xfe")
        self.assertEqual(self._exit_code(self._apply_args(manifest)), 2)

    def test_cmd_apply_returns_error_code_on_tier_paths_failure(self) -> None:
        """A failure while expanding tiers to paths exits 2."""
        manifest = self.root / "manifest.yml"
        manifest.write_text("")
        with mock.patch.object(template_sync, "tier_paths", side_effect=OSError("denied")):
            self.assertEqual(self._exit_code(self._apply_args(manifest)), 2)

    def test_cmd_apply_returns_error_code_on_unexpected_exception(self) -> None:
        """Even a bug (here a KeyError) exits 2, not the traceback's 1 (= conflicts)."""
        manifest = self.root / "manifest.yml"
        manifest.write_text("")
        with mock.patch.object(template_sync, "tier_paths", side_effect=KeyError("bug")):
            self.assertEqual(self._exit_code(self._apply_args(manifest)), 2)

    def test_cmd_apply_does_not_catch_base_exceptions(self) -> None:
        """Ctrl-C and ``SystemExit`` still propagate."""
        manifest = self.root / "manifest.yml"
        manifest.write_text("")
        with (
            mock.patch.object(template_sync, "tier_paths", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            self._exit_code(self._apply_args(manifest))


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
