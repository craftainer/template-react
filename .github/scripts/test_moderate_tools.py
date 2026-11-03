"""Tests for the moderation helpers that run next to Claude: path allow-list, packaging, launcher."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
}


def run(
    argv: list[str], cwd: Path | None = None, env: dict[str, str] | None = None, stdin: bytes = b""
) -> subprocess.CompletedProcess[bytes]:
    """Run a fixed argv with a merged environment."""
    return subprocess.run(  # noqa: S603 -- fixed argv, trusted scripts
        argv,
        cwd=cwd,
        env={**os.environ, **GIT_ENV, **(env or {})},
        input=stdin,
        capture_output=True,
        check=False,
        timeout=60,
    )


class CheckPathsTest(unittest.TestCase):
    """``moderate_check_paths.sh`` denies what runs with credentials and allows the rest."""

    def verdict(self, *paths: str) -> int:
        """Return the script's exit status for these paths."""
        data = b"".join(p.encode() + b"\0" for p in paths)
        return run([str(SCRIPTS / "moderate_check_paths.sh")], stdin=data).returncode

    def test_denied(self) -> None:
        """Each sensitive path is refused, alone and mixed in with fine ones."""
        denied = [
            ".github/workflows/release.yml",
            ".github/scripts/run_claude.sh",
            ".github/renovate.json",
            ".devcontainer/Dockerfile",
            ".devcontainer/stack/x/compose.yml",
            ".claude/settings.json",
            ".mcp.json",
            ".pre-commit-config.yaml",
            "Makefile",
            "sub/Makefile",
            "image.mk",
            "deep/dir/build.mk",
            "scripts/release.sh",
            "scripts/release-publish.sh",
            "scripts/develop.sh",
            "scripts/post-create.d/x.sh",
            "Dockerfile",
            "app/Dockerfile.dev",
            "compose.yml",
            "svc/compose.override.yaml",
            ".gitattributes",
            ".gitmodules",
        ]
        for path in denied:
            with self.subTest(path=path):
                self.assertEqual(self.verdict(path), 1)
                self.assertEqual(self.verdict("src/ok.py", path), 1)

    def test_allowed(self) -> None:
        """Ordinary source, tests and docs pass, including look-alike names."""
        allowed = [
            "src/app/main.py",
            "tests/test_a.py",
            "docs/plans/2026-11-x.md",
            "docs/Makefile.md",
            "scripts/other.sh",
            ".githubx/y",
            "github/workflows/x.yml",
            "README.md",
        ]
        self.assertEqual(self.verdict(*allowed), 0)

    def test_empty_input(self) -> None:
        """No paths is fine."""
        self.assertEqual(self.verdict(), 0)

    def test_newline_in_a_path(self) -> None:
        """Paths are NUL-separated, so a newline inside one cannot hide a denied name."""
        self.assertEqual(self.verdict("a\n.github/x"), 0)
        self.assertEqual(self.verdict(".github/x\nb"), 1)


@unittest.skipUnless(shutil.which("jq") and shutil.which("git"), "jq and git are required")
class PackageResultTest(unittest.TestCase):
    """``moderate_package_result.sh`` reads the agent's repository without trusting it."""

    def setUp(self) -> None:
        """Create a workspace repository with one base commit."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.ws = self.tmp / "ws"
        self.ws.mkdir()
        self.git("init", "-q", "-b", "main")
        (self.ws / "a.txt").write_text("base\n")
        self.git("add", "a.txt")
        self.git("commit", "-q", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").stdout.decode().strip()
        (self.ws / ".moderation-out").mkdir()
        self.out = self.tmp / "out"

    def git(self, *args: str) -> subprocess.CompletedProcess[bytes]:
        """Run git in the workspace."""
        proc = run(["git", *args], cwd=self.ws)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc

    def commit(self, name: str, message: str = "fix: it\n\nbody text") -> None:
        """Add a file and commit it."""
        (self.ws / name).write_text("new\n")
        self.git("add", name)
        self.git("commit", "-q", "-m", message)

    def package(self, mode: str, base: str | None = None) -> dict[str, str]:
        """Run the script and return meta.json."""
        proc = run(
            [
                str(SCRIPTS / "moderate_package_result.sh"),
                base or self.base,
                str(self.out),
                str(self.ws),
                mode,
            ],
            env={"GITHUB_ISSUE_NUMBER": "7"},
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads((self.out / "meta.json").read_text())

    def test_build_with_a_commit(self) -> None:
        """A commit becomes a patch plus the commit's subject and body."""
        self.commit("b.txt")
        meta = self.package("build")
        self.assertEqual(meta["outcome"], "built")
        self.assertEqual(meta["subject"], "fix: it")
        self.assertEqual(meta["body"], "body text")
        self.assertEqual(meta["base_sha"], self.base)
        self.assertIn("b.txt", (self.out / "patch.diff").read_text())

    def test_build_with_an_explanation(self) -> None:
        """No commit but an outcome note: needs-human with the note."""
        (self.ws / ".moderation-out" / "outcome.md").write_text("stuck here")
        meta = self.package("build")
        self.assertEqual((meta["outcome"], meta["body"]), ("needs-human", "stuck here"))
        self.assertFalse((self.out / "patch.diff").exists())

    def test_build_with_nothing(self) -> None:
        """No commit and no note: failed."""
        self.assertEqual(self.package("build")["outcome"], "failed")

    def test_symlinked_note_is_not_read(self) -> None:
        """A note that is a symlink to a runner file never reaches the comment."""
        secret = self.tmp / "secret.txt"
        secret.write_text("TOPSECRET")
        (self.ws / ".moderation-out" / "outcome.md").symlink_to(secret)
        meta = self.package("build")
        self.assertEqual(meta["outcome"], "failed")
        self.assertNotIn("TOPSECRET", json.dumps(meta))

    def test_symlinked_output_directory_is_not_read(self) -> None:
        """A `.moderation-out` that points elsewhere is not read either."""
        elsewhere = self.tmp / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "outcome.md").write_text("TOPSECRET")
        shutil.rmtree(self.ws / ".moderation-out")
        (self.ws / ".moderation-out").symlink_to(elsewhere)
        meta = self.package("build")
        self.assertEqual(meta["outcome"], "failed")
        self.assertNotIn("TOPSECRET", json.dumps(meta))

    def test_rewritten_history_gives_no_patch(self) -> None:
        """When the base is no longer an ancestor of HEAD, nothing is packaged as a patch."""
        self.git("checkout", "-q", "--orphan", "other")
        self.git("rm", "-rq", "--cached", ".")
        self.commit("c.txt", "feat: unrelated")
        meta = self.package("build")
        self.assertEqual(meta["outcome"], "failed")
        self.assertFalse((self.out / "patch.diff").exists())

    def test_base_sha_must_be_hex(self) -> None:
        """A malformed base is reported as failed and never passed to git."""
        meta = self.package("build", base="--upload-pack=x")
        self.assertEqual(meta["outcome"], "failed")

    def test_triage_result(self) -> None:
        """A valid triage.json is carried over with the commit's patch."""
        self.commit("t.py")
        (self.ws / ".moderation-out" / "triage.json").write_text(
            json.dumps({"action": "repro-ready", "comment": "it fails"})
        )
        meta = self.package("triage")
        self.assertEqual((meta["action"], meta["comment"]), ("repro-ready", "it fails"))
        self.assertTrue((self.out / "patch.diff").exists())

    def test_triage_result_bad_shapes(self) -> None:
        """Invalid JSON, wrong types and a symlinked file all become `failed`."""
        target = self.ws / ".moderation-out" / "triage.json"
        for content in ("not json", '{"action": 1, "comment": "x"}', '{"action": "x"}'):
            with self.subTest(content=content):
                target.write_text(content)
                self.assertEqual(self.package("triage")["action"], "failed")
        target.unlink()
        other = self.tmp / "o.json"
        other.write_text(json.dumps({"action": "needs-info", "comment": "from outside"}))
        target.symlink_to(other)
        self.assertEqual(self.package("triage")["action"], "failed")


class RunClaudeTest(unittest.TestCase):
    """``run_claude.sh`` takes the key from the environment only and hardens the claude call."""

    def setUp(self) -> None:
        """Put a recording fake ``claude`` first on PATH."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        exe = self.tmp / "bin" / "claude"
        exe.parent.mkdir()
        exe.write_text(
            "#!/usr/bin/env bash\n"
            '{ printf "ARG:%s\\n" "$@"; printf "KEY:%s\\n" "${ANTHROPIC_API_KEY:-}";\n'
            '  printf "SCRUB:%s\\n" "${CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:-}";\n'
            '  printf "AUTHOR:%s\\n" "${GIT_AUTHOR_NAME:-}"; } > "$FAKE_OUT"\n'
        )
        exe.chmod(0o755)
        self.prompt = self.tmp / "prompt.md"
        self.prompt.write_text("do the thing")
        self.out = self.tmp / "out.txt"

    def launch(self, env: dict[str, str]) -> subprocess.CompletedProcess[bytes]:
        """Run the launcher with a clean-ish environment."""
        base = {k: v for k, v in os.environ.items() if k not in {"ANTHROPIC_API_KEY"}}
        path = f"{self.tmp / 'bin'}{os.pathsep}{base['PATH']}"
        return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
            [str(SCRIPTS / "run_claude.sh"), str(self.prompt), "Read,Grep", "5", "30"],
            cwd=self.tmp,
            env={**base, "PATH": path, "FAKE_OUT": str(self.out), **env},
            capture_output=True,
            check=False,
            timeout=60,
        )

    def test_key_only_from_the_environment(self) -> None:
        """The key reaches claude, the call is hardened, and no key file is involved."""
        proc = self.launch(
            {
                "ANTHROPIC_API_KEY": "sk-test",
                "MODERATION_EXTRA_TOOLS": "Bash(uv run pytest *)",
                "MODERATION_ALLOWED_DOMAINS": "github.com,api.github.com",
            }
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = self.out.read_text().splitlines()
        self.assertIn("KEY:sk-test", lines)
        self.assertIn("SCRUB:1", lines)
        self.assertIn("AUTHOR:claude-moderator[bot]", lines)
        self.assertEqual(lines[lines.index("ARG:--allowedTools") + 1], "ARG:Read,Grep,Bash(uv run pytest *)")
        settings = json.loads(lines[lines.index("ARG:--settings") + 1].removeprefix("ARG:"))
        self.assertIn("Read(//proc/**)", settings["permissions"]["deny"])
        sandbox = settings["sandbox"]
        self.assertIs(sandbox["enabled"], True)
        self.assertIs(sandbox["failIfUnavailable"], True)
        self.assertIs(sandbox["allowUnsandboxedCommands"], False)
        self.assertIs(sandbox["autoAllowBashIfSandboxed"], False)
        self.assertNotIn("enableWeakerNestedSandbox", sandbox)
        self.assertEqual(sandbox["network"]["allowedDomains"], ["github.com", "api.github.com"])
        self.assertIs(sandbox["network"]["strictAllowlist"], True)
        self.assertIn({"name": "ANTHROPIC_API_KEY", "mode": "deny"}, sandbox["credentials"]["envVars"])
        self.assertEqual(lines[lines.index("ARG:-p") + 1], "ARG:do the thing")

    def test_missing_or_bad_domains_fail_before_claude_runs(self) -> None:
        """No network allow-list, or a malformed host, means claude never starts."""
        for domains in ("", ",", 'x.com","evil', "a b"):
            with self.subTest(domains=domains):
                proc = self.launch({"ANTHROPIC_API_KEY": "k", "MODERATION_ALLOWED_DOMAINS": domains})
                self.assertEqual(proc.returncode, 1)
                self.assertFalse(self.out.exists())

    def test_missing_key_fails_before_claude_runs(self) -> None:
        """Without the key in the environment the launcher stops; claude is never started."""
        proc = self.launch({"MODERATION_ALLOWED_DOMAINS": "github.com"})
        self.assertEqual(proc.returncode, 1)
        self.assertFalse(self.out.exists())

    def test_no_key_file_and_no_git_config_in_the_launcher(self) -> None:
        """The launcher never reads `.secrets/` nor writes `git config` into the tree."""
        text = (SCRIPTS / "run_claude.sh").read_text()
        code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
        self.assertNotIn(".secrets", code)
        self.assertNotIn("git config", code)


if __name__ == "__main__":
    unittest.main()
