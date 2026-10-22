#!/usr/bin/env bash
# Usage: check-dockerfile-versions.sh ARG [ARG...]
#
# Each named ARG must be declared (`ARG NAME=value`) with the same default
# in both the base-owned .devcontainer/Dockerfile (develop stage) and the
# top-level Dockerfile (builder/runner stages): the runtime image must match
# the toolchain the devcontainer tests against. Values are compared after
# stripping trailing comments, whitespace and surrounding quotes. Exits 1 if
# one differs, is missing from either file, is declared without a default or
# has defaults that disagree within a file. ARGs not named are not checked.
set -euo pipefail

if [[ $# -eq 0 ]]; then
    echo "usage: $0 ARG [ARG...]" >&2
    exit 2
fi

# Prints the normalized default of `ARG name=...` in file $2, or exits:
# 0 with the value, 3 when the ARG is not declared, 4 when it is declared
# without a default, 5 when its defaults within the file disagree. A file
# may declare an ARG several times (a bare `ARG name` re-declares it inside
# a stage, and a stage may repeat the default): bare re-declarations are
# ignored and every default must agree. Normalizing strips a trailing
# comment, surrounding whitespace and one pair of surrounding quotes.
default_of() {
    local line value found=0 first="" have=0
    while IFS= read -r line; do
        found=1
        [[ "$line" == *=* ]] || continue
        line="${line#*=}"
        value="$(sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' <<<"$line")"
        if [[ $have -eq 0 ]]; then
            first="$value"
            have=1
        elif [[ "$value" != "$first" ]]; then
            return 5
        fi
    done < <(grep -E "^ARG[[:space:]]+$1([=[:space:]]|\$)" "$2" || true)
    [[ $found -eq 1 ]] || return 3
    [[ $have -eq 1 ]] || return 4
    printf '%s\n' "$first"
}

status=0
for arg in "$@"; do
    ok=1
    values=()
    for f in .devcontainer/Dockerfile Dockerfile; do
        rc=0
        v="$(default_of "$arg" "$f")" || rc=$?
        case $rc in
            0) values+=("$v") ;;
            3) echo "${arg} missing: not declared in $f" >&2; ok=0 ;;
            4) echo "${arg} declared without a default in $f" >&2; ok=0 ;;
            *) echo "${arg} declared with conflicting defaults in $f" >&2; ok=0 ;;
        esac
    done
    if [[ $ok -eq 1 && "${values[0]}" != "${values[1]}" ]]; then
        echo "${arg} mismatch: .devcontainer/Dockerfile has '${values[0]}', Dockerfile has '${values[1]}'" >&2
        ok=0
    fi
    [[ $ok -eq 1 ]] || status=1
done
exit "$status"
