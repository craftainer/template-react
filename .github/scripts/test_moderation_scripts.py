"""Tests for ``find_moderation_result.sh`` (the apply workflows' artifact lookup)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
# Stands in for `gh api ... --jq FILTER`: records its arguments, runs the real
# jq filter over the canned response in $FAKE_RESPONSE, or fails like gh does.
FAKE_GH = """#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_ARGS"
[ -z "${FAKE_FAIL:-}" ] || { echo "gh: boom (HTTP 500)" >&2; exit 1; }
while [ $# -gt 0 ] && [ "$1" != "--jq" ]; do shift; done
[ $# -gt 0 ] || { echo "fake gh: no --jq" >&2; exit 3; }
jq -r "$2" "$FAKE_RESPONSE"
"""


@unittest.skipUnless(shutil.which("jq"), "jq not installed (the fake gh runs the real filter)")
class FindModerationResultTest(unittest.TestCase):
    """The lookup reports found/missing/expired and never hides an API failure."""

    def setUp(self) -> None:
        """Put a fake ``gh`` first on PATH inside a temp dir."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        gh = self.tmp / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)

    def run_script(
        self, artifacts: list[dict[str, object]], *, fail: bool = False
    ) -> subprocess.CompletedProcess[str]:
        """Run the script against a canned artifacts response."""
        (self.tmp / "response.json").write_text(json.dumps({"artifacts": artifacts}))
        env = {
            **os.environ,
            "PATH": f"{self.tmp}{os.pathsep}{os.environ['PATH']}",
            "FAKE_RESPONSE": str(self.tmp / "response.json"),
            "FAKE_ARGS": str(self.tmp / "args.txt"),
            "GITHUB_OUTPUT": str(self.tmp / "output.txt"),
            "FAKE_FAIL": "1" if fail else "",
        }
        return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
            [str(SCRIPTS / "find_moderation_result.sh"), "o/r", "42"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def output(self) -> str:
        """Return what the script wrote to ``$GITHUB_OUTPUT``."""
        return (self.tmp / "output.txt").read_text().strip()

    def test_live_artifact_is_found(self) -> None:
        """A non-expired artifact gives ``found=true``."""
        result = self.run_script([{"name": "moderation-result", "expired": False}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output(), "found=true")

    def test_queries_by_name(self) -> None:
        """The artifact is requested by name, so it is found past the first 30."""
        self.run_script([])
        args = (self.tmp / "args.txt").read_text()
        self.assertIn("repos/o/r/actions/runs/42/artifacts?name=moderation-result", args)

    def test_no_artifact_is_not_found_and_not_an_error(self) -> None:
        """A skipped worker run leaves no artifact: ``found=false``, exit 0."""
        result = self.run_script([])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output(), "found=false")
        self.assertNotIn("::notice::", result.stdout)

    def test_expired_artifact_logs_a_notice(self) -> None:
        """An expired artifact is ``found=false`` with an explicit notice."""
        result = self.run_script([{"name": "moderation-result", "expired": True}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output(), "found=false")
        self.assertIn("::notice::", result.stdout)
        self.assertIn("expired", result.stdout)

    def test_api_failure_fails_the_script(self) -> None:
        """A failing ``gh`` is an error, never reported as 'no result'."""
        result = self.run_script([], fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.tmp / "output.txt").exists())


if __name__ == "__main__":
    unittest.main()
