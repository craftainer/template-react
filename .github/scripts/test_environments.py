"""Guard: secret-holding jobs run in an environment and verify it fail-fast.

``release`` is covered in ``test_release_scripts.py``. Here: the ``moderation``
environment (the moderate-* gate and Claude jobs, which read
``ANTHROPIC_API_KEY``) and ``template-sync`` (``TEMPLATE_SYNC_TOKEN``), and the
check step that reads the environment's deployment branch policy with the
job's own token. The step's shell is run against a stub ``gh``.
"""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
WORKFLOWS = SCRIPTS.parent / "workflows"
DOCS = SCRIPTS.parent.parent / "docs" / "TEMPLATE.md"
SECRET_REF = re.compile(r"secrets\s*\.\s*(?!GITHUB_TOKEN\b)|secrets\s*\[|secrets\s*:\s*inherit")

# workflow file -> (environment, jobs that must declare it)
EXPECTED = {
    "moderate-bug-triage.yml": ("moderation", {"gate", "triage"}),
    "moderate-feature-triage.yml": ("moderation", {"gate", "triage"}),
    "moderate-bug-fix.yml": ("moderation", {"gate", "fix"}),
    "moderate-feature-build.yml": ("moderation", {"gate", "build"}),
    "template-sync.yml": ("template-sync", {"sync"}),
}
CHECKED = {**EXPECTED, "release.yml": ("release", {"version"})}


def jobs(text: str) -> dict[str, str]:
    """Return {job name: body} of the top-level jobs, comment lines dropped."""
    section = text.split("\njobs:\n", 1)[1]
    found = {}
    for m in re.finditer(r"^  ([a-z][\w-]*):\n(.*?)(?=^  [a-z][\w-]*:\n|\Z)", section, re.M | re.S):
        found[m.group(1)] = "\n".join(
            line for line in m.group(2).splitlines() if not line.lstrip().startswith("#")
        )
    return found


def check_script(job_body: str) -> str:
    """Return the ``run`` block of the environment check step, dedented."""
    m = re.search(
        r"- name: Check the \S+ environment is restricted.*?\n {8}run: \|\n((?: {10}[^\n]*\n|\n)+)",
        job_body + "\n",
        re.S,
    )
    assert m, "no environment check step"
    return "\n".join(line[10:] for line in m.group(1).splitlines()).rstrip() + "\n"


class EnvironmentDeclarationTest(unittest.TestCase):
    def test_secret_holding_jobs_declare_the_environment_and_no_others(self) -> None:
        for name, (env, wanted) in EXPECTED.items():
            for job, body in jobs((WORKFLOWS / name).read_text()).items():
                with self.subTest(workflow=name, job=job):
                    declared = re.search(r"^    environment: (.+)$", body, re.M)
                    self.assertEqual(
                        declared.group(1) if declared else None, env if job in wanted else None
                    )
                    if SECRET_REF.search(body):
                        self.assertIn(job, wanted, "reads a secret outside the environment")

    def test_every_environment_line_is_a_plain_name(self) -> None:
        """An expression could let a dispatcher pick an unrestricted environment."""
        for name in CHECKED:
            for m in re.finditer(
                r"^ +environment:[ \t]*(.*)$", (WORKFLOWS / name).read_text(), re.M
            ):
                with self.subTest(workflow=name):
                    self.assertRegex(m.group(1), r"^[a-z][a-z-]*$")

    def test_environments_have_no_reviewer_or_expression_dependence_on_triggers(self) -> None:
        """Only default-branch event triggers (issues, schedule) or dispatch, so a branch rule fits."""
        for name in EXPECTED:
            text = (WORKFLOWS / name).read_text()
            on = text.split("\non:\n", 1)[1].split("\n\n", 1)[0]
            triggers = set(re.findall(r"^  ([a-z_]+):", on, re.M))
            with self.subTest(workflow=name):
                self.assertTrue(triggers <= {"issues", "schedule", "workflow_dispatch"}, triggers)


class EnvironmentCheckStepTest(unittest.TestCase):
    def test_check_runs_before_the_first_secret_use_in_a_job_that_can_read_it(self) -> None:
        for name, (env, wanted) in CHECKED.items():
            for job, body in jobs((WORKFLOWS / name).read_text()).items():
                if job not in wanted or job in {"triage", "fix", "build"}:
                    continue  # those need the gate, which checks first
                with self.subTest(workflow=name, job=job):
                    at = body.index(f"- name: Check the {env} environment")
                    for m in SECRET_REF.finditer(body):
                        self.assertLess(at, m.start())
                    self.assertIn(f"ENVIRONMENT_NAME: {env}", body)
                    self.assertIn("GH_TOKEN: ${{ github.token }}", body)

    def test_claude_jobs_need_the_checking_gate(self) -> None:
        for name, (_, wanted) in EXPECTED.items():
            if name == "template-sync.yml":
                continue
            claude = next(iter(wanted - {"gate"}))
            with self.subTest(workflow=name):
                self.assertIn("needs: gate", jobs((WORKFLOWS / name).read_text())[claude])

    def test_job_can_read_environments(self) -> None:
        """``actions: read`` is the permission the environments GET endpoints need."""
        for name, (_, wanted) in CHECKED.items():
            text = (WORKFLOWS / name).read_text()
            for job in wanted:
                if job in {"triage", "fix", "build"}:
                    continue
                with self.subTest(workflow=name, job=job):
                    own = re.search(
                        r"^    permissions:\n((?:      .*\n)+)", jobs(text)[job] + "\n", re.M
                    )
                    top = text.split("\njobs:\n", 1)[0]
                    perms = own.group(1) if own else top
                    self.assertIn("actions: read", perms)

    def test_the_check_step_is_identical_everywhere(self) -> None:
        scripts = {
            name: check_script(
                jobs((WORKFLOWS / name).read_text())[
                    "gate" if "gate" in wanted else "sync" if "sync" in wanted else "version"
                ]
            )
            for name, (_, wanted) in CHECKED.items()
        }
        self.assertEqual(len(set(scripts.values())), 1, list(scripts))

    def test_docs_describe_the_environments(self) -> None:
        text = DOCS.read_text()
        for needle in (
            "Moderation and template-sync environments",
            "setup_environments.sh",
            "gh secret set NAME --env <environment>",
        ):
            self.assertIn(needle, text)


class EnvironmentCheckScriptTest(unittest.TestCase):
    """Run the step's shell against a stub ``gh`` that serves canned JSON."""

    script = check_script(jobs((WORKFLOWS / "moderate-bug-triage.yml").read_text())["gate"])

    def run_check(
        self,
        env_json: dict | None,
        policies: list[str] | None = None,
        env_error: str = "gh: Not Found (HTTP 404)",
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bindir = tmp_path / "bin"
            bindir.mkdir()
            data = {
                "env": env_json,
                "policies": [
                    {"type": p.split(":")[0], "name": p.split(":")[1]} for p in policies or []
                ],
            }
            (tmp_path / "data.json").write_text(json.dumps(data))
            stub = bindir / "gh"
            stub.write_text(
                "#!/usr/bin/env bash\n"
                'url="$2"\n'
                'case "$url" in\n'
                f"  */environments/*/deployment-branch-policies) jq -c '{{branch_policies: .policies}}' {tmp}/data.json | jq \"${{4:-.}}\" -r ;;\n"
                f'  */environments/*) if [ "$(jq -r .env {tmp}/data.json)" = null ]; then echo {json.dumps(env_error)} >&2; exit 1; fi; jq -c .env {tmp}/data.json ;;\n'
                "  *) echo main ;;\n"
                "esac\n"
            )
            stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
            return subprocess.run(  # noqa: S603 -- fixed argv, local stub
                ["bash", "-eo", "pipefail", "-c", self.script],
                env={
                    "PATH": f"{bindir}:{os.environ['PATH']}",
                    "GITHUB_REPOSITORY": "o/r",
                    "ENVIRONMENT_NAME": "moderation",
                    "TMPDIR": tmp,
                },
                capture_output=True,
                text=True,
                check=False,
            )

    GOOD = {
        "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}
    }

    def test_accepts_a_single_default_branch_rule(self) -> None:
        proc = self.run_check(self.GOOD, ["branch:main"])
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)

    def test_rejects_a_missing_environment(self) -> None:
        proc = self.run_check(None)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("does not exist", proc.stdout)

    def test_rejects_an_environment_without_a_branch_policy(self) -> None:
        for env_json in ({"deployment_branch_policy": None}, {}):
            proc = self.run_check(env_json)
            with self.subTest(env=env_json):
                self.assertEqual(proc.returncode, 1)
                self.assertIn("default branch 'main' only", proc.stdout)

    def test_rejects_protected_branches_mode(self) -> None:
        env_json = {
            "deployment_branch_policy": {
                "protected_branches": True,
                "custom_branch_policies": False,
            }
        }
        self.assertEqual(self.run_check(env_json).returncode, 1)

    def test_rejects_extra_or_wrong_rules(self) -> None:
        for rules in (
            [],
            ["branch:dev"],
            ["branch:main", "branch:dev"],
            ["tag:main"],
            ["branch:main", "tag:v*"],
        ):
            with self.subTest(rules=rules):
                self.assertEqual(self.run_check(self.GOOD, rules).returncode, 1)

    def test_an_unreadable_environment_warns_and_continues(self) -> None:
        proc = self.run_check(
            None, env_error="gh: Resource not accessible by integration (HTTP 403)"
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn("::warning::", proc.stdout)
        self.assertIn("unverified", proc.stdout)


if __name__ == "__main__":
    unittest.main()
