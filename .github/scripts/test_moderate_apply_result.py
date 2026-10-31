"""Tests for ``moderate_apply_result.sh`` (the privileged apply step of the moderation pipeline)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
# Both fakes append their argv (one line per call) to $FAKE_LOG. A call fails
# when "<tool> <argv>" starts with any "|"-separated prefix in $FAKE_FAIL
# (the call is still logged). The fake gh answers `issue view` with
# $FAKE_LABELS and `pr list` with $FAKE_PR_URL; the fake git answers
# `ls-remote` with $FAKE_REMOTE_SHA.
FAKE_COMMON = """CALL="$TOOL $*"
echo "$CALL" >> "$FAKE_LOG"
IFS='|'
for prefix in ${FAKE_FAIL:-}; do
  case "$CALL" in "$prefix"*) echo "fake $TOOL: failing '$prefix'" >&2; exit 1;; esac
done
unset IFS
"""
FAKE_GH = (
    "#!/usr/bin/env bash\nTOOL=gh\n"
    + FAKE_COMMON
    + """[ "$1 $2" != "issue view" ] || printf '%s\\n' $FAKE_LABELS
[ "$1 $2" != "pr list" ] || printf '%s\\n' "${FAKE_PR_URL:-}"
"""
)
FAKE_GIT = (
    "#!/usr/bin/env bash\nTOOL=git\n"
    + FAKE_COMMON
    + """[ "$1" != ls-remote ] || { [ -z "${FAKE_REMOTE_SHA:-}" ] || printf '%s\\trefs/heads/x\\n' "$FAKE_REMOTE_SHA"; }
"""
)

ARGS = ["bug", "repro", "bug:repro-ready", "bug:fixed", "Fixes"]
BRANCH = "bug/7-repro"
READY = "bug bug:repro-ready"
SETUP = [
    "git config user.name claude-moderator[bot]",
    "git config user.email claude-moderator[bot]@users.noreply.github.com",
    "git fetch --depth=1 origin abc123",
    f"git checkout -B {BRANCH} FETCH_HEAD",
    "git am {result}/patch.diff",
]
PR_CREATE = [
    "gh pr create --title fix: the thing --body details",
    "",
    f"Fixes #7 --base main --head {BRANCH}",
]
SWAP = "gh issue edit 7 --remove-label bug:repro-ready --remove-label needs-human --add-label bug:fixed"
NEEDS_HUMAN = "gh issue edit 7 --add-label needs-human"
VIEW = "gh issue view 7 --json labels --jq .labels[].name"
LIST = f'gh pr list --head {BRANCH} --state open --json number,url --jq .[0].url // ""'


@unittest.skipUnless(shutil.which("jq"), "jq not installed (the script parses meta.json with it)")
class ApplyResultTest(unittest.TestCase):
    """Argument order, success ordering and the failure path."""

    def setUp(self) -> None:
        """Put fake ``gh`` and ``git`` first on PATH inside a temp dir."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        for name, body in (("gh", FAKE_GH), ("git", FAKE_GIT)):
            exe = self.tmp / "bin" / name
            exe.parent.mkdir(exist_ok=True)
            exe.write_text(body)
            exe.chmod(0o755)
        self.result = self.tmp / "result"
        self.result.mkdir()

    def run_script(
        self,
        outcome: str = "built",
        labels: str = READY,
        fail: str = "",
        remote_sha: str = "",
        pr_url: str = "",
        run_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run the script against a canned ``meta.json``."""
        meta = {
            "issue_number": "7",
            "base_sha": "abc123",
            "outcome": outcome,
            "subject": "fix: the thing",
            "body": "details",
        }
        (self.result / "meta.json").write_text(json.dumps(meta))
        env = {
            **os.environ,
            "PATH": f"{self.tmp / 'bin'}{os.pathsep}{os.environ['PATH']}",
            "FAKE_LOG": str(self.tmp / "log.txt"),
            "FAKE_LABELS": labels,
            "FAKE_FAIL": fail,
            "FAKE_REMOTE_SHA": remote_sha,
            "FAKE_PR_URL": pr_url,
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_REPOSITORY": "o/r",
            "GITHUB_RUN_ID": "99",
            **(run_env or {}),
        }
        return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
            [str(SCRIPTS / "moderate_apply_result.sh"), str(self.result), *ARGS],
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def log(self) -> list[str]:
        """Return the recorded fake-command calls, in order."""
        path = self.tmp / "log.txt"
        return path.read_text().splitlines() if path.exists() else []

    def setup_calls(self) -> list[str]:
        """Return the expected git calls up to and including ``git am``."""
        return [c.format(result=self.result) for c in SETUP]

    def push(self, expected: str = "") -> str:
        """Return the expected push call, leased on ``expected``."""
        return f"git push --force-with-lease={BRANCH}:{expected} origin {BRANCH}"

    def assert_failed_cleanly(self, proc: subprocess.CompletedProcess[str], log: list[str]) -> None:
        """Assert needs-human came before the comment, and the stage never moved."""
        self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertNotIn(SWAP, log)
        nh = log.index(NEEDS_HUMAN)
        comment = next(i for i, c in enumerate(log) if c.startswith("gh issue comment 7"))
        self.assertLess(nh, comment)
        self.assertIn("See https://github.com/o/r/actions/runs/99.", log[comment])

    def test_happy_path(self) -> None:
        """Exactly these calls, in order: no PR yet, so one is created, then one label swap."""
        proc = self.run_script()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.log(),
            [
                VIEW,
                *self.setup_calls(),
                f"git ls-remote origin refs/heads/{BRANCH}",
                self.push(),
                LIST,
            ]
            + PR_CREATE
            + [SWAP],
        )

    def test_am_fails(self) -> None:
        """A failing ``git am`` stops before any push or PR; the stage stays ready."""
        proc = self.run_script(fail="git am")
        log = self.log()
        self.assertEqual(log[: len(self.setup_calls()) + 1], [VIEW, *self.setup_calls()])
        self.assertFalse([c for c in log if c.startswith(("git push", "gh pr"))])
        self.assert_failed_cleanly(proc, log)

    def test_push_fails(self) -> None:
        """A failing push opens no PR and leaves the stage ready."""
        proc = self.run_script(fail="git push")
        log = self.log()
        self.assertIn(self.push(), log)
        self.assertFalse([c for c in log if c.startswith("gh pr")])
        self.assert_failed_cleanly(proc, log)

    def test_pr_create_fails(self) -> None:
        """Push succeeded, PR creation failed: stage stays ready, needs-human is added."""
        proc = self.run_script(fail="gh pr create")
        log = self.log()
        self.assertIn(self.push(), log)
        self.assertIn(PR_CREATE[0], log)
        self.assert_failed_cleanly(proc, log)

    def test_label_edit_fails_after_pr(self) -> None:
        """The PR exists but the swap failed: handled as a failure, and a retry reuses the PR."""
        proc = self.run_script(fail=SWAP)
        log = self.log()
        self.assertLess(log.index(PR_CREATE[0]), log.index(SWAP))
        self.assertEqual(log.count(SWAP), 1)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertIn(NEEDS_HUMAN, log)
        self.assertTrue([c for c in log if c.startswith("gh issue comment 7")])
        # The retry: PR already open, remote tip is the earlier attempt's SHA.
        (self.tmp / "log.txt").unlink()
        retry = self.run_script(remote_sha="def456", pr_url="https://github.com/o/r/pull/8")
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(
            self.log(),
            [
                VIEW,
                *self.setup_calls(),
                f"git ls-remote origin refs/heads/{BRANCH}",
                "git fetch --depth=100 origin abc123 def456",
                "git merge-base --is-ancestor abc123 def456",
                self.push("def456"),
                LIST,
                SWAP,
            ],
        )

    def test_comment_fails_inside_fail(self) -> None:
        """A failed comment doesn't stop needs-human (added first) and still exits non-zero."""
        proc = self.run_script(fail="git push|gh issue comment")
        log = self.log()
        self.assertEqual(proc.returncode, 1)
        self.assertIn(NEEDS_HUMAN, log)
        self.assertLess(
            log.index(NEEDS_HUMAN),
            next(i for i, c in enumerate(log) if c.startswith("gh issue comment")),
        )
        self.assertNotIn(SWAP, log)

    def test_fail_omits_run_link_without_env(self) -> None:
        """With any of the run-URL parts empty, the comment has no link."""
        proc = self.run_script(fail="git push", run_env={"GITHUB_RUN_ID": ""})
        comment = next(c for c in self.log() if c.startswith("gh issue comment 7"))
        self.assertEqual(proc.returncode, 1)
        self.assertNotIn("actions/runs", comment)
        self.assertNotIn("See ", comment)

    def test_retry_after_partial_first_run(self) -> None:
        """Remote branch at an earlier attempt's SHA and PR already open: leased push, no new PR."""
        proc = self.run_script(remote_sha="def456", pr_url="https://github.com/o/r/pull/8")
        log = self.log()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn(self.push("def456"), log)
        self.assertNotIn(
            "--force",
            " ".join(c for c in log if c.startswith("git push")).replace("--force-with-lease", ""),
        )
        self.assertFalse([c for c in log if c.startswith("gh pr create")])
        self.assertEqual(log[-2:], [LIST, SWAP])

    def test_retry_after_failure_clears_needs_human(self) -> None:
        """An earlier failure left needs-human on the issue: the one success edit removes it."""
        proc = self.run_script(labels="bug:repro-ready needs-human")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            [c for c in self.log() if c.startswith("gh issue edit")],
            [
                "gh issue edit 7 --remove-label bug:repro-ready --remove-label needs-human --add-label bug:fixed"
            ],
        )

    def test_retry_refuses_foreign_branch_tip(self) -> None:
        """A remote tip that doesn't descend from the base SHA is never overwritten."""
        proc = self.run_script(remote_sha="def456", fail="git merge-base")
        log = self.log()
        self.assertFalse([c for c in log if c.startswith(("git push", "gh pr"))])
        self.assert_failed_cleanly(proc, log)

    def test_remote_branch_at_base_sha_is_pushed_with_lease(self) -> None:
        """First run: the triage branch sits at the base SHA, so no ancestry check is needed."""
        proc = self.run_script(remote_sha="abc123")
        log = self.log()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn(self.push("abc123"), log)
        self.assertFalse([c for c in log if c.startswith("git merge-base")])

    def test_not_built_outcome_comments_and_flags_needs_human(self) -> None:
        """A non-built outcome posts Claude's note, adds needs-human and keeps the ready label."""
        proc = self.run_script(outcome="needs-human")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.log(), [VIEW, NEEDS_HUMAN, "gh issue comment 7 --body details"])

    def test_already_processed_is_a_noop(self) -> None:
        """Without the ready label the script only reads the labels."""
        proc = self.run_script(labels="bug")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.log(), [VIEW])


if __name__ == "__main__":
    unittest.main()
