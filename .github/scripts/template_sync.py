#!/usr/bin/env python3
"""Apply a template-sync step: pick a tag, diff/apply tiers, read/write state.

Invoked by ``../workflows/template-sync.yml`` in an *instance* repo (a repo
created from this template), never in the template repo itself. Each
subcommand does one step of the workflow so the YAML stays a thin sequence of
calls with the actual logic here, in one dependency-free (stdlib-only) place
-- see this directory's README.

Subcommands:

- ``select-tag``: given a newline-separated list of tag names on stdin and a
  release channel, print the latest tag in that channel.
- ``apply``: 3-way-apply the ``replace``/``merge`` tiers from a manifest
  between two template checkouts (the previously-synced tag and the new one)
  and the instance's own working tree; print a summary and list any
  merge conflicts.
- ``read-state`` / ``write-state``: get/set
  ``../template-sync-state.json``.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from template_sync_manifest import classify, parse_manifest

TAG_RE = re.compile(
    r"^v(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<pre_type>alpha|beta|rc)\.(?P<pre_num>\d+))?$"
)
PRE_ORDER = {"alpha": 0, "beta": 1, "rc": 2}
CHANNELS = ("stable", "alpha", "beta", "rc")

ParsedTag = tuple[int, int, int, str | None, int]


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
    pre_rank = 3 if pre_type is None else PRE_ORDER[pre_type]
    return (major, minor, patch, pre_rank, pre_num)


def latest_tag_for_channel(tags: list[str], channel: str) -> str | None:
    """Return the latest tag matching ``channel`` (stable = non-prerelease only)."""
    parsed = [(tag, p) for tag in tags if (p := parse_tag(tag)) is not None]
    if channel == "stable":
        candidates = [(tag, p) for tag, p in parsed if p[3] is None]
    else:
        candidates = [(tag, p) for tag, p in parsed if p[3] == channel]
    if not candidates:
        return None
    return max(candidates, key=lambda item: sort_key(item[1]))[0]


def cmd_select_tag(args: argparse.Namespace) -> int:
    """Print the latest tag in the requested channel from stdin's tag list."""
    tags = [line.strip() for line in sys.stdin if line.strip()]
    tag = latest_tag_for_channel(tags, args.channel)
    if tag is None:
        print(f"::error::no tag found for channel '{args.channel}'", file=sys.stderr)
        return 1
    print(f"tag={tag}")
    return 0


def cmd_check_cadence(args: argparse.Namespace) -> int:
    """Exit 0 if today's scheduled run should proceed for the given interval."""
    if args.interval == "weekly":
        return 0
    if args.interval == "monthly":
        return 0 if args.date.day <= 7 else 1  # noqa: PLR2004 -- "first week" is day 1-7
    print(f"::error::unknown TEMPLATE_SYNC_INTERVAL '{args.interval}'", file=sys.stderr)
    return 1


def read_state(state_path: Path) -> dict[str, str] | None:
    """Return the parsed state file, or None if it doesn't exist yet."""
    if not state_path.exists():
        return None
    result: dict[str, str] = json.loads(state_path.read_text())
    return result


def write_state(state_path: Path, template_repo: str, synced_tag: str) -> None:
    """Write ``{template_repo, synced_tag}`` to the state file, pretty-printed."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps({"template_repo": template_repo, "synced_tag": synced_tag}, indent=2) + "\n"
    )


def cmd_read_state(args: argparse.Namespace) -> int:
    """Print the current state file's fields as ``key=value`` lines, or exit 1."""
    state = read_state(args.state_file)
    if state is None:
        print("::error::no state file found", file=sys.stderr)
        return 1
    for key, value in state.items():
        print(f"{key}={value}")
    return 0


def cmd_write_state(args: argparse.Namespace) -> int:
    """Write the state file from CLI args."""
    write_state(args.state_file, args.template_repo, args.synced_tag)
    return 0


def relative_files_under(root: Path, rel_dir: str) -> list[str]:
    """Return every regular file under ``root/rel_dir``, as root-relative POSIX paths."""
    base = root / rel_dir
    if base.is_file():
        return [rel_dir]
    if not base.is_dir():
        return []
    return [p.relative_to(root).as_posix() for p in base.rglob("*") if p.is_file()]


def tier_paths(root: Path, tiers: dict[str, list[str]], tier: str) -> set[str]:
    """Return every file under ``root`` classified into ``tier`` by the manifest."""
    candidates: set[str] = set()
    for pattern in tiers[tier]:
        rel = pattern.rstrip("/") if pattern.endswith("/") else pattern
        candidates.update(relative_files_under(root, rel))
    return {path for path in candidates if classify(path, tiers) == [tier]}


def apply_replace(
    old_root: Path, new_root: Path, instance_root: Path, paths: set[str]
) -> dict[str, list[str]]:
    """Copy/remove replace-tier paths; return {"updated": [...], "removed": [...]}."""
    old_paths = {p for p in paths if (old_root / p).exists()}
    new_paths = {p for p in paths if (new_root / p).exists()}
    updated: list[str] = []
    for path in sorted(new_paths):
        src = new_root / path
        dst = instance_root / path
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.read_bytes() != src.read_bytes():
            shutil.copy2(src, dst)
            updated.append(path)
    removed: list[str] = []
    for path in sorted(old_paths - new_paths):
        dst = instance_root / path
        if dst.exists():
            dst.unlink()
            removed.append(path)
    return {"updated": updated, "removed": removed}


def merge_file(instance_file: Path, base_file: Path, theirs_file: Path) -> bool:
    """3-way merge ``theirs_file`` into ``instance_file`` in place; return True on conflict."""
    result = subprocess.run(  # noqa: S603 -- "git" via PATH, a trusted CI/dev tool
        ["git", "merge-file", str(instance_file), str(base_file), str(theirs_file)],  # noqa: S607
        capture_output=True,
        check=False,
    )
    return result.returncode != 0


def apply_merge(
    old_root: Path, new_root: Path, instance_root: Path, paths: set[str]
) -> dict[str, list[str]]:
    """3-way-merge merge-tier paths; return {"merged": [...], "conflicts": [...]}."""
    merged: list[str] = []
    conflicts: list[str] = []
    for path in sorted(paths):
        new_file = new_root / path
        old_file = old_root / path
        instance_file = instance_root / path
        if not new_file.exists():
            continue  # removed upstream: a merge-tier file is never deleted automatically.
        if not instance_file.exists():
            instance_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(new_file, instance_file)
            merged.append(path)
            continue
        base_content = old_file.read_bytes() if old_file.exists() else b""
        if new_file.read_bytes() == base_content:
            continue  # unchanged upstream since the last sync
        if old_file.exists():
            conflicted = merge_file(instance_file, old_file, new_file)
        else:
            # A path newly added to the merge tier: there's no prior template
            # version to use as a base, so merge against an empty one.
            with tempfile.NamedTemporaryFile() as empty_base:
                conflicted = merge_file(instance_file, Path(empty_base.name), new_file)
        (conflicts if conflicted else merged).append(path)
    return {"merged": merged, "conflicts": conflicts}


def cmd_apply(args: argparse.Namespace) -> int:
    """Apply the replace and merge tiers, printing a JSON summary to stdout."""
    tiers = parse_manifest(args.manifest.read_text())
    replace_paths = tier_paths(args.old_ref, tiers, "replace") | tier_paths(
        args.new_ref, tiers, "replace"
    )
    merge_paths = tier_paths(args.new_ref, tiers, "merge") | tier_paths(
        args.old_ref, tiers, "merge"
    )
    summary = {
        "replace": apply_replace(args.old_ref, args.new_ref, args.instance_root, replace_paths),
        "merge": apply_merge(args.old_ref, args.new_ref, args.instance_root, merge_paths),
    }
    print(json.dumps(summary, indent=2))
    return 1 if summary["merge"]["conflicts"] else 0


def pr_body(summary: dict[str, dict[str, list[str]]], old_tag: str, new_tag: str, repo: str) -> str:
    """Render the sync PR body markdown from an ``apply`` summary."""
    lines = [f"Syncs from `{old_tag}` to `{new_tag}` of {repo}.", "", "### Files changed"]
    for path in summary["replace"]["updated"]:
        lines.append(f"- replace: `{path}`")
    for path in summary["replace"]["removed"]:
        lines.append(f"- replace (removed upstream): `{path}`")
    for path in summary["merge"]["merged"]:
        lines.append(f"- merge (clean): `{path}`")
    for path in summary["merge"]["conflicts"]:
        lines.append(f"- merge (**conflict, needs manual resolution**): `{path}`")
    if summary["merge"]["conflicts"]:
        lines += [
            "",
            "One or more files above have `<<<<<<<` conflict markers to resolve before merging.",
        ]
    if "pyproject.toml" in summary["merge"]["merged"] + summary["merge"]["conflicts"]:
        lines += [
            "",
            "`pyproject.toml` changed -- run `uv lock` locally and push the "
            "updated `uv.lock` before merging.",
        ]
    return "\n".join(lines) + "\n"


def cmd_pr_body(args: argparse.Namespace) -> int:
    """Print the sync PR body markdown for an ``apply`` summary file."""
    summary = json.loads(args.summary.read_text())
    print(pr_body(summary, args.old_tag, args.new_tag, args.template_repo), end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser with each subcommand's arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    select_tag = subparsers.add_parser("select-tag")
    select_tag.add_argument("--channel", required=True, choices=CHANNELS)
    select_tag.set_defaults(func=cmd_select_tag)

    check_cadence = subparsers.add_parser("check-cadence")
    check_cadence.add_argument("--interval", required=True, choices=["weekly", "monthly"])
    check_cadence.add_argument("--date", type=date.fromisoformat, default=date.today())
    check_cadence.set_defaults(func=cmd_check_cadence)

    read_state = subparsers.add_parser("read-state")
    read_state.add_argument("--state-file", type=Path, required=True)
    read_state.set_defaults(func=cmd_read_state)

    write_state = subparsers.add_parser("write-state")
    write_state.add_argument("--state-file", type=Path, required=True)
    write_state.add_argument("--template-repo", required=True)
    write_state.add_argument("--synced-tag", required=True)
    write_state.set_defaults(func=cmd_write_state)

    apply_cmd = subparsers.add_parser("apply")
    apply_cmd.add_argument("--manifest", type=Path, required=True)
    apply_cmd.add_argument("--old-ref", type=Path, required=True)
    apply_cmd.add_argument("--new-ref", type=Path, required=True)
    apply_cmd.add_argument("--instance-root", type=Path, required=True)
    apply_cmd.set_defaults(func=cmd_apply)

    pr_body_cmd = subparsers.add_parser("pr-body")
    pr_body_cmd.add_argument("--summary", type=Path, required=True)
    pr_body_cmd.add_argument("--old-tag", required=True)
    pr_body_cmd.add_argument("--new-tag", required=True)
    pr_body_cmd.add_argument("--template-repo", required=True)
    pr_body_cmd.set_defaults(func=cmd_pr_body)

    return parser


def main() -> int:
    """Parse CLI args and dispatch to the selected subcommand."""
    args = build_parser().parse_args()
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
