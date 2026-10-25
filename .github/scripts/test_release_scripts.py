"""Tests for ``assemble_dist.py`` and ``has_make_target.sh`` (``release.yml``'s helpers)."""

from __future__ import annotations

import io
import itertools
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

import assemble_dist

SCRIPTS = Path(__file__).resolve().parent


def _gnu_make() -> bool:
    """Whether ``make`` is GNU make, whose ``-p`` dump format the probe parses."""
    make = shutil.which("make")
    if make is None:
        return False
    out = subprocess.run(  # noqa: S603 -- fixed argv
        [make, "--version"], capture_output=True, text=True, check=False
    )
    return out.stdout.startswith("GNU Make")


def make_tar(
    path: Path, entries: dict[str, bytes | None], links: dict[str, str] | None = None
) -> None:
    """Write a tarball: ``name -> bytes`` is a file, ``name -> None`` a directory."""
    with tarfile.open(path, "w") as tar:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            if data is None:
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            tar.addfile(info)


class AssembleDistTest(unittest.TestCase):
    """``assemble`` merges per-arch tarballs and rejects every kind of collision."""

    def setUp(self) -> None:
        """Create empty ``parts/`` and ``dist/`` locations."""
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.parts = tmp / "parts"
        self.parts.mkdir()
        self.dist = tmp / "dist"

    def leg(self, arch: str, entries: dict[str, bytes | None], **kw: dict[str, str]) -> None:
        """Create ``assets-<arch>.tar``."""
        make_tar(self.parts / f"assets-{arch}.tar", entries, kw.get("links"))

    def assert_collision(self, pattern: str) -> None:
        """Assembling both arches fails with a message matching ``pattern``."""
        with self.assertRaisesRegex(assemble_dist.AssembleError, pattern):
            assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)

    def test_merges_disjoint_legs(self) -> None:
        """Different names (and a shared directory) from two legs are all extracted."""
        self.leg("amd64", {"./": None, "./a-amd64.tar": b"1", "./sbom/": None, "./sbom/a": b"x"})
        self.leg("arm64", {"./a-arm64.tar": b"2", "./sbom/": None, "./sbom/b": b"y"})
        assemble_dist.assemble(["amd64", "arm64"], self.parts, self.dist)
        got = sorted(str(p.relative_to(self.dist)) for p in self.dist.rglob("*") if p.is_file())
        self.assertEqual(got, ["a-amd64.tar", "a-arm64.tar", "sbom/a", "sbom/b"])

    def test_empty_leg_is_fine(self) -> None:
        """A leg that produced nothing still assembles."""
        self.leg("amd64", {"./": None})
        assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertTrue(self.dist.is_dir())

    def test_missing_arch(self) -> None:
        """A leg without a tarball is reported by arch."""
        self.leg("amd64", {"./": None})
        self.assert_collision("no release assets uploaded for arch arm64")

    def test_same_file_name(self) -> None:
        """The same file name in two legs is rejected."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"./x": b"2"})
        self.assert_collision("more than one arch leg")

    def test_file_then_directory(self) -> None:
        """A file in one leg and a directory of that name in the next is rejected."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"x/": None, "x/y": b"2"})
        self.assert_collision("dist/x is a file")

    def test_directory_then_file(self) -> None:
        """A directory in one leg and a file of that name in the next is rejected."""
        self.leg("amd64", {"x/": None, "x/y": b"2"})
        self.leg("arm64", {"x": b"1"})
        self.assert_collision("more than one arch leg")

    def test_file_under_other_legs_file(self) -> None:
        """A file below a path that is another leg's file is rejected (no explicit dir entry)."""
        self.leg("amd64", {"x": b"1"})
        self.leg("arm64", {"x/y": b"2"})
        self.assert_collision("dist/x is a file")

    def test_symlink_clashes(self) -> None:
        """A symlink counts as a file: a dangling link still collides by name."""
        self.leg("amd64", {}, links={"x": "nowhere"})
        self.leg("arm64", {"x": b"1"})
        self.assert_collision("more than one arch leg")

    def test_same_leg_repeat_is_not_a_collision(self) -> None:
        """A path repeated within one leg (or a repeated arch) extracts fine."""
        self.leg("amd64", {"x": b"1"})
        with tarfile.open(self.parts / "assets-amd64.tar", "a") as tar:
            info = tarfile.TarInfo("x")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"2"))
        assemble_dist.assemble(["amd64", "amd64"], self.parts, self.dist)
        self.assertTrue((self.dist / "x").is_file())

    def test_failure_extracts_nothing(self) -> None:
        """A collision in a later leg leaves dist/ empty."""
        self.leg("amd64", {"a": b"1", "x": b"1"})
        self.leg("arm64", {"x": b"2"})
        self.assert_collision("more than one arch leg")
        self.assertFalse(self.dist.exists() and any(self.dist.iterdir()))

    def test_symlink_out_of_dist_is_reported(self) -> None:
        """A link pointing outside dist/ is a reported error, not a traceback."""
        self.leg("amd64", {}, links={"latest": "/etc/passwd"})
        self.assertEqual(assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)]), 1)

    def test_corrupt_tarball_is_reported(self) -> None:
        """A tarball that is not a tar is a reported error."""
        (self.parts / "assets-amd64.tar").write_bytes(b"not a tar")
        self.assertEqual(assemble_dist.main(["x", '["amd64"]', str(self.parts), str(self.dist)]), 1)

    def test_invalid_arches_are_reported(self) -> None:
        """ARCHES_JSON must be a non-empty array of plain arch names."""
        for raw in ("[]", '"amd64"', '{"amd64": 1}', "[1]", '[""]', '["../x"]', '["a/b"]', "nope"):
            self.assertEqual(
                assemble_dist.main(["x", raw, str(self.parts), str(self.dist)]), 1, raw
            )
        self.assertFalse(self.dist.exists())

    def test_wrong_argument_count(self) -> None:
        """Missing arguments print the usage and exit 2."""
        self.assertEqual(assemble_dist.main(["x", "[]"]), 2)

    def test_failure_mid_extract_leaves_nothing(self) -> None:
        """A member only refused while extracting (unsafe link) leaves no dist/ or temp dir."""
        self.leg("amd64", {"a": b"1"})
        self.leg("arm64", {}, links={"latest": "/etc/passwd"})
        self.assertEqual(
            assemble_dist.main(["x", '["amd64", "arm64"]', str(self.parts), str(self.dist)]), 1
        )
        self.assertEqual(sorted(p.name for p in self.dist.parent.iterdir()), ["parts"])

    def test_existing_dist(self) -> None:
        """An empty dist/ is filled; one that already holds files is refused untouched."""
        self.leg("amd64", {"a": b"1"})
        self.dist.mkdir()
        assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertTrue((self.dist / "a").is_file())
        (self.dist / "keep").write_text("x")
        with self.assertRaisesRegex(assemble_dist.AssembleError, "not an empty directory"):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)
        self.assertEqual(sorted(p.name for p in self.dist.iterdir()), ["a", "keep"])

    def test_unsafe_link_message(self) -> None:
        """The refusal of an absolute link names the tarball and says what is allowed."""
        self.leg("amd64", {}, links={"latest": "/etc/passwd"})
        with self.assertRaisesRegex(
            assemble_dist.AssembleError, r"assets-amd64\.tar: .*inside dist/"
        ):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)

    def test_collisions_do_not_depend_on_leg_order(self) -> None:
        """With three legs, every ordering accepts or rejects the same layouts."""
        layouts = {
            "disjoint": ({"a": b"1"}, {"b": b"1"}, {"d/": None, "d/c": b"1"}, False),
            "shared dir": ({"d/a": b"1"}, {"d/b": b"1"}, {"d/": None, "d/c": b"1"}, False),
            "file vs dir": ({"d/a": b"1"}, {"d/b": b"1"}, {"d": b"1"}, True),
            "file vs implied dir": ({"d": b"1"}, {"e": b"1"}, {"d/x": b"1"}, True),
            "same file": ({"a": b"1"}, {"b": b"1"}, {"a": b"2"}, True),
        }
        for name, (one, two, three, collides) in layouts.items():
            for order in itertools.permutations([one, two, three]):
                with tempfile.TemporaryDirectory() as tmp:
                    parts = Path(tmp) / "parts"
                    parts.mkdir()
                    arches = [f"a{i}" for i in range(3)]
                    for arch, entries in zip(arches, order, strict=True):
                        make_tar(parts / f"assets-{arch}.tar", entries)
                    dist = Path(tmp) / "dist"
                    if collides:
                        with self.assertRaises(assemble_dist.AssembleError, msg=name):
                            assemble_dist.assemble(arches, parts, dist)
                    else:
                        assemble_dist.assemble(arches, parts, dist)

    def test_escaping_path(self) -> None:
        """A member that climbs out of dist/ is rejected."""
        self.leg("amd64", {"../evil": b"1"})
        with self.assertRaisesRegex(assemble_dist.AssembleError, "escapes"):
            assemble_dist.assemble(["amd64"], self.parts, self.dist)


@unittest.skipUnless(_gnu_make(), "GNU make not installed (the probe parses its -p dump)")
class HasMakeTargetTest(unittest.TestCase):
    """``has_make_target.sh`` tells a defined rule from everything else."""

    def probe(
        self, makefile: str, target: str = "verify-published"
    ) -> subprocess.CompletedProcess[str]:
        """Run the probe in a temp dir containing ``makefile``."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "Makefile").write_text(makefile)
            return subprocess.run(  # noqa: S603 -- fixed argv, trusted script
                [str(SCRIPTS / "has_make_target.sh"), target],
                cwd=tmp,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_defined_rules(self) -> None:
        """Plain, double-colon, prerequisite-only and recipe-less rules all count."""
        for rule in (
            "verify-published:\n\t@echo hi\n",
            "verify-published::\n\t@echo hi\n",
            "verify-published: other\nother:\n",
            "verify-published:\n",
            ".PHONY: verify-published\nverify-published: ;\n",
            "verify-published: VAR := x\nverify-published:\n\t@true\n",
            'verify-published:\n\t@echo "*** done ***"\n',
            # Only listed in .PHONY: indistinguishable from an empty rule, and
            # `make verify-published` is a successful no-op either way.
            ".PHONY: verify-published\n",
        ):
            self.assertEqual(self.probe(rule).returncode, 0, rule)

    def test_recipe_is_not_run(self) -> None:
        """Probing never runs a recipe, `$(MAKE)` lines included."""
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "ran"
            result = self.probe(
                f"verify-published:\n\t$(MAKE) boom\n\ttouch {marker}\nboom:\n\ttouch {marker}\n"
            )
            self.assertEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), "a recipe ran")

    def test_usage_error_is_exit_2(self) -> None:
        """No argument (or an empty one) is a usage error, never 'not defined' (1)."""
        for args in ([], [""], ["a", "b"]):
            with tempfile.TemporaryDirectory() as tmp:
                result = subprocess.run(  # noqa: S603 -- fixed argv, trusted script
                    [str(SCRIPTS / "has_make_target.sh"), *args],
                    cwd=tmp,
                    capture_output=True,
                    text=True,
                    check=False,
                )
            self.assertEqual(result.returncode, 2, args)
            self.assertIn("usage", result.stderr)

    def test_missing_rules(self) -> None:
        """No rule, a mere prerequisite, or a longer name is not the target."""
        for text in (
            "build:\n\t@true\n",
            "build: verify-published\n",
            "verify-published-extra:\n\t@true\n",
            "verify-published: VAR := x\n",
        ):
            self.assertEqual(self.probe(text).returncode, 1, text)

    def test_name_is_literal(self) -> None:
        """Regex metacharacters in the name match only themselves."""
        self.assertEqual(self.probe("c++:\n\t@true\n", "c++").returncode, 0)
        self.assertEqual(self.probe("a.b:\n\t@true\n", "a.b").returncode, 0)
        self.assertEqual(self.probe("abb:\n\t@true\n", "a.b").returncode, 1)
        self.assertEqual(self.probe("c:\n\t@true\n", "c+").returncode, 1)

    def test_broken_makefile(self) -> None:
        """A Makefile that fails to parse is an error, not 'missing'."""
        result = self.probe("include does-not-exist.mk\n")
        self.assertEqual(result.returncode, 2)
        self.assertIn("does-not-exist.mk", result.stdout)


if __name__ == "__main__":
    unittest.main()
