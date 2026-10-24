"""Tests for ``template_sync.py`` and the executable bits CI relies on.

Stdlib ``unittest`` only (see this directory's README); run with
``python3 -m unittest discover -s .github/scripts -p 'test_*.py'`` -- the
``scripts-tests`` prek hook does exactly that.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

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
        # The v1.8.0 bug: the template fixed 644 -> 755 with no content change.
        """Same content, template executable: the instance copy becomes executable."""
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
        # .claude/settings.json runs it directly as a hook command.
        """The Claude hook script is executable."""
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
