"""Tests for ``assemble_dist.py`` and ``has_make_target.sh`` (``release.yml``'s helpers)."""

from __future__ import annotations

import contextlib
import hashlib
import io
import itertools
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import assemble_dist

SCRIPTS = Path(__file__).resolve().parent


def _gnu_make() -> bool:
    """Whether ``make`` is GNU make, whose ``-p`` dump format the probe parses."""
    make = shutil.which("make")
    if make is None:
        return False
    out = subprocess.run(  # noqa: S603 -- fixed argv
        [make, "--version"], capture_output=True, text=True, check=False
    )
    return out.stdout.startswith("GNU Make")


def make_tar(
    path: Path, entries: dict[str, bytes | None], links: dict[str, str] | None = None
) -> None:
    """Write a tarball: ``name -> bytes`` is a file, ``name -> None`` a directory."""
    with tarfile.open(path, "w") as tar:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            tar.addfile(info)


class AssembleDistTest(unittest.TestCase):
    """``assemble`` merges per-arch tarballs and rejects every kind of collision."""

    def setUp(self) -> None:
        """Create empty ``parts/`` and ``dist/`` locations."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.parts = tmp / "parts"
        self.parts.mkdir()
        self.dist = tmp / "dist"

    def leg(self, arch: str, entries: dict[str, bytes | None], **kw: dict[str, str]) -> None:
        """Create ``assets-<arch>.tar``."""
        make_tar(self.parts / f"assets-{arch}.tar", entries, kw.get("links"))

    def assert_collision(self, pattern: str) -> None:
        """Assembling both arches fails with a message matching ``pattern``."""
        with self.assertRaisesRegex(assemble_dist.AssembleError, pattern):
            assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)

    def test_merges_disjoint_legs(self) -> None:
        """Different names (and a shared directory) from two legs are all extracted."""
        self.leg("amd64", {"./": None, "./a-amd64.tar": b"1", "./sbom/": None, "./sbom/a": b"x"})
        self.leg("arm64", {"./a-arm64.tar": b"2", "./sbom/": None, "./sbom/b": b"y"})
        assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)
        got = sorted(str(p.relative_to(self.dist)) for p in self.dist.rglob("*") if p.is_file())
        self.assertEqual(got, ["a-amd64.tar", "a-arm64.tar", "sbom/a", "sbom/b"])

    def test_empty_leg_is_fine(self) -> None:
        """A leg that produced nothing still assembles."""
        self.leg("amd64", {"./": None})
        assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertTrue(self.dist.is_dir())

    def test_missing_arch(self) -> None:
        """A leg without a tarball is reported by arch."""
        self.leg("amd64", {"./": None})
        self.assert_collision("no release assets uploaded for arch arm64")

    def test_same_file_name(self) -> None:
        """The same file name in two legs is rejected."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"./x": b"2"})
        self.assert_collision("more than one arch leg")

    def test_file_then_directory(self) -> None:
        """A file in one leg and a directory of that name in the next is rejected."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"x/": None, "x/y": b"2"})
        self.assert_collision("dist/x is a file")

    def test_directory_then_file(self) -> None:
        """A directory in one leg and a file of that name in the next is rejected."""
        self.leg("amd64", {"x/": None, "x/y": b"2"})
        self.leg("arm64", {"x": b"1"})
        self.assert_collision("more than one arch leg")

    def test_file_under_other_legs_file(self) -> None:
        """A file below a path that is another leg's file is rejected (no explicit dir entry)."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"x/y": b"2"})
        self.assert_collision("dist/x is a file")

    def test_symlink_clashes(self) -> None:
        """A symlink counts as a file: a dangling link still collides by name."""
        self.leg("amd64", {}, links={"x": "nowhere"})
        self.leg("arm64", {"x": b"1"})
        self.assert_collision("more than one arch leg")

    def test_same_leg_repeat_is_not_a_collision(self) -> None:
        """A path repeated within one leg (or a repeated arch) extracts fine."""
        self.leg("amd64", {"x": b"1"})
        with tarfile.open(self.parts / "assets-amd64.tar", "a") as tar:
            info = tarfile.TarInfo("x")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"2"))
        assemble_dist.assemble(["amd64", "amd64"], self.parts, self.dist)
        self.assertTrue((self.dist / "x").is_file())

    def test_failure_extracts_nothing(self) -> None:
        """A collision in a later leg leaves dist/ empty."""
        self.leg("amd64", {"a": b"1", "x": b"1"})
        self.leg("arm64", {"x": b"2"})
        self.assert_collision("more than one arch leg")
        self.assertFalse(self.dist.exists() and any(self.dist.iterdir()))
        # No staging directory is left behind either.
        self.assertEqual(sorted(p.name for p in self.dist.parent.iterdir()), ["parts"])

    def test_symlink_out_of_dist_is_reported(self) -> None:
        """A link pointing outside dist/ is a reported error, not a traceback."""
        self.leg("amd64", {}, links={"latest": "/etc/passwd"})
        self.assertEqual(assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)]), 1)

    def test_corrupt_tarball_is_reported(self) -> None:
        """A tarball that is not a tar is a reported error."""
        (self.parts / "assets-amd64.tar").write_bytes(b"not a tar")
        self.assertEqual(assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)]), 1)

    def test_truncated_compressed_tarball_names_the_file(self) -> None:
        """A truncated gzip tarball is an ``::error::`` with its file name, not a traceback."""
        # Regression: EOFError from the lazy read during extraction escaped main().
        src = self.parts / "src"
        src.mkdir()
        (src / "f.txt").write_bytes(os.urandom(50_000).hex().encode())
        full = self.parts / "full.tgz"
        with tarfile.open(full, "w:gz") as tar:
            tar.add(src / "f.txt", arcname="f.txt")
        (self.parts / "assets-amd64.tar").write_bytes(full.read_bytes()[:300])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status = assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)])
        self.assertEqual(status, 1)
        self.assertIn("::error::could not read assets-amd64.tar", out.getvalue())
        self.assertFalse(self.dist.exists())

    def test_corrupt_bz2_tarball_names_the_file(self) -> None:
        """bz2 corruption mid-stream is reported with the file name, whatever it raises."""
        src = self.parts / "f.txt"
        src.write_bytes(os.urandom(2_000_000).hex().encode())  # several bz2 blocks
        full = self.parts / "full.tbz"
        with tarfile.open(full, "w:bz2") as tar:
            tar.add(src, arcname="f.txt")
        data = bytearray(full.read_bytes())
        data[-3000:-2980] = b"\xff" * 20
        (self.parts / "assets-amd64.tar").write_bytes(bytes(data))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status = assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)])
        self.assertEqual(status, 1)
        # EOFError, OSError or ReadError, depending on where the damage lands.
        self.assertRegex(out.getvalue(), r"^::error::.*assets-amd64\.tar")

    def test_invalid_arches_are_reported(self) -> None:
        """ARCHES_JSON must be a non-empty array of plain arch names."""
        for raw in ("[]", '"amd64"', '{"amd64": 1}', "[1]", '[""]', '["../x"]', '["a/b"]', "nope"):
            self.assertEqual(
                assemble_dist.main(["x", raw, str(self.parts), str(self.dist)]), 1, raw
            )
        self.assertFalse(self.dist.exists())

    def test_wrong_argument_count(self) -> None:
        """Missing arguments print the usage and exit 2."""
        self.assertEqual(assemble_dist.main(["x", "[]"]), 2)

    def test_failure_mid_extract_leaves_nothing(self) -> None:
        """A member only refused while extracting (unsafe link) leaves no dist/ or temp dir."""
        self.leg("amd64", {"a": b"1"})
        self.leg("arm64", {}, links={"latest": "/etc/passwd"})
        self.assertEqual(
            assemble_dist.main(["x", '["amd64", "arm64"]', str(self.parts), str(self.dist)]), 1
        )
        self.assertEqual(sorted(p.name for p in self.dist.parent.iterdir()), ["parts"])

    def test_dot_member_does_not_reset_the_dist_mode(self) -> None:
        """A "." member (`tar -C dist -cf x.tar .`) with mode 0700 still leaves dist/ 0755."""
        with tarfile.open(self.parts / "assets-amd64.tar", "w") as tar:
            dot = tarfile.TarInfo(".")
            dot.type = tarfile.DIRTYPE
            dot.mode = 0o700
            tar.addfile(dot)
            info = tarfile.TarInfo("a")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"1"))
        assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertEqual(self.dist.stat().st_mode & 0o777, 0o755)
        self.assertTrue((self.dist / "a").is_file())

    def test_restrictive_dot_member_in_an_earlier_leg_does_not_block_later_legs(self) -> None:
        """A "." member with mode 0555 (applied after leg A) must not stop leg B writing."""
        if os.geteuid() == 0:
            self.skipTest("root ignores directory modes")
        with tarfile.open(self.parts / "assets-amd64.tar", "w") as tar:
            dot = tarfile.TarInfo(".")
            dot.type = tarfile.DIRTYPE
            dot.mode = 0o555
            tar.addfile(dot)
            info = tarfile.TarInfo("a")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"1"))
        self.leg("arm64", {"b": b"2"})
        assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)
        self.assertEqual(self.dist.stat().st_mode & 0o777, 0o755)
        self.assertTrue((self.dist / "a").is_file())
        self.assertTrue((self.dist / "b").is_file())

    def test_each_tarball_is_opened_once(self) -> None:
        """Validation and extraction share one pass over every tarball."""
        self.leg("amd64", {"a": b"1"})
        self.leg("arm64", {"b": b"1"})
        opened: list[str] = []
        real_open = tarfile.open

        def counting_open(name: Path, *args: object, **kwargs: object) -> tarfile.TarFile:
            opened.append(Path(name).name)
            return real_open(name, *args, **kwargs)  # type: ignore[arg-type]

        with mock.patch.object(tarfile, "open", counting_open):
            assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)
        self.assertEqual(sorted(opened), ["assets-amd64.tar", "assets-arm64.tar"])

    def test_existing_dist(self) -> None:
        """An empty dist/ is filled; one that already holds files is refused untouched."""
        self.leg("amd64", {"a": b"1"})
        self.dist.mkdir()
        assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertTrue((self.dist / "a").is_file())
        (self.dist / "keep").write_text("x")
        with self.assertRaisesRegex(assemble_dist.AssembleError, "not an empty directory"):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertEqual(sorted(p.name for p in self.dist.iterdir()), ["a", "keep"])

    def test_unsafe_link_message(self) -> None:
        """The refusal of an absolute link names the tarball and says what is allowed."""
        self.leg("amd64", {}, links={"latest": "/etc/passwd"})
        with self.assertRaisesRegex(
            assemble_dist.AssembleError, r"assets-amd64\.tar: .*inside dist/"
        ):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)

    def test_collisions_do_not_depend_on_leg_order(self) -> None:
        """With three legs, every ordering accepts or rejects the same layouts."""
        layouts = {
            "disjoint": ({"a": b"1"}, {"b": b"1"}, {"d/": None, "d/c": b"1"}, False),
            "shared dir": ({"d/a": b"1"}, {"d/b": b"1"}, {"d/": None, "d/c": b"1"}, False),
            "file vs dir": ({"d/a": b"1"}, {"d/b": b"1"}, {"d": b"1"}, True),
            "file vs implied dir": ({"d": b"1"}, {"e": b"1"}, {"d/x": b"1"}, True),
            "same file": ({"a": b"1"}, {"b": b"1"}, {"a": b"2"}, True),
        }
        for name, (one, two, three, collides) in layouts.items():
            for order in itertools.permutations([one, two, three]):
                with tempfile.TemporaryDirectory() as tmp:
                    parts = Path(tmp) / "parts"
                    parts.mkdir()
                    arches = [f"a{i}" for i in range(3)]
                    for arch, entries in zip(arches, order, strict=True):
                        make_tar(parts / f"assets-{arch}.tar", entries)
                    dist = Path(tmp) / "dist"
                    if collides:
                        with self.assertRaises(assemble_dist.AssembleError, msg=name):
                            assemble_dist.assemble(arches, parts, dist)
                    else:
                        assemble_dist.assemble(arches, parts, dist)

    def test_escaping_path(self) -> None:
        """A member that climbs out of dist/ is rejected."""
        self.leg("amd64", {"../evil": b"1"})
        with self.assertRaisesRegex(assemble_dist.AssembleError, "escapes"):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)


@unittest.skipUnless(_gnu_make(), "GNU make not installed (the probe parses its -p dump)")
class HasMakeTargetTest(unittest.TestCase):
    """``has_make_target.sh`` tells a defined rule from everything else."""

    def probe(
        self, makefile: str, target: str = "verify-published"
    ) -> subprocess.CompletedProcess[str]:
        """Run the probe in a temp dir containing ``makefile``."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "Makefile").write_text(makefile)
            return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
                [str(SCRIPTS / "has_make_target.sh"), target],
                cwd=tmp,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_defined_rules(self) -> None:
        """Plain, double-colon, prerequisite-only and recipe-less rules all count."""
        for rule in (
            "verify-published:\n\t@echo hi\n",
            "verify-published::\n\t@echo hi\n",
            "verify-published: other\nother:\n",
            "verify-published:\n",
            ".PHONY: verify-published\nverify-published: ;\n",
            "verify-published: VAR := x\nverify-published:\n\t@true\n",
            'verify-published:\n\t@echo "*** done ***"\n',
            # Only listed in .PHONY: indistinguishable from an empty rule, and
            # `make verify-published` is a successful no-op either way.
            ".PHONY: verify-published\n",
        ):
            self.assertEqual(self.probe(rule).returncode, 0, rule)

    def test_recipe_is_not_run(self) -> None:
        """Probing never runs a recipe, `$(MAKE)` lines included."""
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "ran"
            result = self.probe(
                f"verify-published:\n\t$(MAKE) boom\n\ttouch {marker}\nboom:\n\ttouch {marker}\n"
            )
            self.assertEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), "a recipe ran")

    def test_parse_time_shell_still_runs(self) -> None:
        """Known limit: make evaluates `$(shell ...)` in a `:=` assignment while parsing."""
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "ran"
            result = self.probe(f"X := $(shell touch {marker})\nverify-published:\n\t@true\n")
            self.assertEqual(result.returncode, 0)
            self.assertTrue(marker.exists(), "make no longer evaluates $(shell) at parse time")

    def test_usage_error_is_exit_2(self) -> None:
        """No argument (or an empty one) is a usage error, never 'not defined' (1)."""
        for args in ([], [""], ["a", "b"]):
            with tempfile.TemporaryDirectory() as tmp:
                result = subprocess.run(  # noqa: S603 -- fixed argv, trusted script
                    [str(SCRIPTS / "has_make_target.sh"), *args],
                    cwd=tmp,
                    capture_output=True,
                    text=True,
                    check=False,
                )
            self.assertEqual(result.returncode, 2, args)
            self.assertIn("usage", result.stderr)

    def test_missing_rules(self) -> None:
        """No rule, a mere prerequisite, or a longer name is not the target."""
        for text in (
            "build:\n\t@true\n",
            "build: verify-published\n",
            "verify-published-extra:\n\t@true\n",
            "verify-published: VAR := x\n",
        ):
            self.assertEqual(self.probe(text).returncode, 1, text)

    def test_name_is_literal(self) -> None:
        """Regex metacharacters in the name match only themselves."""
        self.assertEqual(self.probe("c++:\n\t@true\n", "c++").returncode, 0)
        self.assertEqual(self.probe("a.b:\n\t@true\n", "a.b").returncode, 0)
        self.assertEqual(self.probe("abb:\n\t@true\n", "a.b").returncode, 1)
        self.assertEqual(self.probe("c:\n\t@true\n", "c+").returncode, 1)

    def test_broken_makefile(self) -> None:
        """A Makefile that fails to parse is an error, not 'missing'."""
        result = self.probe("include does-not-exist.mk\n")
        self.assertEqual(result.returncode, 2)
        self.assertIn("does-not-exist.mk", result.stdout)


# Stands in for `gh api`: call N runs the shell snippet in $FAKE_DIR/callN (the
# last one repeats), which prints to stdout/stderr and exits like gh would.
FAKE_GH = """#!/usr/bin/env bash
n=$(( $(cat "$FAKE_DIR/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAKE_DIR/count"
printf '%s\\n' "$@" >> "$FAKE_DIR/args"
f="$FAKE_DIR/call$n"
[ -f "$f" ] || f="$FAKE_DIR/call_last"
. "$f"
"""
FAKE_SLEEP = """#!/usr/bin/env bash
echo "$1" >> "$FAKE_DIR/sleeps"
"""
SHA = "a" * 40
OTHER_SHA = "b" * 40


class VerifyReleaseTagTest(unittest.TestCase):
    """``verify_release_tag.sh`` fails closed and retries only transient lookup errors."""

    def setUp(self) -> None:
        """Put a fake ``gh`` and a recording ``sleep`` first on PATH."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        for name, body in (("gh", FAKE_GH), ("sleep", FAKE_SLEEP)):
            path = self.tmp / name
            path.write_text(body)
            path.chmod(0o755)

    def calls(self, *snippets: str) -> None:
        """Script the fake ``gh``: one shell snippet per call, the last repeating."""
        for i, snippet in enumerate(snippets, 1):
            (self.tmp / f"call{i}").write_text(snippet)
        (self.tmp / "call_last").write_text(snippets[-1])

    def run_script(self, *, expected: str = SHA, **env: str) -> subprocess.CompletedProcess[str]:
        """Run the script for tag ``v1`` and ``expected``."""
        return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
            [str(SCRIPTS / "verify_release_tag.sh"), "o/r", "v1", expected],
            env={
                **os.environ,
                "PATH": f"{self.tmp}{os.pathsep}{os.environ['PATH']}",
                "FAKE_DIR": str(self.tmp),
                **env,
            },
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def count(self) -> int:
        """How many times the fake ``gh`` ran."""
        return int((self.tmp / "count").read_text())

    def sleeps(self) -> list[int]:
        """The delays the script asked to sleep, in order."""
        path = self.tmp / "sleeps"
        return [int(x) for x in path.read_text().split()] if path.exists() else []

    def test_matching_tag_passes(self) -> None:
        """A tag at the expected commit passes on the first lookup."""
        self.calls(f"echo {SHA}")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.count(), 1)
        self.assertIn("repos/o/r/commits/refs/tags/v1", (self.tmp / "args").read_text())

    def test_tag_at_another_commit_fails(self) -> None:
        """A tag at a different commit fails with the next-version advice."""
        self.calls(f"echo {OTHER_SHA}")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("already exists at commit", result.stdout)
        self.assertEqual(self.count(), 1)

    def test_missing_tag_fails_at_once_without_claiming_the_release_must_go(self) -> None:
        """A 404/422 is not retried; the message covers a deleted tag and one not yet visible."""
        for status in (404, 422):
            (self.tmp / "count").unlink(missing_ok=True)
            self.calls(f"echo 'gh: Not Found (HTTP {status})' >&2; exit 1")
            result = self.run_script()
            self.assertEqual(result.returncode, 1, status)
            self.assertEqual(self.count(), 1, status)
            self.assertIn("does not resolve", result.stdout)
            self.assertIn("re-run this job", result.stdout)
            self.assertNotIn("will not help", result.stdout)

    def test_permanent_error_is_not_retried(self) -> None:
        """A 401 or a 403 that is not a rate limit fails at once."""
        self.calls("echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.count(), 1)
        self.assertIn("after 1 attempt(s)", result.stdout)

    def test_transient_errors_are_retried_then_pass(self) -> None:
        """A 502, a rate limit and a network error each retry; the next lookup can pass."""
        self.calls(
            "echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1",
            "echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1",
            "echo 'error connecting to api.github.com' >&2; exit 1",
            f"echo {SHA}",
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.count(), 4)
        self.assertEqual(self.sleeps(), [5, 10, 20])

    def test_retry_window_outlasts_a_minute_long_rate_limit(self) -> None:
        """Six attempts back off 5, 10, 20, 40, 60 seconds: over two minutes before giving up."""
        self.calls("echo 'gh: Too Many Requests (HTTP 429)' >&2; exit 1")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.count(), 6)
        self.assertEqual(self.sleeps(), [5, 10, 20, 40, 60])
        self.assertGreaterEqual(sum(self.sleeps()), 120)
        self.assertIn("after 6 attempt(s)", result.stdout)
        self.assertIn("rate limit", result.stdout)

    def test_empty_sha_is_reported_as_such(self) -> None:
        """gh succeeding with no sha is not 'could not resolve'."""
        self.calls("true")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("answered without a commit sha", result.stdout)
        self.assertNotIn("Could not resolve", result.stdout)

    def test_empty_sha_with_stderr_noise_is_still_reported_as_empty(self) -> None:
        """A successful call that only warns on stderr is still 'no sha', not 'see above'."""
        self.calls("echo 'gh: a new release is available' >&2")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("answered without a commit sha", result.stdout)

    def test_missing_gh_or_token_is_not_retried(self) -> None:
        """No `gh` (exit 127) or no GH_TOKEN fails at once instead of backing off."""
        self.calls("echo 'gh: command not found' >&2; exit 127")
        self.assertEqual(self.run_script().returncode, 1)
        self.assertEqual(self.count(), 1)
        (self.tmp / "count").unlink()
        # gh's own messages (cli/cli): automation, GitHub Actions and interactive.
        for message in (
            "gh: To use GitHub CLI in automation, set the GH_TOKEN environment variable.",
            "gh: To use GitHub CLI in automation, set the GH_ENTERPRISE_TOKEN environment variable.",
            "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment "
            "variable. Example:",
            "To get started with GitHub CLI, please run:  gh auth login\n"
            "Alternatively, populate the GH_TOKEN environment variable with a GitHub API "
            "authentication token.",
        ):
            (self.tmp / "count").unlink(missing_ok=True)
            self.calls(f"printf '%b\\n' '{message}' >&2; exit 4")
            self.assertEqual(self.run_script().returncode, 1, message)
            self.assertEqual(self.count(), 1, message)
        self.assertEqual(self.sleeps(), [])

    def test_other_stderr_mentioning_gh_token_is_still_retried(self) -> None:
        """Only gh's missing-token message is permanent; a 502 that names GH_TOKEN retries."""
        self.calls(
            "echo 'gh: Bad gateway (HTTP 502); GH_TOKEN was used' >&2; exit 1",
            f"echo {SHA}",
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.count(), 2)

    def test_attempts_and_delay_are_configurable(self) -> None:
        """TAG_LOOKUP_ATTEMPTS and TAG_LOOKUP_DELAY override the defaults."""
        self.calls("echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1")
        self.run_script(TAG_LOOKUP_ATTEMPTS="3", TAG_LOOKUP_DELAY="1")
        self.assertEqual(self.count(), 3)
        self.assertEqual(self.sleeps(), [1, 2])

    def test_invalid_knobs_fail_before_any_lookup(self) -> None:
        """A non-numeric or zero attempt count, or a non-numeric delay, is rejected up front."""
        self.calls(f"echo {SHA}")
        for name, value in (
            ("TAG_LOOKUP_ATTEMPTS", "0"),
            ("TAG_LOOKUP_ATTEMPTS", "abc"),
            ("TAG_LOOKUP_ATTEMPTS", "-1"),
            ("TAG_LOOKUP_DELAY", "1.5"),
            ("TAG_LOOKUP_DELAY", "x"),
            ("TAG_LOOKUP_DELAY", "-3"),
            ("TAG_LOOKUP_DELAY", "08"),
            ("TAG_LOOKUP_ATTEMPTS", "100"),
        ):
            with self.subTest(name=name, value=value):
                result = self.run_script(**{name: value})
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(f"::error::{name} must be", result.stderr)
                self.assertFalse((self.tmp / "count").exists())

    def test_zero_delay_is_allowed(self) -> None:
        """A delay of 0 is valid (no wait between attempts)."""
        self.calls(f"echo {SHA}")
        self.assertEqual(self.run_script(TAG_LOOKUP_DELAY="0").returncode, 0)

    def test_every_attempts_stderr_is_logged(self) -> None:
        """Earlier attempts' errors stay in the log, labelled with their attempt."""
        self.calls(
            "echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1",
            "echo 'error connecting to api.github.com' >&2; exit 1",
            f"echo {SHA}",
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("attempt 1/6: gh: Bad Gateway (HTTP 502)", result.stderr)
        self.assertIn("attempt 2/6: error connecting to api.github.com", result.stderr)

    def test_workflow_uses_the_script(self) -> None:
        """release.yml delegates to the script instead of an inline lookup."""
        text = (SCRIPTS.parent / "workflows" / "release.yml").read_text()
        self.assertIn(".github/scripts/verify_release_tag.sh", text)
        self.assertNotIn("commits/refs/tags", text)


class DevelopScriptTest(unittest.TestCase):
    """``scripts/develop.sh``: bounded retries, and no unverified download is ever run."""

    text = (SCRIPTS.parents[1] / "scripts" / "develop.sh").read_text()

    def test_retried_steps_do_not_download(self) -> None:
        """A function passed to ``retry`` never calls ``fetch`` (retries would multiply)."""
        retried = re.findall(r"^retry (\w+)", self.text, re.MULTILINE)
        self.assertGreaterEqual(len(retried), 1)
        for name in retried:
            body = re.search(rf"^{name}\(\) \{{\n(.*?)^\}}", self.text, re.MULTILINE | re.DOTALL)
            self.assertIsNotNone(body, name)
            self.assertNotRegex(body.group(1), r"\bfetch(_checked)?\b", name)  # type: ignore[union-attr]

    def test_no_vendor_installer_script_is_run(self) -> None:
        """uv, prek and Claude Code are verified binaries, never a downloaded install script."""
        self.assertNotRegex(self.text, r"installer\.sh|claude\.ai/install|/install\.sh")
        self.assertNotIn("download_installer", self.text)
        for tool in ("uv", "prek"):
            self.assertRegex(
                self.text, rf'fetch_checked "https://github\.com/[^"]*/\${{{tool}_asset}}\.tar\.gz"'
            )
        self.assertIn("install_claude ", self.text)
        self.assertRegex(self.text, r"(?m)^claude_signing_fpr=[0-9A-F]{40}$")

    def run_bash(
        self, functions: tuple[str, ...], body: str, curl_body: str
    ) -> tuple[subprocess.CompletedProcess[str], int]:
        """Run ``body`` with ``develop.sh``'s helper functions and a fake ``curl``; return it and the curl call count."""
        parts = []
        for name in functions:
            found = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", self.text, re.MULTILINE | re.DOTALL)
            self.assertIsNotNone(found, name)
            parts.append(found.group(0))  # type: ignore[union-attr]
        with tempfile.TemporaryDirectory() as tmp:
            for name, content in (
                ("curl", f'#!/usr/bin/env bash\necho x >> "{tmp}/calls"\n{curl_body}\n'),
                ("sleep", "#!/usr/bin/env bash\nexit 0\n"),
            ):
                path = Path(tmp) / name
                path.write_text(content)
                path.chmod(0o755)
            (Path(tmp) / "calls").touch()
            script = (
                'set -euo pipefail\ncleanup_paths=()\ntmp_result=""\nfetch_label=""\n'
                + "".join(parts)
                + body.replace("TMP", tmp)
            )
            result = subprocess.run(  # noqa: S603 -- fixed argv
                ["bash", "-c", script],  # noqa: S607
                env={**os.environ, "PATH": f"{tmp}{os.pathsep}{os.environ['PATH']}"},
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            calls = (Path(tmp) / "calls").read_text().count("x")
        return result, calls

    def run_fetch(self, curl_body: str) -> tuple[subprocess.CompletedProcess[str], int]:
        """Run one labelled ``fetch`` against a fake ``curl``."""
        return self.run_bash(
            ("tmp_path", "fetch"),
            'fetch_label="uv tarball" fetch "https://example.invalid/uv.tar.gz" -o TMP/out\necho not-reached\n',
            curl_body,
        )

    def test_failed_download_names_what_failed(self) -> None:
        """A permanent download failure says which download failed, and still aborts."""
        result, calls = self.run_fetch("echo 'curl: (22) 404' >&2\nexit 22")
        self.assertEqual(result.returncode, 22, result.stderr)
        self.assertEqual(calls, 1)
        self.assertNotIn("not-reached", result.stdout)
        self.assertIn("uv tarball", result.stderr)
        self.assertIn("https://example.invalid/uv.tar.gz", result.stderr)
        self.assertIn("curl exit 22", result.stderr)

    def test_transient_curl_failures_are_retried_by_fetch(self) -> None:
        """DNS (6) and connect (7) failures retry inside fetch, not abort."""
        for status in (6, 7):
            with self.subTest(status=status):
                # Fail twice, then write the file to the -o target.
                body = (
                    f'n=$(wc -l < "$(dirname "$0")/calls")\n'
                    f"if [ $n -le 2 ]; then echo 'curl: ({status})' >&2; exit {status}; fi\n"
                    'while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done\n'
                    'echo script > "$out"\n'
                )
                result, calls = self.run_fetch(body)
                self.assertIn("not-reached", result.stdout)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls, 3)

    def test_persistent_curl_failure_gives_up_after_bounded_retries(self) -> None:
        """A DNS failure that never clears aborts after 4 tries, naming the download."""
        result, calls = self.run_fetch("exit 6")
        self.assertEqual(result.returncode, 6, result.stderr)
        self.assertEqual(calls, 4)
        self.assertIn("uv tarball", result.stderr)

    def run_fetch_checked(self, checksum_line: str) -> subprocess.CompletedProcess[str]:
        """Run ``fetch_checked`` against a fake ``curl`` serving ``tool.tar.gz`` and ``checksum_line``."""
        curl_body = (
            'while [ $# -gt 0 ]; do case "$1" in -o) out=$2;; http*) url=$1;; esac; shift; done\n'
            f'case "$url" in *.sha256) printf \'%s\\n\' \'{checksum_line}\' > "$out";; *) printf payload > "$out";; esac\n'
        )
        result, _ = self.run_bash(
            ("tmp_path", "fetch", "fetch_checked"),
            'tmp_path -d\nfetch_checked "https://example.invalid/tool.tar.gz" "$tmp_result"\necho verified\n',
            curl_body,
        )
        return result

    def test_fetch_checked_accepts_a_matching_checksum(self) -> None:
        """The file is accepted when the published checksum for its own name matches."""
        digest = hashlib.sha256(b"payload").hexdigest()
        result = self.run_fetch_checked(f"{digest}  tool.tar.gz")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("verified", result.stdout)

    def test_fetch_checked_rejects_a_wrong_or_missing_checksum(self) -> None:
        """A mismatching checksum, or one listed for another name, aborts before anything is used."""
        digest = hashlib.sha256(b"payload").hexdigest()
        for line in (f"{'0' * 64}  tool.tar.gz", f"{digest}  other.tar.gz", ""):
            with self.subTest(line=line):
                result = self.run_fetch_checked(line)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("verified", result.stdout)

    @staticmethod
    def gpg_key(home: Path, name: str) -> tuple[str, bytes]:
        """Create a throwaway signing key in ``home``; return its fingerprint and armored public key."""
        env = {**os.environ, "GNUPGHOME": str(home)}
        base = ["gpg", "--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase", ""]
        subprocess.run(  # noqa: S603 -- fixed argv
            [
                *base,
                "--quick-generate-key",
                f"{name} <{name}@example.invalid>",
                "ed25519",
                "sign",
                "never",
            ],
            env=env,
            check=True,
            capture_output=True,
            timeout=60,
        )
        colons = subprocess.run(  # noqa: S603 -- fixed argv
            ["gpg", "--batch", "--with-colons", "--list-keys", name],  # noqa: S607
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout
        fpr = next(line.split(":")[9] for line in colons.splitlines() if line.startswith("fpr"))
        armored = subprocess.run(  # noqa: S603 -- fixed argv
            ["gpg", "--batch", "--armor", "--export", name],  # noqa: S607
            env=env,
            check=True,
            capture_output=True,
            timeout=60,
        ).stdout
        return fpr, armored

    def run_install_claude(
        self,
        *,
        pin: str = "good",
        signer: str = "good",
        manifest_version: str = "1.2.3",
        manifest_checksum: str | None = None,
        binary: bytes = b"claude-binary",
    ) -> subprocess.CompletedProcess[str]:
        """Run ``install_claude`` against a fake ``curl`` serving a key, a manifest signed by ``signer``, and ``binary``.

        ``pin`` and ``signer`` pick which of two throwaway keys (``good``,
        ``other``) is the pinned fingerprint and which signs the manifest;
        the served key is always ``good``.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            homes = {}
            for name in ("good", "other"):
                homes[name] = root / f"gh-{name}"
                homes[name].mkdir(mode=0o700)
            try:
                keys = {name: self.gpg_key(homes[name], name) for name in homes}
                if manifest_checksum is None:
                    manifest_checksum = hashlib.sha256(b"claude-binary").hexdigest()
                manifest = json.dumps(
                    {
                        "version": manifest_version,
                        "platforms": {"linux-x64": {"checksum": manifest_checksum}},
                    }
                )
                served = root / "served"
                served.mkdir()
                (served / "key.asc").write_bytes(keys["good"][1])
                (served / "manifest.json").write_text(manifest)
                (served / "claude").write_bytes(binary)
                subprocess.run(  # noqa: S603 -- fixed argv
                    [
                        "gpg",
                        "--batch",
                        "--quiet",
                        "--local-user",
                        keys[signer][0],
                        "--detach-sign",
                        "-o",
                        str(served / "manifest.json.sig"),
                        str(served / "manifest.json"),
                    ],  # noqa: S607
                    env={**os.environ, "GNUPGHOME": str(homes[signer])},
                    check=True,
                    capture_output=True,
                    timeout=60,
                )
            finally:
                for home in homes.values():
                    subprocess.run(  # noqa: S603 -- fixed argv
                        ["gpgconf", "--homedir", str(home), "--kill", "all"],  # noqa: S607
                        check=False,
                        capture_output=True,
                        timeout=30,
                    )
            curl_body = (
                'while [ $# -gt 0 ]; do case "$1" in -o) out=$2;; http*) url=$1;; esac; shift; done\n'
                f'name="${{url##*/}}"; [ "$name" = claude-code.asc ] && name=key.asc\n'
                f'cp "{served}/$name" "$out"\n'
            )
            result, _ = self.run_bash(
                ("tmp_path", "fetch", "install_claude"),
                f"claude_signing_fpr={keys[pin][0]}\n"
                "claude_release_base=https://example.invalid/releases\n"
                "claude_key_url=https://example.invalid/claude-code.asc\n"
                "sudo() { echo SUDO-RAN; }\n"
                'tmp_path -d\ninstall_claude 1.2.3 linux-x64 /cfg "$tmp_result"\n',
                curl_body,
            )
        return result

    @unittest.skipUnless(shutil.which("gpg") and shutil.which("jq"), "needs gpg and jq")
    def test_install_claude_installs_a_verified_release(self) -> None:
        """The control: a pinned key, a manifest it signed and a matching binary install."""
        result = self.run_install_claude()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SUDO-RAN", result.stdout)

    @unittest.skipUnless(shutil.which("gpg") and shutil.which("jq"), "needs gpg and jq")
    def test_install_claude_fails_closed(self) -> None:
        """Each broken link in the chain stops the install before the binary is run."""
        digest = hashlib.sha256(b"claude-binary").hexdigest()
        cases = {
            "served key is not the pinned fingerprint": ({"pin": "other"}, "fingerprint"),
            "manifest signed by another key": ({"signer": "other"}, "not signed by"),
            "manifest is for another version": ({"manifest_version": "9.9.9"}, "expected 1.2.3"),
            "manifest checksum is not hex": ({"manifest_checksum": "zz" * 32}, "no valid checksum"),
            "manifest checksum is too short": (
                {"manifest_checksum": digest[:40]},
                "no valid checksum",
            ),
            "binary does not match the manifest": ({"binary": b"tampered"}, "FAILED"),
        }
        for label, (kwargs, message) in cases.items():
            with self.subTest(label):
                result = self.run_install_claude(**kwargs)  # type: ignore[arg-type]
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SUDO-RAN", result.stdout)
                self.assertIn(message, result.stderr + result.stdout)


class ReleaseWorkflowGuardTest(unittest.TestCase):
    """``release.yml`` runs only from the default branch."""

    text = (SCRIPTS.parent / "workflows" / "release.yml").read_text()
    guard = "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"

    def job(self, name: str) -> str:
        """Return the text of top-level job ``name``."""
        found = re.search(
            rf"^  {name}:\n(.*?)(?=^  [a-z][\w-]*:\n|\Z)", self.text, re.MULTILINE | re.DOTALL
        )
        self.assertIsNotNone(found, name)
        return found.group(1)  # type: ignore[union-attr]

    def test_version_job_fails_first_on_another_ref(self) -> None:
        """The first step of the job every other job needs refuses a non-default ref."""
        version = self.job("version")
        first_step = version.split("steps:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("refs/heads/${{ github.event.repository.default_branch }}", first_step)
        self.assertIn("exit 1", first_step)

    def test_every_job_with_write_permissions_or_secrets_is_gated(self) -> None:
        """Jobs holding ``contents: write``, ``packages: write``, ``id-token`` or secrets check the ref."""
        for name in ("build", "release", "publish-packages"):
            with self.subTest(job=name):
                self.assertIn(self.guard, self.job(name))
        # Nothing else gets write permissions or secrets without needing the version job.
        for match in re.finditer(
            r"^  ([a-z][\w-]*):\n", self.text.split("\njobs:\n", 1)[1], re.MULTILINE
        ):
            name = match.group(1)
            if name != "version":
                self.assertRegex(self.job(name), r"needs: ", name)

    def test_privileged_jobs_declare_the_release_environment(self) -> None:
        """Jobs with write permissions, an OIDC token or secrets run in ``release``, and no others."""
        # Any write permission (including write-all), any OIDC token, and any
        # reference to secrets other than GITHUB_TOKEN (dotted, bracketed,
        # `secrets: inherit`, or the whole context).
        privileged = re.compile(
            r"[\w-]+: write\b|write-all|secrets\s*:\s*inherit"
            r"|secrets\s*\[|secrets\s*\.\s*(?!GITHUB_TOKEN\b)"
        )
        names = re.findall(r"^  ([a-z][\w-]*):\n", self.text.split("\njobs:\n", 1)[1], re.MULTILINE)
        found = []
        for name in names:
            # Comments mention these keys too; only the YAML itself counts.
            body = "\n".join(
                line for line in self.job(name).splitlines() if not line.lstrip().startswith("#")
            )
            has_env = re.search(r"^    environment: release$", body, re.MULTILINE) is not None
            with self.subTest(job=name):
                self.assertEqual(has_env, bool(privileged.search(body)))
            if has_env:
                found.append(name)
        self.assertTrue(found, "no job declares environment: release")

    def test_environment_is_a_plain_name_not_an_expression(self) -> None:
        """A dispatcher-controlled expression could pick an unrestricted environment."""
        matches = list(re.finditer(r"^[ \t]+environment:[ \t]*(.*)$", self.text, re.MULTILINE))
        self.assertTrue(matches, "no environment: line found")
        for match in matches:
            self.assertEqual(match.group(1).strip(), "release")

    def test_environment_is_documented_for_instances(self) -> None:
        """The setup step and the allowed-secrets move are in the instance-facing docs."""
        docs = SCRIPTS.parent.parent / "docs" / "TEMPLATE.md"
        text = docs.read_text()
        self.assertIn("Release environment", text)
        self.assertIn("gh secret set NAME --env release", text)
        readme = (SCRIPTS.parent / "workflows" / "README.md").read_text()
        self.assertIn("environment: release", readme)

    def test_release_is_created_at_the_dispatched_sha(self) -> None:
        """The tag and release target ``github.sha``, the tip of the (default) branch dispatched."""
        self.assertIn("TARGET_SHA: ${{ github.sha }}", self.text)
        self.assertIn('--target "$TARGET_SHA"', self.text)


if __name__ == "__main__":
    unittest.main()
