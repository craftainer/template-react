---
name: frontend-design
description: How to design UI in this repo. Use when building or restyling a screen, component or layout, or when asked for new UI options. Covers the "Field Ledger" direction, its anti-defaults, theme-token rules, motion and accessibility targets.
---

# Frontend design

`docs/design/README.md` is the source of truth for the design system
(direction, tokens, contrast table, motion rules); `docs/adrs/0004-design-system-and-token-lint.md`
says why. Read the design README before designing anything, and do not
copy its rules into code comments or other docs: link to it.

## Direction: Field Ledger

An editorial, archival feel: a ledger kept in a field office. Warm paper
surfaces, ink-dark text, vermilion for the one primary action, bottle
green as the quiet secondary. Fraunces for headings, Instrument Sans for
body. 2px radius; hairline rules do the work that shadows and rounding do
elsewhere. Comfortable density. Aim for a screen that looks *kept* and
*considered*, not assembled from stock components.

## Anti-defaults

Generic MUI output is the failure mode. Do not ship:

- the default MUI blue or any purple/blue gradient;
- default elevation shadows (`elevation`, `Paper` raised, drop-shadow
  cards); use a rule or a 1px divider;
- Roboto, Inter or system-ui as the face of the UI;
- gratuitous gradients, glass blur or decoration;
- cards-everywhere: not every group of content needs a box. Prefer
  typographic hierarchy, rules and whitespace; a table or ledger list
  often beats a grid of cards;
- pill buttons, large radii, ALL-CAPS outside table column heads, or a
  second accent color (status colors are for status only).

## Vary across generations

Left alone, generated UI converges on one stock layout (centered column,
stacked cards, hero plus three tiles). Resist it:

- When asked for a new screen, propose 2-3 distinct options first
  (different structure, not just different colors: e.g. ledger table vs.
  two-pane index/detail vs. an annotated single column), with one line on
  the trade-off each. Let the user pick before building the full thing.
- Pick a deliberate point of view per screen (what is the one thing the
  eye should land on?) and let scale, weight and whitespace carry it.
- Do not reuse the layout of the last screen you built just because it
  worked.

## Always

- Use theme tokens: palette via `sx` names or `theme.vars.palette.*`,
  spacing via `theme.spacing`/`sx` numbers, radius via
  `theme.shape.borderRadius`, motion via `tokens.*`. Never a hex/rgb
  literal or raw `px` outside `src/theme/`. `scripts/check-design-tokens.sh`
  (hook `design-tokens`) enforces it; a justified exception carries
  `// design-tokens: allow <reason>`. Do not add the marker to silence it
  by default.
- Typography via the theme's variants, never a hand-set `fontFamily`.
- Motion: one quiet row reveal (`rowReveal`/`rowRevealContainer` from
  `src/theme/motion.ts`). No looping or decorative motion. The theme wraps
  the app in `MotionConfig reducedMotion="user"`; keep it that way and
  never let motion carry meaning.
- Accessibility: WCAG 2.2 AA (4.5:1 text, 3:1 large text and UI
  boundaries); keep the focus ring; real landmarks (`main`, one `h1`);
  rem sizes so text scales; check 200% zoom. Divider color is never the
  sole boundary of an interactive control.
- Both color schemes are first-class: a component is not done until it
  is checked in light and dark.
- Use the `@mui/mcp` server (see `.claude/README.md`) for MUI component
  APIs and docs instead of guessing props.

When the UI is built, run the `ui-verify` skill and iterate against what
you actually see.
