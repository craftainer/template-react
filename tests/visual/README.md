# tests/visual/

Playwright visual regression and axe checks over the built Storybook
(ADR 0005).

- `run.sh` — builds Storybook and runs the suite inside the pinned Playwright
  image; `run.sh update` rewrites the baselines.
- `stories.visual.ts` — one `toHaveScreenshot` and one axe test per story,
  scheme and viewport, generated from the build's `index.json`.
- `playwright.config.ts`, `serve.mjs` — config and a static server for
  `storybook-static/`.
- `__screenshots__/` — the committed baselines.

## Do

- Generate and check baselines only through `run.sh` (or the `visual.yml`
  job). Look at every changed PNG before committing it.

## Don't

- Generate baselines with a locally installed browser, or raise
  `maxDiffPixels` to quiet a diff.
