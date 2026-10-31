"""Guard: every label `moderate-setup.yml` creates has a description GitHub accepts.

`gh label create` fails with HTTP 422 when a description is longer than 100
characters, and only the manually dispatched workflow ever runs it, so the
limit is checked here.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / "workflows" / "moderate-setup.yml"
MAX_DESCRIPTION = 100  # GitHub's label description limit, in characters
CREATE_LINE = re.compile(r'^\s*create\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]*)"\s*$', re.MULTILINE)


class ModerateLabelsTest(unittest.TestCase):
    def test_label_descriptions_fit_githubs_limit(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        labels = CREATE_LINE.findall(text)
        self.assertTrue(labels, "no create lines parsed from moderate-setup.yml")
        for name, _color, description in labels:
            with self.subTest(label=name):
                self.assertLessEqual(
                    len(description),
                    MAX_DESCRIPTION,
                    f"{name!r} description is {len(description)} characters",
                )


if __name__ == "__main__":
    unittest.main()
