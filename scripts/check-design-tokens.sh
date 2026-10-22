#!/usr/bin/env bash
# Design-token guard (ADR 0004): rejects hex/rgb/hsl color literals and raw
# `px` values in src/**/*.{ts,tsx,css} outside src/theme/, so every color and
# size comes from the theme (src/theme/tokens.ts).
#
# usage: check-design-tokens.sh [SRC_DIR]     (default: src)
#        check-design-tokens.sh --self-test   (runs against built-in fixtures)
#
# Any `#` plus 3, 4, 6 or 8 hex characters counts as a color, so an id like
# `#fade` or `#123` also matches; opt those out with the marker below.
#
# A line may opt out with an inline marker and a non-empty reason:
#   width: "1px", // design-tokens: allow hairline needed by third-party widget
# A marker without a reason is itself a violation.
set -euo pipefail

COLOR_RE='#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(rgb|rgba|hsl|hsla)\('
PX_RE='(^|[^A-Za-z0-9_.])-?[0-9]*\.?[0-9]+px\b'
MARKER='design-tokens: allow'

scan() {
  local root="$1" status=0 file
  while IFS= read -r -d '' file; do
    local n=0 line
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      local kind=""
      if [[ "$line" == *"$MARKER"* ]]; then
        local reason="${line#*"$MARKER"}"
        reason="${reason//[[:space:]*\/]/}"
        if [ -z "$reason" ]; then
          echo "$file:$n: '$MARKER' needs a reason after it" >&2
          status=1
        fi
        continue
      fi
      if grep -Eq -- "$COLOR_RE" <<<"$line"; then kind="color literal"; fi
      if [ -z "$kind" ] && grep -Eq -- "$PX_RE" <<<"$line"; then kind="raw px value"; fi
      if [ -n "$kind" ]; then
        echo "$file:$n: $kind outside src/theme/ (use a theme token): ${line#"${line%%[![:space:]]*}"}" >&2
        status=1
      fi
    done <"$file"
  done < <(find "$root" -path "$root/theme" -prune -o -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | sort -z)
  return "$status"
}

self_test() {
  local d fail=0
  d="$(mktemp -d)"
  trap 'rm -rf "$d"' RETURN
  mkdir -p "$d/theme" "$d/ok" "$d/bad"
  echo 'export const c = "#B3361B"; export const p = "4px";' >"$d/theme/tokens.ts"
  printf 'const w = "100%%"; const id = "#root"; const v = "var(--x)";\n' >"$d/ok/clean.tsx"
  printf 'const w = "1px"; // design-tokens: allow hairline for a third-party widget\n' >"$d/ok/marked.tsx"
  echo 'a { color: #fff; }' >"$d/bad/hex.css"
  echo 'const c = "#abcdef";' >"$d/bad/hex6.ts"
  echo 'const c = "rgba(0, 0, 0, 0.5)";' >"$d/bad/rgb.ts"
  echo 'const c = "hsl(10 20% 30%)";' >"$d/bad/hsl.ts"
  echo 'const s = { width: "12px" };' >"$d/bad/px.tsx"
  echo 'const s = { mt: "-4px" };' >"$d/bad/negpx.tsx"
  echo 'a { margin: 0.5px; }' >"$d/bad/px.css"
  echo 'const w = "1px"; // design-tokens: allow' >"$d/bad/noreason.ts"

  scan "$d/ok" >/dev/null 2>&1 || { echo "self-test: clean fixtures were rejected" >&2; fail=1; }
  local f
  for f in hex.css hex6.ts rgb.ts hsl.ts px.tsx negpx.tsx px.css noreason.ts; do
    rm -rf "$d/one" && mkdir -p "$d/one" && cp "$d/bad/$f" "$d/one/"
    if scan "$d/one" >/dev/null 2>&1; then
      echo "self-test: $f was not rejected" >&2
      fail=1
    fi
  done
  # theme/ itself must be exempt.
  mkdir -p "$d/only" && cp -r "$d/theme" "$d/only/theme"
  scan "$d/only" >/dev/null 2>&1 || { echo "self-test: src/theme/ was not exempt" >&2; fail=1; }
  [ "$fail" -eq 0 ] && echo "check-design-tokens self-test: ok"
  return "$fail"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
else
  scan "${1:-src}"
fi
