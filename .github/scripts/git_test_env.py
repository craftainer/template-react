"""Scrubbed environment for tests that run real ``git``.

Run as a git hook (``prek`` under ``git commit``), the tests inherit
``GIT_DIR``, ``GIT_INDEX_FILE``, ``GIT_WORK_TREE`` and friends from the outer
repository, so a scratch repo's ``git add`` or ``git init`` would act on the
outer one instead (a stray file in its index, ``git init --bare`` turning it
bare). Every test that spawns real git builds its environment with
``git_env`` so that cannot happen.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

# Test identity: the only GIT_* variables a scratch repo needs.
IDENTITY = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
}


def git_env(base: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return ``base`` (default ``os.environ``) without any ``GIT_*``, plus a test identity.

    The system and global git config are disabled too, so a developer's
    ``core.*`` or hooks settings cannot leak in.
    """
    source = os.environ if base is None else base
    env = {k: v for k, v in source.items() if not k.startswith("GIT_")}
    env.update(IDENTITY)
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    return env
