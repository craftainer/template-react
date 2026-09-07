#!/usr/bin/env python3
"""Parse and validate ``../template-sync-manifest.yml`` against tracked files.

Hand-rolled parsing (not PyYAML) keeps this dependency-free, per this
directory's README -- the manifest's shape is deliberately restricted to
three top-level keys, each a flat list of string patterns, so a full YAML
parser buys nothing here.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

TIERS = ("replace", "ignore", "merge")


def parse_manifest(text: str) -> dict[str, list[str]]:
    """Parse the manifest's ``tier: - pattern`` structure into a dict of lists."""
    tiers: dict[str, list[str]] = {tier: [] for tier in TIERS}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.split(" #", 1)[0].rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" ") and line.endswith(":"):
            key = line[:-1].strip()
            current = key if key in TIERS else None
            continue
        stripped = line.strip()
        if current is not None and stripped.startswith("- "):
            pattern = stripped[2:].strip().strip("'\"")
            tiers[current].append(pattern)
    return tiers


def matches(path: str, pattern: str) -> bool:
    """Return whether a repo-relative ``path`` falls under a manifest ``pattern``."""
    if pattern.endswith("/"):
        return path == pattern.rstrip("/") or path.startswith(pattern)
    if "*" in pattern or "?" in pattern:
        return fnmatch(path, pattern)
    return path == pattern


def classify(path: str, tiers: dict[str, list[str]]) -> list[str]:
    """Return every tier name whose patterns match ``path`` (ideally exactly one)."""
    return [tier for tier in TIERS if any(matches(path, pattern) for pattern in tiers[tier])]


def tracked_files() -> list[str]:
    """Return every git-tracked path in the current repository."""
    result = subprocess.run(
        ["git", "ls-files"],  # noqa: S607 -- "git" via PATH, a trusted CI/dev tool
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def check(manifest_path: Path) -> list[str]:
    """Return one error message per tracked path with zero or multiple tier matches."""
    tiers = parse_manifest(manifest_path.read_text())
    errors = []
    for path in tracked_files():
        matched = classify(path, tiers)
        if len(matched) == 0:
            errors.append(f"{path}: not covered by any tier in {manifest_path}")
        elif len(matched) > 1:
            errors.append(f"{path}: matched by more than one tier ({', '.join(matched)})")
    return errors


def main() -> int:
    """Run the manifest-completeness check and print any errors."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).parent.parent / "template-sync-manifest.yml",
    )
    args = parser.parse_args()

    errors = check(args.manifest)
    if errors:
        for error in errors:
            print(f"::error::{error}", file=sys.stderr)
        print(
            f"{len(errors)} path(s) not classified into exactly one "
            f"template-sync tier -- update {args.manifest}.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
