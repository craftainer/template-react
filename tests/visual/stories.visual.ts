// One screenshot test and one axe test per story, in light and dark, at a
// fixed viewport (plus a phone width for the whole-app stories). The story
// list comes from the built Storybook's index.json, so a new story is
// covered the moment it exists; its baseline is created with `run.sh update`.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

interface IndexEntry {
  id: string;
  type: string;
  title: string;
}

const index = JSON.parse(
  readFileSync(
    new URL("../../storybook-static/index.json", import.meta.url),
    "utf8",
  ),
) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((e) => e.type === "story");

const schemes = ["light", "dark"] as const;
const viewports = {
  desktop: { width: 1280, height: 720 },
  phone: { width: 390, height: 844 },
};
// Whole-app stories (title "App/...") are also checked at phone width.
const viewportsFor = (title: string) =>
  title.startsWith("App/")
    ? (["desktop", "phone"] as const)
    : (["desktop"] as const);

async function openStory(page: Page, id: string, scheme: string) {
  await page.goto(
    `/iframe.html?id=${id}&viewMode=story&globals=theme:${scheme}`,
  );
  // Storybook has rendered the story and run its play function.
  await page.waitForFunction(() => {
    const phase = (
      window as unknown as {
        __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } };
      }
    ).__STORYBOOK_PREVIEW__?.currentRender?.phase;
    return phase === "finished" || phase === "errored" || phase === "aborted";
  });
  // colorSchemeSelector "data" makes MUI set an empty data-<scheme> attribute.
  await expect(page.locator(`html[data-${scheme}]`)).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

for (const story of stories) {
  for (const vp of viewportsFor(story.title)) {
    for (const scheme of schemes) {
      const name = `${story.id}-${vp}-${scheme}`;

      test.describe(`${story.title} / ${story.id}`, () => {
        test.use({ viewport: viewports[vp], colorScheme: scheme });

        test(`screenshot ${vp} ${scheme}`, async ({ page }) => {
          await openStory(page, story.id, scheme);
          await expect(page).toHaveScreenshot(`${name}.png`, {
            fullPage: true,
          });
        });

        test(`axe ${vp} ${scheme}`, async ({ page }) => {
          await openStory(page, story.id, scheme);
          const { violations } = await new AxeBuilder({ page }).analyze();
          const blocking = violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            blocking.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
          ).toEqual([]);
        });
      });
    }
  }
}
