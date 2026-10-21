# 0004. Design system ("Field Ledger") and the design-token lint hook

## Status

Accepted

## Context

Track UI of `docs/plans/2026-10-templates-sdks-ui.md` wants a UI that does
not look like default model output (Roboto/Inter, purple gradients, no
motion) and stays consistent as Claude and people add screens. The user
picked aesthetic direction A, "Field Ledger", from three RS3 prototypes
(2026-10-20): Fraunces + Instrument Sans, warm paper / vermilion / bottle
green, comfortable density, 2px radius, one quiet row reveal. The prototype
was a scratch theme; this ADR records how it became the production system.

## Decision

**Theme.** `src/theme/` holds one MUI theme (`createTheme` with
`cssVariables` and `colorSchemes` light and dark) built from `tokens.ts`,
the only place raw colors and px values live. `colorSchemeSelector` is
`"data"` (not the prototype's `"media"`) so the app can offer a light/dark
toggle: with `"media"` MUI cannot set the mode; with `"data"` and
`defaultMode="system"` it still follows the OS until the user chooses.
`useColorMode()` wraps MUI's `useColorScheme`. Fonts are imported from
`@fontsource-variable/*` (self-hosted; the Roboto import is gone from
`main.tsx`).

**Motion.** Duration and easing tokens are shared by Motion and CSS. The row
reveal is a pair of Motion variants. `<ThemeProvider>` also mounts
`MotionConfig reducedMotion="user"`, which drops transforms (keeping
opacity) under `prefers-reduced-motion`.

**Lint.** `scripts/check-design-tokens.sh` rejects hex/`rgb()`/`hsl()`
literals and raw `px` values in `src/**/*.{ts,tsx,css}` outside
`src/theme/`, as the pre-commit hook `design-tokens`. An exception is an
inline `design-tokens: allow <reason>` marker; a marker without a reason
fails. The hook runs the script's `--self-test` (fixtures for every
violation kind, the marker and the `src/theme/` exemption) before scanning,
so the checker cannot silently stop catching things.

**Contrast** is asserted in `src/theme/contrast.test.ts` (WCAG 2.2 AA, 4.5:1
for text); the ratios are in `docs/design/README.md`.

## Consequences

- Palette or radius changes happen in one file; components never hardcode.
- The check is a line-based grep, not a parser: it can flag a color-like
  string in a comment (use the marker) and miss a color built at runtime
  from string pieces. Accepted: it is a guardrail for Claude-written code,
  not a security boundary.
- `rem`, `%` and theme spacing replace `px` in app code; `1px` hairlines
  come from theme overrides.
- No pre-paint init script: a user whose saved choice differs from the OS
  can see one frame of the OS scheme. Adding MUI's `InitColorSchemeScript`
  to `index.html` fixes it if that matters; deferred to keep `index.html`
  untouched here.
- The `ThemeProvider` wrapper is a third place (with `main.tsx` and
  Storybook, UI3) that must mount the theme; stories should use the same
  wrapper.
