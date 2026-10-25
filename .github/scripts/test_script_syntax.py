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


if __name__ == "__main__":
    unittest.main()
