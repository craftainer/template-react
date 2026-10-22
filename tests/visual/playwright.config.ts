// Visual regression and axe over the built Storybook (ADR 0005).
// Run it through tests/visual/run.sh: baselines are only valid when rendered
// by the pinned Playwright image, never by a locally installed browser.
import { defineConfig } from "@playwright/test";

const PORT = 6006;

export default defineConfig({
  testDir: ".",
  // Not *.spec.ts: Vitest would pick that up.
  testMatch: "*.visual.ts",
  // One folder per spec, one file per story/scheme/viewport; no OS suffix
  // because the image is the only supported renderer.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  outputDir: "../../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../playwright-report", open: "never" }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Anything above zero would hide real regressions; the pinned image is
      // what makes zero reachable.
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `node serve.mjs ${PORT}`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: false,
  },
});
