"""Guard: every script here must parse on the CI runner's Python.

The workflows run these scripts with the runner's system ``python3``
(3.12 on ubuntu-24.04; see ``ruff.toml``). Syntax that is newer, such as
the PEP 758 unparenthesised ``except A, B:`` that an instance's
py314-targeting ``ruff format`` would write, is a SyntaxError there.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
RUNNER_PYTHON = (3, 12)
# The system python3 of each runner image the workflows may default to
# (actions/runner-images, the image's *-Readme.md). Add the new image here,
# together with RUNNER_PYTHON and ruff.toml, when Renovate bumps the label.
RUNNER_IMAGE_PYTHON = {"ubuntu-24.04": (3, 12), "ubuntu-24.04-arm": (3, 12)}
WORKFLOWS = SCRIPTS.parent / "workflows"


class ScriptsParseOnRunnerPythonTest(unittest.TestCase):
    def test_every_script_parses_on_the_runner_python(self) -> None:
        paths = sorted(SCRIPTS.glob("*.py"))
        self.assertTrue(paths)
        for path in paths:
            with self.subTest(script=path.name):
                ast.parse(
                    path.read_text(encoding="utf-8"),
                    filename=str(path),
                    feature_version=RUNNER_PYTHON,
                )

    def test_pep_758_syntax_is_rejected(self) -> None:
        source = "try:\n    pass\nexcept OSError, ValueError:\n    pass\n"
        with self.assertRaises(SyntaxError):
            ast.parse(source, feature_version=RUNNER_PYTHON)

    def test_ruff_target_matches_the_runner_python(self) -> None:
        config = (SCRIPTS / "ruff.toml").read_text(encoding="utf-8")
        match = re.search(r'^target-version\s*=\s*"py(\d)(\d+)"', config, re.MULTILINE)
        if match is None:
            self.fail("ruff.toml has no target-version")
        self.assertEqual((int(match.group(1)), int(match.group(2))), RUNNER_PYTHON)

    def test_workflows_default_to_a_runner_image_with_that_python(self) -> None:
        """Bumping the default runner label fails here until the pin is revisited."""
        labels = set()
        for path in sorted(WORKFLOWS.glob("*.yml")):
            text = path.read_text(encoding="utf-8")
            # Every quoted ubuntu-* label (CI_RUNNER / CI_RUNNER_AMD64 fallbacks and
            # the release matrix's arm leg).
            labels.update(re.findall(r"'(ubuntu-[^']+)'", text))
        self.assertTrue(labels)
        for label in sorted(labels):
            with self.subTest(runner=label):
                self.assertEqual(
                    RUNNER_IMAGE_PYTHON.get(label),
                    RUNNER_PYTHON,
                    f"workflows default to {label}: look up its system python3 in "
                    "actions/runner-images, then update RUNNER_IMAGE_PYTHON, RUNNER_PYTHON "
                    "and ruff.toml's target-version together",
                )


if __name__ == "__main__":
    unittest.main()
