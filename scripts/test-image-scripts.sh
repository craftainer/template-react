#!/usr/bin/env bash
# Offline tests for the template-owned image logic that has no other check:
# the Makefile's repo derivation, check-dockerfile-versions.sh, image-smoke.sh's
# missing-tar failure, skopeo.sh's argument handling and image-dast.sh's
# skip, ZAP wiring and exit-code mapping. Needs no Docker daemon
# (docker is stubbed) and writes only to a temp directory. Run by the
# `image-scripts-test` hook.
set -euo pipefail

# Hermetic: a pre-commit run exports GIT_* (the test inits scratch repos and
# must never touch the real one), and a release run exports RELEASE_ARCH etc.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_COMMON_DIR RELEASE_ARCH RELEASE_VERSION ARCHES GITHUB_REPOSITORY
unset IMAGE_SMOKE_PORT IMAGE_SMOKE_PATH IMAGE_SMOKE_TIMEOUT IMAGE_SMOKE_RUN_ARGS IMAGE_TAR_PREFIX SKOPEO_IMAGE
unset IMAGE_DAST_PATH IMAGE_DAST_SPIDER_MINS IMAGE_DAST_RULES

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

fail() {
    echo "FAIL: $*" >&2
    failures=$((failures + 1))
}

# expect_eq NAME EXPECTED ACTUAL
expect_eq() {
    [[ "$2" == "$3" ]] || fail "$1: expected '$2', got '$3'"
}

# Makefile: REPO from the origin remote, in every URL form we claim to parse.
repo_of() {
    local dir="$tmp/repo-$RANDOM"
    mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" remote add origin "$1"
    (cd "$dir" && env -u GITHUB_REPOSITORY make -s -f "$root/Makefile" \
        -f <(printf 'show-repo:\n\t@echo $(REPO)\n') show-repo)
}
while IFS='|' read -r url want; do
    expect_eq "repo from $url" "$want" "$(repo_of "$url")"
done <<'EOF_URLS'
https://github.com/o/r.git|o/r
https://github.com/o/r|o/r
https://user:token@github.com/o/r.git/|o/r
git@github.com:o/r.git|o/r
ssh://git@github.com/o/r.git|o/r
ssh://git@github.com:22/o/r.git|o/r
ssh://git@ssh.github.com:443/o/r|o/r
ssh://github.com:2222/o/r.git|o/r
git+ssh://git@host:22/o/r.git|o/r
SSH://git@host:22/o/r.git|o/r
EOF_URLS

# GITHUB_REPOSITORY wins over the remote; a failing git (no origin here) is an
# error for targets that need REPO, with git's message on stderr, never a guess.
dir="$tmp/repo-pref"
mkdir -p "$dir"
git -C "$dir" init -q
git -C "$dir" remote add origin https://github.com/o/r.git
out="$(cd "$dir" && GITHUB_REPOSITORY=x/y make -s -f "$root/Makefile" -f <(printf 'show-repo:\n\t@echo $(REPO)\n') show-repo)"
expect_eq "GITHUB_REPOSITORY preferred" "x/y" "$out"
dir="$tmp/repo-norem"
mkdir -p "$dir"
git -C "$dir" init -q
out="$(cd "$dir" && make -s -f "$root/Makefile" repo-check 2>&1)" && fail "repo-check: git failure should fail"
[[ "$out" == *"cannot derive the repository"* && "$out" == *"origin"* ]] || fail "repo-check: wrong message: $out"
out="$(cd "$dir" && make -s -f "$root/Makefile" publish RELEASE_ARCH=amd64 OCI_REGISTRY=r 2>&1)" && fail "publish: git failure should fail"
[[ "$out" == *"cannot derive the repository"* ]] || fail "publish: wrong message: $out"
out="$(cd "$dir" && make -s -f "$root/Makefile" publish RELEASE_ARCH=amd64 2>&1)" || fail "publish: skipped publish should not need REPO: $out"
(cd "$dir" && GITHUB_REPOSITORY=o/r make -s -f "$root/Makefile" repo-check) || fail "repo-check: GITHUB_REPOSITORY should pass"

# check-dockerfile-versions.sh in a scratch repo layout.
dv="$tmp/dv"
mkdir -p "$dv/.devcontainer"
run_dv() { (cd "$dv" && bash "$root/scripts/check-dockerfile-versions.sh" "$@" 2>&1); }
printf 'ARG A=1\nARG B="x" # c\nFROM scratch\nARG A\n' >"$dv/.devcontainer/Dockerfile"
printf 'ARG A\nARG A=1\nARG B=x\nFROM scratch\nARG A=1\n' >"$dv/Dockerfile"
run_dv A B >/dev/null || fail "check-dockerfile-versions: matching ARGs (bare re-declaration first) should pass"
printf 'ARG A=1\nFROM scratch\nARG A=2\n' >"$dv/Dockerfile"
out="$(run_dv A)" && fail "check-dockerfile-versions: conflicting defaults in one file should fail"
[[ "$out" == *"conflicting defaults"* ]] || fail "check-dockerfile-versions: wrong message: $out"
printf 'ARG A=2\n' >"$dv/Dockerfile"
out="$(run_dv A)" && fail "check-dockerfile-versions: mismatch should fail"
[[ "$out" == *"mismatch"* ]] || fail "check-dockerfile-versions: wrong message: $out"
printf 'ARG A\n' >"$dv/Dockerfile"
run_dv A >/dev/null && fail "check-dockerfile-versions: no default should fail"
printf 'ARG B=1\n' >"$dv/Dockerfile"
run_dv A >/dev/null && fail "check-dockerfile-versions: missing ARG should fail"

# image-smoke.sh must fail when the tar for the arch under test is missing.
case "$(uname -m)" in
    aarch64 | arm64) host=arm64 other=amd64 ;;
    *) host=amd64 other=arm64 ;;
esac
mkdir -p "$tmp/dist"
smoke() {
    env IMAGE_TAR_PREFIX="$tmp/dist/app-1.0.0" SKOPEO_IMAGE=unused RELEASE_VERSION=1.0.0 "$@" \
        bash "$root/scripts/image-smoke.sh" 2>&1
}
out="$(smoke RELEASE_ARCH="$host")" && fail "image-smoke: missing tar with RELEASE_ARCH should fail"
[[ "$out" == *"not found"* ]] || fail "image-smoke: wrong message: $out"
out="$(smoke ARCHES="$host")" && fail "image-smoke: missing host-arch tar should fail"
[[ "$out" == *"not found"* ]] || fail "image-smoke: wrong message: $out"
smoke ARCHES="$other" >/dev/null || fail "image-smoke: host arch not built by the instance should skip"

# skopeo.sh: no extra docker args (empty array under set -u) and with some.
mkdir -p "$tmp/bin" "$tmp/dist-s"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*"\n' >"$tmp/bin/docker"
chmod +x "$tmp/bin/docker"
sk() { PATH="$tmp/bin:$PATH" SKOPEO_IMAGE=img SKOPEO_DIST_DIR="$tmp/dist-s" bash "$root/scripts/skopeo.sh" "$@"; }
out="$(sk -- copy a b)" || fail "skopeo.sh: no docker args should work"
[[ "$out" == *"img copy a b" ]] || fail "skopeo.sh: unexpected command: $out"
out="$(sk -i -- login)" || fail "skopeo.sh: docker args should work"
[[ "$out" == *" -i img login" ]] || fail "skopeo.sh: unexpected command: $out"

# Makefile publish/finalize credentials, with docker stubbed (it records its
# argv and the stdin of any --password-stdin login): the OCI_REGISTRY_* secrets
# win; with them unset ghcr.io falls back to GITHUB_ACTOR/GITHUB_TOKEN; any
# other registry fails naming the missing secret; the password is only ever
# on stdin, never in an argv.
cr="$tmp/creds"
mkdir -p "$cr/bin" "$cr/dist"
ln -s "$root/scripts" "$cr/scripts"
: >"$cr/dist/r-1.0.0-amd64.tar"
cat >"$cr/bin/docker" <<'EOF_STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_LOG"
case "$*" in *--password-stdin*) cat >"$STUB_STDIN" ;; esac
EOF_STUB
chmod +x "$cr/bin/docker"
# creds_run TARGET REGISTRY [VAR=value ...]: prints make's output (call it in
# $(...), then read the exit code with creds_rc); the stub's argv log is
# left in $cr/log and its stdin in $cr/stdin.
creds_run() {
    local target="$1" registry="$2"
    shift 2
    printf 'sha256:abc' >"$cr/dist/r-1.0.0-amd64.digest" # finalize deletes it
    rm -f "$cr/log" "$cr/stdin"
    : >"$cr/log"
    local rc=0
    (cd "$cr" && env -u OCI_REGISTRY_USERNAME -u OCI_REGISTRY_PASSWORD -u GITHUB_ACTOR -u GITHUB_TOKEN \
        PATH="$cr/bin:$PATH" STUB_LOG="$cr/log" STUB_STDIN="$cr/stdin" GITHUB_REPOSITORY=o/r \
        RELEASE_VERSION=1.0.0 RELEASE_ARCH=amd64 ARCHES=amd64 "$@" \
        make -s -f "$root/Makefile" "$target" OCI_REGISTRY="$registry" 2>&1) || rc=$?
    printf '%s' "$rc" >"$cr/rc"
}
creds_rc() { cat "$cr/rc"; }
for target in publish finalize; do
    out="$(creds_run "$target" ghcr.io OCI_REGISTRY_USERNAME=u OCI_REGISTRY_PASSWORD=sekret GITHUB_ACTOR=a GITHUB_TOKEN=tok)"
    expect_eq "$target secrets: exit" 0 "$(creds_rc)"
    expect_eq "$target secrets: stdin" sekret "$(cat "$cr/stdin")"
    [[ "$(cat "$cr/log")" == *" -u u "* ]] || fail "$target secrets: username not u: $(cat "$cr/log")"
    out="$(creds_run "$target" ghcr.io GITHUB_ACTOR=a GITHUB_TOKEN=tok)"
    expect_eq "$target ghcr fallback: exit" 0 "$(creds_rc)"
    expect_eq "$target ghcr fallback: stdin" tok "$(cat "$cr/stdin")"
    [[ "$(cat "$cr/log")" == *" -u a "* ]] || fail "$target ghcr fallback: username not a: $(cat "$cr/log")"
    [[ "$(cat "$cr/log")" != *tok* && "$(cat "$cr/log")" != *sekret* ]] || fail "$target: password in argv: $(cat "$cr/log")"
    out="$(creds_run "$target" quay.io GITHUB_ACTOR=a GITHUB_TOKEN=tok)"
    [[ "$(creds_rc)" != 0 && "$out" == *OCI_REGISTRY_USERNAME* ]] || fail "$target non-ghcr without secrets should fail naming OCI_REGISTRY_USERNAME (rc=$(creds_rc)): $out"
    [[ ! -s "$cr/log" ]] || fail "$target non-ghcr: docker ran: $(cat "$cr/log")"
    out="$(creds_run "$target" ghcr.io)"
    [[ "$(creds_rc)" != 0 && "$out" == *GITHUB_TOKEN* ]] || fail "$target ghcr without any credential should fail (rc=$(creds_rc)): $out"
    out="$(creds_run "$target" ghcr.io OCI_REGISTRY_USERNAME=u GITHUB_ACTOR=a GITHUB_TOKEN=tok)"
    [[ "$(creds_rc)" != 0 && "$out" == *OCI_REGISTRY_PASSWORD* ]] || fail "$target username without password should fail naming OCI_REGISTRY_PASSWORD (rc=$(creds_rc)): $out"
done

# image-dast.sh in a scratch copy of the repo (it works relative to its own
# repo root), with docker and curl stubbed: skips without a tar, wires ZAP to
# the app container's network and the rules file, and maps zap-baseline.py's
# exit codes (0 and 2 pass, 1 and 3 fail).
dd="$tmp/dast"
mkdir -p "$dd/scripts" "$dd/dist" "$dd/.zap" "$dd/bin"
cp "$root/Makefile" "$dd/"
cp "$root/scripts/image-dast.sh" "$root/scripts/skopeo.sh" "$dd/scripts/"
printf '# header\n10038\tFAIL\t(CSP)\n' >"$dd/.zap/rules.tsv"
cat >"$dd/bin/docker" <<'EOF_STUB'
#!/usr/bin/env bash
echo "docker $*" >>"$DAST_LOG"
case "$1" in
    run)
        if [[ "$*" == *zap-baseline.py* ]]; then
            prev=""
            for a in "$@"; do
                if [[ "$prev" == -v ]]; then ls "${a%%:*}" >>"$DAST_LOG"; fi
                prev="$a"
            done
            exit "${ZAP_EXIT:-0}"
        fi
        if [[ "$*" == *" -d "* ]]; then echo cid123; fi
        ;;
    port) echo "127.0.0.1:49999" ;;
    inspect) echo true ;;
esac
exit 0
EOF_STUB
printf '#!/usr/bin/env bash\nexit 0\n' >"$dd/bin/curl"
chmod +x "$dd/bin/docker" "$dd/bin/curl"
dast() {
    (cd "$dd" && PATH="$dd/bin:$PATH" DAST_LOG="$dd/log" GITHUB_REPOSITORY=o/r "$@" bash scripts/image-dast.sh 2>&1)
}
out="$(dast env)" || fail "image-dast: no tar should skip: $out"
[[ "$out" == *"skipping"* ]] || fail "image-dast: wrong skip message: $out"
touch "$dd/dist/app-1.0.0-$host.tar"
for pair in 0:ok 2:ok 1:fail 3:fail; do
    : >"$dd/log"
    if out="$(dast env ZAP_EXIT="${pair%%:*}")"; then got=ok; else got=fail; fi
    expect_eq "image-dast: zap exit ${pair%%:*}" "${pair##*:}" "$got"
done
log="$(cat "$dd/log")"
[[ "$log" == *"--network container:cid123"* ]] || fail "image-dast: ZAP must join the app container's network: $log"
[[ "$log" == *"-t http://127.0.0.1:8000/health/live"* ]] || fail "image-dast: wrong ZAP target: $log"
[[ "$log" == *"-c rules.tsv"* && "$log" == *$'\nrules.tsv'* ]] || fail "image-dast: rules file not passed: $log"
[[ "$log" != *" -I"* ]] || fail "image-dast: -I would turn FAIL into a pass: $log"
rm "$dd/.zap/rules.tsv"
: >"$dd/log"
dast env >/dev/null || fail "image-dast: missing rules file should still run"
[[ "$(cat "$dd/log")" != *"-c rules.tsv"* ]] || fail "image-dast: -c passed without a rules file"
leftover=()
for f in "$dd"/dist/.image-dast.*; do if [[ -e "$f" ]]; then leftover+=("$f"); fi; done
[[ ${#leftover[@]} -eq 0 ]] || fail "image-dast: left work files in dist/: ${leftover[*]}"

if [[ $failures -ne 0 ]]; then
    echo "$failures failure(s)" >&2
    exit 1
fi
echo "image scripts: all tests passed"
