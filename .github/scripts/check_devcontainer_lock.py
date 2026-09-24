#!/usr/bin/env python3
"""Check that ``.devcontainer/devcontainer-lock.json`` matches ``devcontainer.json``.

Renovate bumps a feature's version tag in ``devcontainer.json`` but never
regenerates the lockfile, so without this check a feature bump can
automerge with the lockfile still pinning the old version and digest.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEVCONTAINER_DIR = Path(__file__).parent.parent.parent / ".devcontainer"


def remote_features(config: dict) -> set[str]:
    """Return ``config``'s feature references, minus local ``./`` ones (never locked)."""
    return {ref for ref in config.get("features", {}) if not ref.startswith(("./", "../"))}


def check(config_path: Path, lock_path: Path) -> list[str]:
    """Return one error message per feature reference present in only one of the files."""
    wanted = remote_features(json.loads(config_path.read_text()))
    locked: set[str] = set()
    if lock_path.exists():
        locked = set(json.loads(lock_path.read_text()).get("features", {}))
    errors = [f"{ref}: in {config_path} but not in {lock_path}" for ref in sorted(wanted - locked)]
    errors += [f"{ref}: in {lock_path} but not in {config_path}" for ref in sorted(locked - wanted)]
    return errors


def main() -> int:
    """Run the lockfile-consistency check and print any errors."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEVCONTAINER_DIR / "devcontainer.json")
    parser.add_argument("--lock", type=Path, default=DEVCONTAINER_DIR / "devcontainer-lock.json")
    args = parser.parse_args()

    errors = check(args.config, args.lock)
    if errors:
        for error in errors:
            print(f"::error::{error}", file=sys.stderr)
        print(
            f"{args.lock} is out of date -- regenerate it with "
            "`npx @devcontainers/cli upgrade --workspace-folder .` (or by "
            "rebuilding the devcontainer) and commit the result.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
