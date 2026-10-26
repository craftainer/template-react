# Design workflow

How a UI change is made and checked in this repository, from the tokens it
may use to the screenshots it must pass. Each step has a source of truth
elsewhere; this page puts them in order and says which check runs when. For
the manifest-driven admin itself see
[ADR 0006](../adrs/0006-manifest-driven-admin.md), which this page does not
repeat.

Why a workflow and not just a style guide: models default to generic output
(Inter, purple gradients, minimal motion) unless they are given a specific
direction, the real component library, one place for tokens with a lint, and a
way to see what they built. Each step below supplies one of those, and the
guidance steps load only when a UI task needs them rather than sitting in every
prompt.

## The loop

| Step          | What                                                              | Enforced by                                                                                               | Runs                                                         |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Direction  | "Field Ledger" and its anti-defaults, read before designing       | the `frontend-design` skill (`.claude/skills/frontend-design/`), which points at [`README.md`](README.md) | when Claude builds or restyles UI                            |
| 2. Components | Real MUI props, not guesses                                       | the `mui-mcp` server (`@mui/mcp`, pinned in `.mcp.json`), which `frontend-design` tells Claude to use     | while writing                                                |
| 3. Tokens     | Colors, spacing, radius and motion come from `src/theme/`         | the `design-tokens` hook (`scripts/check-design-tokens.sh`)                                               | pre-commit and `prek run --all-files --hook-stage manual`    |
| 4. Isolation  | A story beside every component                                    | Storybook 10 (`pnpm storybook`, port 6006)                                                                | on demand                                                    |
| 5. Look       | 3 viewports, light and dark, axe, compared with the stated intent | the `ui-verify` skill (`.claude/skills/ui-verify/`)                                                       | while Claude works; before calling a UI change done          |
| 6. Regression | Pixel baselines and axe over every story                          | `tests/visual/`                                                                                           | `tests/visual/run.sh` locally; `visual.yml` on pull requests |

Steps 1, 2 and 5 are guidance for Claude and give no pass/fail signal on
their own. Steps 3 and 6 are checks that fail the build.

## Tokens and the lint hook

`src/theme/` is the one MUI theme (CSS variables, light and dark) and
`tokens.ts` is the only place a raw color or `px` value may be written. The
rules for using the tokens are in [`README.md`](README.md), "Token usage";
the reasoning is in [ADR 0004](../adrs/0004-design-system-and-token-lint.md).

What the hook does and does not catch, so a green run is read correctly:

- It rejects hex, `rgb()` and `hsl()` literals and raw `px` values in
  `src/**/*.{ts,tsx,css}` outside `src/theme/`. Test files are skipped;
  stories are scanned.
- It is a line-based grep with a self-test, not a parser. It can flag a color
  word in a comment and miss a color assembled at runtime.
- A justified exception carries `// design-tokens: allow <reason>` on the same
  line. A marker with no reason fails. Do not add one to get past the hook;
  move the value into the theme instead.

## Storybook, visual regression and axe

Every component has a `*.stories.tsx` beside it. `.storybook/preview.tsx`
wraps stories in the app's `ThemeProvider` and adds a light/dark toolbar
switch; sign-in state and the backend are faked per story
(`parameters.auth`, `parameters.api`), so stories never reach Keycloak or the
API. The whole setup, and why the renderer is what it is, is
[ADR 0005](../adrs/0005-storybook-visual-regression-and-axe.md).

`tests/visual/stories.visual.ts` reads the built Storybook's `index.json`, so a
new story is covered without editing the spec. For each story, in light and
dark, it takes a full-page screenshot at 1280x720 (zero pixel tolerance) and
runs an axe scan that fails on serious and critical violations; `App/...`
stories also run at 390x844. Baselines are committed in
`tests/visual/__screenshots__/`.

Things that are easy to get wrong:

- Baselines are rendered in the pinned Playwright image on `arm64`, and only
  there. `run.sh` refuses to run elsewhere; on an `amd64` host let `visual.yml`
  judge and download its report.
- After an intended visual change run `tests/visual/run.sh update`, then open
  every changed PNG before committing it with the change that caused it. Never
  update a baseline to turn a red run green without looking, and never raise
  `maxDiffPixels`.
- The suite is not part of `prek`. It needs Docker and a Playwright image pull,
  so it runs through `run.sh` and the `visual` workflow.
- axe sees only what a story renders and finds roughly the automatable part of
  WCAG. Keyboard and screen-reader behaviour still need a person.
- The Playwright version is pinned in `package.json`, `tests/visual/run.sh`
  and `.github/workflows/visual.yml` (tag and digest); they move together.

## `ui-verify`

The skill is the loop Claude runs while it works: start the dev server
(`pnpm dev --host --port 5173 --strictPort`), screenshot each page at 390, 834
and 1440 wide in light and dark (6 PNGs per page) with axe, read every
screenshot, compare it with the intent and `README.md`, fix, and repeat until
the screenshots and axe are clean. The final message lists the PNG paths, the
axe summary per screenshot and what was compared.

It uses the committed helper `.claude/skills/ui-verify/shoot.mjs`, not the
Playwright MCP. The stack's Selenium Grid answers the MCP's CDP attach with
HTTP 400, so the helper drives that existing browser over W3C WebDriver (and
sets the viewport through the Grid's CDP-execute endpoint). The Playwright MCP
remains fine where a browser of its own is available. Pages behind sign-in need
the sign-in flow scripted first.

`ui-verify` and the visual suite answer different questions. `ui-verify` asks
whether a new or changed screen looks right and is usable, at the sizes users
have, before any baseline exists. The visual suite asks whether anything that
was already approved has changed.

## Related

- [`README.md`](README.md): direction, anti-defaults, token usage, contrast,
  motion.
- [ADR 0004](../adrs/0004-design-system-and-token-lint.md),
  [ADR 0005](../adrs/0005-storybook-visual-regression-and-axe.md),
  [ADR 0006](../adrs/0006-manifest-driven-admin.md).
- [`tests/visual/README.md`](../../tests/visual/README.md),
  [`tests/e2e/README.md`](../../tests/e2e/README.md).
