# 0005. Storybook, visual regression and axe checks

## Status

Accepted

## Context

Track UI of `docs/plans/2026-10-templates-sdks-ui.md` wants every component
visible in isolation and a pass/fail signal for how it looks, so that neither
a person nor Claude can change the Field Ledger system (ADR 0004) without
noticing. Pixel baselines are only worth having if the same inputs always give
the same pixels, and CI has to reproduce what a developer generated locally.

The plan said to generate baselines "in the toolchain container against the
stack's Chromium". Two things stood in the way. The stack's Selenium Grid
cannot be driven by Playwright: its CDP endpoint answers `ws://selenium:4444/.../se/cdp`
with HTTP 400 (found in UI1 and UI2), and `toHaveScreenshot` needs Playwright's
own browser connection. And the toolchain image has no fonts or browser
libraries, and installing them with `playwright install --with-deps` pulls
unpinned Debian packages, so the renderer would depend on the day it was built.

## Decision

**Storybook 10** (`@storybook/react-vite`, `@storybook/addon-a11y`) with a
story next to every component (`*.stories.tsx`). `.storybook/preview.tsx` wraps
every story in the app's own `ThemeProvider` and a toolbar switch for the
`theme` global (light or dark, applied through MUI's `useColorScheme`, so the
`html[data-dark]` or `html[data-light]` attribute is the real one). Sign-in state and the
backend are faked per story with `parameters.auth` (`signedOut`, `signedIn`,
`loading`) and `parameters.api` (`health`, `heroes`), implemented in
`.storybook/stubs.tsx`; stories never reach Keycloak or the API. Stories are
covered by the design-token lint.

**Browser: Playwright's own Chromium, in the pinned official Playwright image**
(`mcr.microsoft.com/playwright:v1.64.1-noble`, also pinned by digest), not the stack's Selenium
Chromium and not a browser installed into the toolchain image. The image tag
equals the `@playwright/test` version, ships exactly that version's browser
build and a fixed font set, and is the single renderer for both baselines and
checks: `tests/visual/run.sh` runs it locally against the working tree
(`docker run`, no new service) and `visual.yml` runs the job inside the same
image. The app's own fonts are self-hosted (`@fontsource-variable/*`), so system
fonts only matter for fallbacks. This differs from the plan's wording in the
image, not in intent: the baselines are rendered in a container, by one browser
build, with fonts that cannot drift.

**Architecture.** The baselines are rendered on `arm64`, so the CI job runs on
the `arm64` runner (`vars.CI_RUNNER_ARM64`, default `ubuntu-24.04-arm`). Chromium
output can differ between CPU architectures at the pixel level; one pinned
architecture is what makes a zero-pixel tolerance reachable. Developers on
`amd64` hosts should run `run.sh` with `--platform linux/arm64` (emulated and
slow) or let CI be the judge and download its report.

**Tests.** `tests/visual/stories.visual.ts` reads the built Storybook's
`index.json`, so a new story is covered without editing the spec. For each
story it runs, in light and dark, `toHaveScreenshot` (full page, animations
disabled, `maxDiffPixels: 0`) at 1280x720, and an axe scan
(`@axe-core/playwright`) that fails on serious and critical violations.
Whole-app stories (title `App/...`) also run at 390x844. Baselines are
committed under `tests/visual/__screenshots__/`.

**Updating baselines.** After an intended visual change:
`tests/visual/run.sh update`, then look at every changed PNG in the diff
(`git diff --stat`, open the images) before committing them with the change
that caused them. Never update to make a red run green without looking. A
Playwright version bump changes the image tag and its `@sha256:` digest
(`docker buildx imagetools inspect <image>`, the index digest) in `run.sh` and
`visual.yml` together and regenerates all baselines in the same commit.

**CI.** `.github/workflows/visual.yml` runs on pull requests and on demand:
install, `storybook build`, `playwright test`; on failure it uploads
`playwright-report/` and `test-results/` (expected, actual and diff images) as
an artifact.

## Consequences

- A visual change is a reviewable diff of PNGs, and an accessibility
  regression fails the build before it reaches the page.
- The suite needs Docker locally and a Playwright image pull (about 1.5 GB);
  Playwright's version is pinned in three places (`package.json`, `run.sh`,
  `visual.yml`) that must move together. A mismatch fails loudly: Playwright
  refuses a browser build that is not its own.
- Baselines are valid for `arm64` only. Moving CI to `amd64` means
  regenerating them there.
- axe only sees what a story renders. It finds roughly the automatable half of
  WCAG issues; keyboard and screen-reader behaviour still need a human.
- `.storybook/stubs.tsx` and the baselines are instance content; the rest of
  the setup is template-owned and copies to other instances (it is the base for
  `lib-crud-views-ts`).
