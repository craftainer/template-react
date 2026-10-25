#!/usr/bin/env python3
"""Merge the per-arch ``assets-<arch>.tar`` tarballs of a release into one ``dist/``.

Used by ``../workflows/release.yml``'s ``release-check`` job. Fails when
ARCHES_JSON is not a non-empty JSON array of arch names, when an arch's
tarball is missing, or when two legs produce the same path: a file name both
legs wrote, a file in one leg that is a directory in another (or the
reverse, including a file whose parent directory is another leg's file), or
a symlink/hardlink clashing with any of those. A plain extract would
silently overwrite or half-fail on these.

All legs are extracted into a temporary directory next to ``dist/`` and
renamed into place only once every leg extracted, so a failure at any point
(a collision, or a member the extraction filter refuses) leaves ``dist/``
exactly as it was. ``dist/`` must not exist yet, or be an empty directory.

Needs Python 3.12 or newer (or a 3.8-3.11 release with the tarfile extraction
filters backported): extraction uses ``filter="data"``. The runners' ``python3``
(ubuntu-24.04) is 3.12.

Usage: assemble_dist.py ARCHES_JSON PARTS_DIR DIST_DIR
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

# An arch name ends up in a file name (``assets-<arch>.tar``): no separators.
_ARCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


class AssembleError(Exception):
    """ARCHES_JSON is invalid, a tarball is missing, or two legs collide on a path."""


def _validate_arches(value: object) -> list[str]:
    """Return the distinct arch names of ``value``, which must be a non-empty list."""
    if not isinstance(value, list) or not value:
        msg = f"ARCHES_JSON must be a non-empty JSON array of arch names, got {value!r}"
        raise AssembleError(msg)
    for arch in value:
        if not isinstance(arch, str) or not _ARCH.fullmatch(arch):
            msg = f"invalid arch name {arch!r} in ARCHES_JSON; expected e.g. amd64 or arm64"
            raise AssembleError(msg)
    return list(dict.fromkeys(value))


def _parents(path: PurePosixPath) -> list[PurePosixPath]:
    return [p for p in path.parents if str(p) != "."]


def _claim(
    path: PurePosixPath,
    *,
    is_dir: bool,
    arch: str,
    leaves: dict[PurePosixPath, str],
    dirs: dict[PurePosixPath, str],
) -> None:
    """Record ``path`` as produced by ``arch``; raise when another arch clashes with it."""
    implied = _parents(path)
    if is_dir:
        implied = [path, *implied]
    for d in implied:
        if d in leaves and leaves[d] != arch:
            msg = (
                f"dist/{d} is a file for arch {leaves[d]} but a directory for arch "
                f"{arch}; per-arch file names must include the arch"
            )
            raise AssembleError(msg)
        dirs.setdefault(d, arch)
    if is_dir:
        return
    other = leaves.get(path) or dirs.get(path)
    if other is not None and other != arch:
        msg = (
            f"dist/{path} is produced by more than one arch leg ({other} and {arch}); "
            "per-arch file names must include the arch"
        )
        raise AssembleError(msg)
    leaves[path] = arch


def _check(arches: list[str], parts: Path) -> list[Path]:
    """Validate every leg without extracting anything; return the tarballs in order."""
    leaves: dict[PurePosixPath, str] = {}  # non-directory entries -> arch
    dirs: dict[PurePosixPath, str] = {}  # directories (explicit or implied) -> arch
    tarballs = []
    for arch in arches:
        tarball = parts / f"assets-{arch}.tar"
        if not tarball.is_file():
            msg = f"no release assets uploaded for arch {arch}"
            raise AssembleError(msg)
        tarballs.append(tarball)
        with tarfile.open(tarball) as tar:
            for m in tar.getmembers():
                path = PurePosixPath(m.name)
                if str(path) == ".":
                    continue
                if path.is_absolute() or ".." in path.parts:
                    msg = f"{m.name} (arch {arch}) escapes dist/"
                    raise AssembleError(msg)
                _claim(path, is_dir=m.isdir(), arch=arch, leaves=leaves, dirs=dirs)
    return tarballs


def assemble(arches: list[str], parts: Path, dist: Path) -> None:
    """Extract ``parts/assets-<arch>.tar`` for every arch into ``dist``.

    Every leg is validated first, then extracted into a temporary directory
    beside ``dist`` that is renamed to ``dist`` at the end, so a failure
    leaves ``dist`` untouched.
    """
    if not hasattr(tarfile, "data_filter"):
        msg = "this Python's tarfile has no extraction filters; Python 3.12+ is required"
        raise AssembleError(msg)
    tarballs = _check(_validate_arches(arches), parts)
    if dist.exists() and (not dist.is_dir() or any(dist.iterdir())):
        msg = f"{dist} already exists and is not an empty directory"
        raise AssembleError(msg)
    dist.parent.mkdir(parents=True, exist_ok=True)
    # Same filesystem as dist, so the final rename is atomic.
    stage = Path(tempfile.mkdtemp(prefix=f".{dist.name}.", dir=dist.parent))
    try:
        stage.chmod(0o755)  # mkdtemp creates 0700; dist/ is read by other users
        for tarball in tarballs:
            with tarfile.open(tarball) as tar:
                # Paths were checked above and the "data" filter refuses unsafe links.
                try:
                    tar.extractall(stage, filter="data")
                except tarfile.FilterError as exc:
                    msg = (
                        f"{tarball.name}: {exc}; release assets may only contain regular "
                        "files, directories and links that stay inside dist/"
                    )
                    raise AssembleError(msg) from exc
        if dist.exists():
            dist.rmdir()
        stage.rename(dist)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main(argv: list[str]) -> int:
    """CLI entry point; prints a GitHub ``::error::`` annotation on failure."""
    try:
        _, arches_json, parts, dist = argv
    except ValueError:
        sys.stderr.write(__doc__ or "")
        return 2
    try:
        assemble(json.loads(arches_json), Path(parts), Path(dist))
    except (AssembleError, tarfile.TarError, ValueError, OSError) as exc:
        sys.stdout.write(f"::error::{exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
