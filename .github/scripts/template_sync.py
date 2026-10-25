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
- ``check-apply``: confirm an ``apply`` exit status of 0 or 1 against its summary
  file, so a crash that exits 1 is not read as merge conflicts.
- ``read-state`` / ``write-state``: get/set
  ``../template-sync-state.json``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from template_sync_manifest import classify, matches, parse_manifest

TAG_RE = re.compile(
    r"^v(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<pre_type>alpha|beta|rc)\.(?P<pre_num>\d+))?$"
)
# ``apply`` exit statuses: 0 clean, 1 merge conflicts, 2 error.
EXIT_CONFLICTS = 1
EXIT_ERROR = 2
# ``git merge-file`` reports at most this many conflicts as its exit status.
MAX_CONFLICTS = 127
# The monthly cadence runs only in the first week of the month: day 1-7.
FIRST_WEEK_LAST_DAY = 7
# ``git merge-file`` decides "binary" from a NUL byte in the first 8000 bytes.
BINARY_PROBE_BYTES = 8000
PRE_ORDER = {"alpha": 0, "beta": 1, "rc": 2}
CHANNELS = ("stable", "alpha", "beta", "rc")

ParsedTag = tuple[int, int, int, str | None, int]

log = logging.getLogger(__name__)


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
        return 0 if args.date.day <= FIRST_WEEK_LAST_DAY else 1
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


def relative_files(root: Path) -> list[str]:
    """Return every regular file under ``root`` as root-relative POSIX paths.

    ``.git`` is skipped. A missing ``root`` yields an empty list.
    """
    if not root.is_dir():
        return []
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        if ".git" in dirnames:
            dirnames.remove(".git")  # don't descend into git metadata
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_file():
                found.append(path.relative_to(root).as_posix())
    return found


def relative_files_matching(
    root: Path, pattern: str, listing: list[str] | None = None
) -> list[str]:
    """Return every regular file under ``root`` matching the glob ``pattern``.

    Uses the manifest's own ``matches`` (``*`` spans ``/``), so what sync
    expands is exactly what the completeness check classifies. ``.git`` is
    skipped. A pattern that matches nothing yields an empty list. Pass
    ``listing`` (from ``relative_files``) to match several patterns against
    one walk of the tree.
    """
    if listing is None:
        listing = relative_files(root)
    return [rel for rel in listing if matches(rel, pattern)]


def tier_paths(root: Path, tiers: dict[str, list[str]], tier: str) -> set[str]:
    """Return every file under ``root`` classified into ``tier`` by the manifest."""
    candidates: set[str] = set()
    listing: list[str] | None = None  # walked once, and only if a glob needs it
    for pattern in tiers[tier]:
        # Same glob test as template_sync_manifest.matches: only "*"/"?" make
        # a pattern a glob; "[...]" counts only alongside one of them.
        if "*" in pattern or "?" in pattern:
            if listing is None:
                listing = relative_files(root)
            candidates.update(relative_files_matching(root, pattern, listing))
            continue
        rel = pattern.rstrip("/") if pattern.endswith("/") else pattern
        candidates.update(relative_files_under(root, rel))
    return {path for path in candidates if classify(path, tiers) == [tier]}


def is_executable(path: Path) -> bool:
    """Return whether the owner-execute bit is set (what git tracks as 100755)."""
    return bool(path.stat().st_mode & stat.S_IXUSR)


def sync_executable_bit(src: Path, dst: Path) -> None:
    """Make ``dst``'s execute bits match ``src``'s, leaving its other bits alone."""
    if dst.is_symlink():
        return  # chmod would follow the link and change its target, not the link.
    mode = dst.stat().st_mode
    exec_bits = stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    if is_executable(src):
        # Like git: executable for every class that can read.
        new_mode = mode | ((mode & (stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)) >> 2)
    else:
        new_mode = mode & ~exec_bits
    dst.chmod(new_mode)


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
        if dst.is_symlink():
            continue  # the instance deliberately links it; writing would follow the link.
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.read_bytes() != src.read_bytes():
            shutil.copy2(src, dst)
            updated.append(path)
        elif is_executable(src) != is_executable(dst):
            # Same content, different executable bit (e.g. a script the
            # template fixed from 644 to 755): a content-only comparison
            # would leave the instance's copy broken forever.
            sync_executable_bit(src, dst)
            updated.append(path)
    removed: list[str] = []
    for path in sorted(old_paths - new_paths):
        dst = instance_root / path
        if dst.is_symlink():
            continue  # as above: the instance deliberately links it.
        if dst.exists():
            dst.unlink()
            removed.append(path)
    return {"updated": updated, "removed": removed}


def is_binary(path: Path) -> bool:
    """Whether ``path`` looks binary to ``git merge-file`` (a NUL in its first 8000 bytes)."""
    try:
        with path.open("rb") as handle:
            return b"\0" in handle.read(BINARY_PROBE_BYTES)
    except OSError:
        return False  # unreadable or missing: let git report it as the error it is


def merge_file(instance_file: Path, base_file: Path, theirs_file: Path) -> bool:
    """3-way merge ``theirs_file`` into ``instance_file`` in place; True on conflict.

    Binary input cannot be merged line by line: it counts as a conflict and the
    instance's file is left as it is, for a person to resolve. Otherwise
    ``git merge-file`` exits with the number of conflicts, capped at
    ``MAX_CONFLICTS`` (127); per git-merge-file(1) its exit value is "negative on
    error", which a shell sees as 128-255 (255 for -1). Any other status is an
    error, such as an unreadable file or a signal kill (negative status). An
    error is not a conflict: raise instead of reporting it as one, so the sync
    fails loudly rather than leaving a half-merged file.
    """
    if any(is_binary(path) for path in (instance_file, base_file, theirs_file)):
        return True
    result = subprocess.run(  # noqa: S603 -- "git" via PATH, a trusted CI/dev tool
        ["git", "merge-file", str(instance_file), str(base_file), str(theirs_file)],  # noqa: S607
        capture_output=True,
        check=False,
    )
    if result.returncode < 0 or result.returncode > MAX_CONFLICTS:
        stderr = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(
            f"git merge-file failed (exit {result.returncode}) for {instance_file}: {stderr}"
        )
    return result.returncode > 0


def apply_merge(
    old_root: Path, new_root: Path, instance_root: Path, paths: set[str]
) -> dict[str, list[str]]:
    """3-way-merge merge-tier paths; return {"merged": [...], "conflicts": [...]}.

    ``merged`` lists only files whose content actually changed, so running the
    same step again (an instance already at the new version) reports nothing.
    A path the instance links elsewhere is left alone, as in the replace tier.
    """
    merged: list[str] = []
    conflicts: list[str] = []
    for path in sorted(paths):
        new_file = new_root / path
        old_file = old_root / path
        instance_file = instance_root / path
        if not new_file.exists():
            continue  # removed upstream: a merge-tier file is never deleted automatically.
        if instance_file.is_symlink():
            continue  # the instance deliberately links it; merging would write through the link.
        if not instance_file.exists():
            instance_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(new_file, instance_file)
            merged.append(path)
            continue
        base_content = old_file.read_bytes() if old_file.exists() else b""
        new_content = new_file.read_bytes()
        if new_content == base_content:
            continue  # unchanged upstream since the last sync
        before = instance_file.read_bytes()
        if before == new_content:
            continue  # the instance already has the new version
        if old_file.exists() and before == base_content:
            # Untouched by the instance: take the new version outright. Git
            # would do the same for text; a binary file can only be merged this way.
            shutil.copy2(new_file, instance_file)
            merged.append(path)
            continue
        if old_file.exists():
            conflicted = merge_file(instance_file, old_file, new_file)
        else:
            # A path newly added to the merge tier: there's no prior template
            # version to use as a base, so merge against an empty one.
            with tempfile.NamedTemporaryFile() as empty_base:
                conflicted = merge_file(instance_file, Path(empty_base.name), new_file)
        if conflicted:
            conflicts.append(path)
        elif instance_file.read_bytes() != before:
            merged.append(path)
    return {"merged": merged, "conflicts": conflicts}


def cmd_apply(args: argparse.Namespace) -> int:
    """Apply the replace and merge tiers, printing a JSON summary to stdout.

    Exit status: 0 clean, 1 merge conflicts (summary printed), 2 error (no
    summary on stdout; the caller must fail and not advance the sync state).

    Not atomic: files are written one by one, so on exit 2 the replace/merge
    writes made before the error stay on disk. CI is safe because the runner's
    checkout is discarded and the sync state does not advance.
    """
    try:
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
    except Exception as err:
        # Any failure must exit 2: an uncaught exception exits 1, which reads
        # as "conflicts". BaseException (Ctrl-C, SystemExit) is deliberately
        # left alone. Logging the traceback is what keeps ruff's blind-except
        # rule quiet without a ``noqa`` that instances not selecting BLE would flag.
        log.exception("apply failed")
        print(f"error: {type(err).__name__}: {err}", file=sys.stderr)
        return EXIT_ERROR
    print(json.dumps(summary, indent=2))
    return EXIT_CONFLICTS if summary["merge"]["conflicts"] else 0


def cmd_check_apply(args: argparse.Namespace) -> int:
    """Validate an ``apply`` run's exit status against the summary it wrote.

    ``apply`` exits 1 for conflicts, but so does any crash before its own
    handler exists (an import-time ``SyntaxError``, say), and that leaves an
    empty summary. Trust a status of 0 or 1 only when the summary parses and
    agrees with it. Prints ``conflicts=0|1`` and returns 0, or returns 2.
    """
    if args.exit_code not in (0, EXIT_CONFLICTS):
        print(
            f"::error::apply failed (exit {args.exit_code}); not advancing the sync state.",
            file=sys.stderr,
        )
        return EXIT_ERROR
    try:
        conflicts = json.loads(args.summary.read_text())["merge"]["conflicts"]
        agrees = isinstance(conflicts, list) and bool(conflicts) == (
            args.exit_code == EXIT_CONFLICTS
        )
    except (OSError, ValueError, KeyError, TypeError):
        agrees = False
    if not agrees:
        print(
            f"::error::apply exited {args.exit_code} without a matching summary in "
            f"{args.summary} (a crash, not conflicts); not advancing the sync state.",
            file=sys.stderr,
        )
        return EXIT_ERROR
    print(f"conflicts={args.exit_code}")
    return 0


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
            "One or more files above have `<<<<<<<` conflict markers to resolve before merging "
            "(a binary file has none: it is left at the instance's version, so take the new "
            "one from the template's new tag).",
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

    check_apply = subparsers.add_parser("check-apply")
    check_apply.add_argument("--exit-code", type=int, required=True)
    check_apply.add_argument("--summary", type=Path, required=True)
    check_apply.set_defaults(func=cmd_check_apply)

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
