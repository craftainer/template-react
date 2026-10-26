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

import gzip
import json
import lzma
import re
import shutil
import sys
import tarfile
import tempfile
import zlib
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator

# An arch name ends up in a file name (``assets-<arch>.tar``): no separators.
_ARCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


# What reading a corrupt or truncated (compressed) tarball raises .
_CORRUPT = (tarfile.TarError, EOFError, zlib.error, lzma.LZMAError, gzip.BadGzipFile)


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


def _tarballs(arches: list[str], parts: Path) -> list[Path]:
    """Return ``parts/assets-<arch>.tar`` for every arch; raise when one is missing."""
    tarballs = []
    for arch in arches:
        tarball = parts / f"assets-{arch}.tar"
        if not tarball.is_file():
            msg = f"no release assets uploaded for arch {arch}"
            raise AssembleError(msg)
        tarballs.append(tarball)
    return tarballs


def _checked_members(
    tar: tarfile.TarFile,
    arch: str,
    leaves: dict[PurePosixPath, str],
    dirs: dict[PurePosixPath, str],
) -> Iterator[tarfile.TarInfo]:
    """Yield ``tar``'s members to extract, claiming each path for ``arch`` first.

    One pass over the tarball does both the collision check and (driven by
    ``extractall``) the extraction. ``extractall`` still applies directory
    attributes once at the end, which extracting member by member would not.
    """
    for m in tar:
        path = PurePosixPath(m.name)
        if str(path) == ".":
            yield m
            continue
        if path.is_absolute() or ".." in path.parts:
            msg = f"{m.name} (arch {arch}) escapes dist/"
            raise AssembleError(msg)
        _claim(path, is_dir=m.isdir(), arch=arch, leaves=leaves, dirs=dirs)
        yield m


def assemble(arches: list[str], parts: Path, dist: Path) -> None:
    """Extract ``parts/assets-<arch>.tar`` for every arch into ``dist``.

    Each tarball is read once, checking every path for a collision with the
    other legs as it is extracted into a temporary directory beside ``dist``
    that is renamed to ``dist`` at the end, so a failure leaves ``dist``
    untouched.
    """
    if not hasattr(tarfile, "data_filter"):
        msg = "this Python's tarfile has no extraction filters; Python 3.12+ is required"
        raise AssembleError(msg)
    names = _validate_arches(arches)
    tarballs = _tarballs(names, parts)
    if dist.exists() and (not dist.is_dir() or any(dist.iterdir())):
        msg = f"{dist} already exists and is not an empty directory"
        raise AssembleError(msg)
    dist.parent.mkdir(parents=True, exist_ok=True)
    leaves: dict[PurePosixPath, str] = {}  # non-directory entries -> arch
    dirs: dict[PurePosixPath, str] = {}  # directories (explicit or implied) -> arch
    # Same filesystem as dist, so the final rename is atomic.
    stage = Path(tempfile.mkdtemp(prefix=f".{dist.name}.", dir=dist.parent))
    try:
        for arch, tarball in zip(names, tarballs, strict=True):
            try:
                with tarfile.open(tarball) as tar:
                    # The "data" filter refuses unsafe links and absolute paths.
                    try:
                        tar.extractall(
                            stage, members=_checked_members(tar, arch, leaves, dirs), filter="data"
                        )
                    except tarfile.FilterError as exc:
                        msg = (
                            f"{tarball.name}: {exc}; release assets may only contain regular "
                            "files, directories and links that stay inside dist/"
                        )
                        raise AssembleError(msg) from exc
            except _CORRUPT as exc:
                # The collision check reads the tarball lazily, so a corrupt or
                # truncated one surfaces here, deep inside extraction.
                msg = (
                    f"could not read {tarball.name} ({type(exc).__name__}: {exc}); "
                    "it may be corrupt or truncated"
                )
                raise AssembleError(msg) from exc
            except OSError as exc:
                # bz2 corruption is a bare OSError; so is a full disk. Name the file
                # without claiming which.
                msg = f"{tarball.name}: {exc}"
                raise AssembleError(msg) from exc
        # mkdtemp creates 0700, and dist/ must be readable to the other user the
        # devcontainer runs as. The "data" filter sets every directory's mode to
        # None, so a "." member (`tar -C dist -cf x.tar .`) never restricts the
        # stage while later legs extract into it; the chmod can wait until the end.
        stage.chmod(0o755)
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
