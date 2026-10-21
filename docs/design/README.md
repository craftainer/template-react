# docs/design/

The design system's principles: what the app should look and feel like,
and the rules that keep it that way. The tokens themselves live in code
(`src/theme/`); this page says how to use them. Why the system is shaped
this way is in
[`../adrs/0004-design-system-and-token-lint.md`](../adrs/0004-design-system-and-token-lint.md).

## Direction: "Field Ledger"

Chosen by the user on 2026-10-20 from three candidates (RS3). An editorial,
archival feel: a ledger kept in a field office.

- **Type:** Fraunces (display, headings) and Instrument Sans (body, UI),
  both self-hosted variable fonts from `@fontsource-variable/*`. No CDN.
- **Color:** warm paper surfaces, vermilion for the one primary action,
  bottle green as the quiet secondary. Ink-dark text, never pure black.
- **Density:** comfortable. Table cells pad 14px/16px; buttons 8px/20px.
- **Shape:** 2px radius everywhere. Rules (hairlines) do the work that
  shadows and rounding do elsewhere: a 2px ink rule under the app bar and
  table header, 1px dividers between rows.
- **Motion:** one quiet row reveal (fade plus a 4px settle, staggered 30ms).

## Anti-defaults

Generic output is the failure mode this system exists to avoid. Do not:

- fall back to Roboto, Inter or system-ui as the face of the UI;
- use purple/blue gradients, glass blur, or drop-shadow cards;
- round things beyond the 2px base, or use pill buttons;
- use ALL-CAPS anywhere except table column heads;
- add decoration motion (parallax, bouncing, looping). One reveal only;
- reach for a second accent color. Status colors (error, warning, info,
  success) are for status, not decoration.

## Token usage

- Colors come from the MUI palette via CSS variables: `sx={{ color:
  "text.secondary" }}`, or `theme.vars.palette.*` in style callbacks.
  Never a hex, `rgb()` or `hsl()` literal outside `src/theme/`.
- Spacing is `theme.spacing(n)` (8px unit); `sx={{ p: 2 }}` already uses
  it. Never a raw `px` outside `src/theme/`. Use `rem`, `%`, theme
  spacing or a token.
- Radius comes from `theme.shape.borderRadius` (2px) or `tokens.radius`.
- Fonts: headings use the theme's typography variants (`h1`–`h6`, which
  carry Fraunces); do not set `fontFamily` by hand.
- Motion durations and easings are `tokens.duration`, `tokens.easing`,
  `tokens.cssMotion`. The row reveal is `rowRevealContainer` + `rowReveal`
  from `src/theme/motion.ts`.
- `scripts/check-design-tokens.sh` (pre-commit hook `design-tokens`)
  rejects violations in `src/**/*.{ts,tsx,css}`. A justified exception
  carries an inline marker on the same line, with a reason:
  `// design-tokens: allow <reason>`. A marker with no reason fails.

Public API (`import { ... } from "./theme"`): `ThemeProvider`, `theme`,
`tokens`, `useColorMode`, `rowReveal`, `rowRevealContainer`.

## Light and dark

- Both schemes are first-class and ship together; a component is not done
  until it is checked in both.
- The default is the OS preference. `useColorMode()` returns `mode`
  (`"light" | "dark" | "system"`), `resolved`, `setMode` and `toggle`;
  MUI persists the choice in `localStorage`.
- Colors switch through CSS variables under a data attribute on the root element, so
  `sx` and `theme.vars.*` need no per-scheme branches. Dark is not an
  inversion: ink and paper swap, and accents lighten (vermilion
  `#E8795C`, green `#9CC0A8`) to keep contrast.
- Known limit: there is no pre-paint init script, so a user who chose a
  scheme different from the OS can see one frame of the OS scheme on
  load.

## Contrast

Target: WCAG 2.2 AA, 4.5:1 for text, 3:1 for large text and UI
boundaries. `src/theme/contrast.test.ts` asserts every pair below at
4.5:1 and fails the build if a palette edit breaks one.

| Pair                              | Light  | Dark  |
| --------------------------------- | -----: | ----: |
| text.primary on paper             | 15.74  | 13.56 |
| text.secondary on paper           |  7.11  |  7.29 |
| text.secondary on default         |  6.65  |  7.92 |
| primary on paper                  |  5.68  |  5.80 |
| primary contrastText on primary   |  5.75  |  6.30 |
| secondary on paper                |  9.09  |  8.33 |
| error on paper                    |  7.45  |  6.85 |
| warning on paper                  |  5.92  |  7.88 |
| info on paper                     |  6.35  |  7.82 |
| success on paper                  |  5.97  |  8.52 |

Divider on paper is 1.47 (light) and 1.35 (dark). It is decoration, not
the only cue for anything; never use it as the sole boundary of an
interactive control (use the 2px ink rule or a text-colored border,
which clear 3:1).

## Motion and accessibility

- `<ThemeProvider>` wraps the app in `MotionConfig reducedMotion="user"`:
  under `prefers-reduced-motion`, transforms are dropped and only
  opacity animates. CSS transitions in the theme are short (160ms) color
  changes only.
- Motion never carries meaning on its own and never blocks input.
- Keep MUI's focus ring; do not remove outlines.
- Text scales: sizes are `rem`, so the browser's font-size setting
  applies. Check layouts at 200% zoom.
- Run axe over every story and page (UI3 automates this).
