#!/usr/bin/env bash
# Print the owasp-scan target list for the repository in the current
# directory, one "<category><TAB><path>" line per file (read-only).
#
# Every git-tracked file is a target unless it is skipped for one of
# these reasons (tracked files are source, so there are no test, build,
# dist, target or generated exclusions):
#   lockfile            an explicit list of lockfile names (osv-scanner's job)
#   vendored            vendor/, third_party/, node_modules/ at any depth
#   binary / empty      not text
#   too-large           over 256 KiB (listed by --skipped, reported as not scanned)
#   link-or-submodule   a symlink or gitlink: its content is not scanned here
#   missing             tracked but absent from the worktree
#
# Category: the first rule that matches wins, in this order:
#   1 workflow   .github/workflows/*.yml|*.yaml
#   2 workflow   composite action (action.yml|action.yaml at any depth)
#   3 docker     Dockerfile, Dockerfile.*, *.Dockerfile, Containerfile[.*]
#   4 compose    compose[.*].y[a]ml, docker-compose*.y[a]ml
#   5 code by extension:
#       shell *.sh *.bash *.zsh Makefile GNUmakefile *.mk
#       python *.py   tsjs *.ts *.tsx *.js *.jsx *.mjs *.cjs *.mts *.cts
#       rust *.rs
#   6 shebang interpreter basename (also via /usr/bin/env [-S] [VAR=x] X):
#       sh bash dash zsh ksh ash -> shell; python* pypy* -> python;
#       node deno bun tsx ts-node -> tsjs
#   7 config     *.yml *.yaml *.json *.jsonc *.toml *.ini *.cfg *.conf
#                *.properties *.env .env .env.* Caddyfile
#   8 generic    any other text file
#
# Usage: discover-targets.sh [--summary] [--skipped]
#   (default)  targets on stdout as "<category><TAB><path>", sorted
#   --summary  target counts per category, then "not-scanned <reason> <n>"
#   --skipped  "skip:<reason><TAB><path>" for every skipped tracked file
set -euo pipefail

mode=targets
for arg in "$@"; do
  case "$arg" in
    --summary|--skipped)
      if [ "$mode" != targets ] && [ "$mode" != "${arg#--}" ]; then echo "--summary and --skipped cannot be combined" >&2; exit 2; fi
      mode=${arg#--} ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

MAX_BYTES=262144 # files over 256 KiB are listed, not scanned

skip_reason() { # $1 = path; prints a reason when the file is never a target
  case "${1##*/}" in
    package-lock.json|npm-shrinkwrap.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb|deno.lock|flake.lock|composer.lock|Cargo.lock|uv.lock|poetry.lock|pdm.lock|Pipfile.lock|Gemfile.lock|go.sum|gradle.lockfile|packages.lock.json|Podfile.lock|mix.lock|pubspec.lock|.terraform.lock.hcl) echo lockfile; return ;;
  esac
  case "$1" in
    node_modules/*|*/node_modules/*|vendor/*|*/vendor/*|third_party/*|*/third_party/*) echo vendored ;;
  esac
}

SHEBANG_KIND=""
shebang_kind() { # $1 = path; sets SHEBANG_KIND from the interpreter basename
  local first="" words word interp
  SHEBANG_KIND=""
  IFS= read -r first < "$1" 2>/dev/null || true
  first=${first%$'\r'}
  case "$first" in '#!'*) ;; *) return 0 ;; esac
  read -r -a words <<< "${first#\#!}"
  [ "${#words[@]}" -gt 0 ] || return 0
  interp=${words[0]##*/}
  if [ "$interp" = env ]; then
    interp=""
    for word in "${words[@]:1}"; do
      case "$word" in -*|*=*) continue ;; esac
      interp=${word##*/}
      break
    done
  fi
  case "$interp" in
    sh|bash|dash|zsh|ksh|ash) SHEBANG_KIND=shell ;;
    python*|pypy*) SHEBANG_KIND=python ;;
    node|deno|bun|tsx|ts-node) SHEBANG_KIND=tsjs ;;
  esac
}

categorise() { # $1 = path; prints the category
  local base=${1##*/}
  case "$1" in
    .github/workflows/*.yml|.github/workflows/*.yaml) echo workflow; return ;;
  esac
  case "$base" in
    action.yml|action.yaml) echo workflow; return ;;
    Dockerfile|Dockerfile.*|*.Dockerfile|Containerfile|Containerfile.*) echo docker; return ;;
    compose.yml|compose.yaml|compose.*.yml|compose.*.yaml|docker-compose*.yml|docker-compose*.yaml) echo compose; return ;;
    *.sh|*.bash|*.zsh|Makefile|GNUmakefile|*.mk) echo shell; return ;;
    *.py) echo python; return ;;
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.mts|*.cts) echo tsjs; return ;;
    *.rs) echo rust; return ;;
  esac
  shebang_kind "$1"
  if [ -n "$SHEBANG_KIND" ]; then echo "$SHEBANG_KIND"; return; fi
  case "$base" in
    *.yml|*.yaml|*.json|*.jsonc|*.toml|*.ini|*.cfg|*.conf|*.properties|*.env|.env|.env.*|Caddyfile) echo config ;;
    *) echo generic ;;
  esac
}

emit() { # prints "<category-or-skip:reason>\t<path>" for every tracked file
  local f reason
  while IFS= read -r -d '' f; do
    if [ -L "$f" ] || [ -d "$f" ]; then printf 'skip:link-or-submodule\t%s\n' "$f"; continue; fi
    if [ ! -e "$f" ]; then printf 'skip:missing\t%s\n' "$f"; continue; fi
    reason=$(skip_reason "$f")
    if [ -n "$reason" ]; then printf 'skip:%s\t%s\n' "$reason" "$f"; continue; fi
    if [ ! -s "$f" ]; then printf 'skip:empty\t%s\n' "$f"; continue; fi
    if ! grep -Iq -- '' < "$f" 2>/dev/null; then printf 'skip:binary\t%s\n' "$f"; continue; fi
    if [ "$(wc -c < "$f")" -gt "$MAX_BYTES" ]; then printf 'skip:too-large\t%s\n' "$f"; continue; fi
    printf '%s\t%s\n' "$(categorise "$f")" "$f"
  done < <(git ls-files -z)
}

case "$mode" in
  targets) emit | grep -v '^skip:' | sort || true ;;
  skipped) emit | grep '^skip:' | sort || true ;;
  summary)
    all=$(emit)
    if [ -n "$all" ]; then
      printf '%s\n' "$all" | grep -v '^skip:' | cut -f1 | sort | uniq -c | sort -rn || true
      printf '%s\n' "$all" | grep '^skip:' | cut -f1 | sort | uniq -c | sed -E 's/^ *([0-9]+) skip:(.*)$/not-scanned \2 \1/' || true
    fi
    ;;
esac
