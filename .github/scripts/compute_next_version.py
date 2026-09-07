#!/usr/bin/env python3
"""Compute the next release version/tag from existing git tags.

Reads the release channel (alpha/beta/rc/full) and which SemVer 2 part to
increase (major/minor/patch/none) from the command line, inspects the
repository's existing tags, and prints ``tag=`` / ``version=`` /
``prerelease=`` lines suitable for appending to ``$GITHUB_OUTPUT``.

Tags are expected in the form ``vMAJOR.MINOR.PATCH`` for a full release, or
``vMAJOR.MINOR.PATCH-{alpha,beta,rc}.N`` for a pre-release.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

TAG_RE = re.compile(
    r"^v(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<pre_type>alpha|beta|rc)\.(?P<pre_num>\d+))?$"
)
PRE_ORDER = {"alpha": 0, "beta": 1, "rc": 2}

ParsedTag = tuple[int, int, int, str | None, int]


def list_tags() -> list[str]:
    """Return every git tag in the checked-out repository."""
    result = subprocess.run(
        ["git", "tag", "--list"],  # noqa: S607 -- "git" via PATH, a trusted CI/dev tool
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def parse_tag(tag: str) -> ParsedTag | None:
    """Parse a `vMAJOR.MINOR.PATCH[-{alpha,beta,rc}.N]` tag, or return None."""
    match = TAG_RE.match(tag)
    if not match:
        return None
    pre_num = match["pre_num"]
    return (
        int(match["major"]),
        int(match["minor"]),
        int(match["patch"]),
        match["pre_type"],
        int(pre_num) if pre_num else 0,
    )


def sort_key(parsed: ParsedTag) -> tuple[int, int, int, int, int]:
    """Sort key ranking a full release above every pre-release of the same base."""
    major, minor, patch, pre_type, pre_num = parsed
    # A full release outranks every pre-release of the same major.minor.patch.
    pre_rank = 3 if pre_type is None else PRE_ORDER[pre_type]
    return (major, minor, patch, pre_rank, pre_num)


def bump_base(base: tuple[int, int, int], part: str) -> tuple[int, int, int]:
    """Increase major, minor, or patch by one, per SemVer 2 (resetting lower parts)."""
    major, minor, patch = base
    if part == "major":
        return (major + 1, 0, 0)
    if part == "minor":
        return (major, minor + 1, 0)
    if part == "patch":
        return (major, minor, patch + 1)
    msg = f"unknown bump part: {part}"
    raise ValueError(msg)


def main() -> int:
    """Parse CLI args and print the computed tag/version/prerelease outputs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bump", required=True, choices=["major", "minor", "patch", "none"])
    parser.add_argument("--release-type", required=True, choices=["alpha", "beta", "rc", "full"])
    args = parser.parse_args()

    all_tags = list_tags()
    parsed_tags = [p for p in (parse_tag(t) for t in all_tags) if p is not None]

    finals = [p for p in parsed_tags if p[3] is None]
    latest_final_base = max((p[:3] for p in finals), default=(0, 0, 0))

    latest_overall_base = (0, 0, 0)
    if parsed_tags:
        latest_overall_base = max(parsed_tags, key=sort_key)[:3]

    base = latest_overall_base if args.bump == "none" else bump_base(latest_final_base, args.bump)

    if args.release_type == "full":
        version = f"{base[0]}.{base[1]}.{base[2]}"
        tag = f"v{version}"
        if tag in all_tags:
            print(f"::error::{tag} already exists; choose a bump.", file=sys.stderr)
            return 1
        prerelease = "false"
    else:
        existing_nums = [p[4] for p in parsed_tags if p[:3] == base and p[3] == args.release_type]
        next_num = max(existing_nums, default=0) + 1
        version = f"{base[0]}.{base[1]}.{base[2]}-{args.release_type}.{next_num}"
        tag = f"v{version}"
        prerelease = "true"

    print(f"tag={tag}")
    print(f"version={version}")
    print(f"prerelease={prerelease}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
