---
name: ui-verify
description: Verify a UI change visually. Starts the dev server, screenshots 3 viewports in light and dark, runs axe, compares with the stated design intent and iterates. Use after any UI change and before calling it done.
---

# UI verify

A UI change is not done until you have looked at it. Loop: build ->
screenshot -> axe -> compare with intent -> fix -> repeat.

## 1. Start the dev server

```bash
pnpm dev --host --port 5173 --strictPort
```

`--host` so the browser container can reach it; a fixed port with
`--strictPort` so it fails instead of drifting. Use an IP address in the
URL the browser opens (Vite blocks unknown hostnames): the dev
container's own, from `hostname -i`. Run it in the background and wait
for `curl -sf http://127.0.0.1:5173/`.

## 2. Screenshots: 3 viewports x light/dark, plus axe

Viewports: 390 (phone), 834 (tablet), 1440 (desktop). Each in light and
dark: 6 screenshots per page.

**Use the committed helper, not the Playwright MCP.** The Playwright MCP
attaches over CDP (`ws://selenium:4444/.../se/cdp`), which the stack's
Selenium Grid answers with HTTP 400, so it cannot drive that browser. Do
not start a second browser service. `shoot.mjs` instead talks W3C
WebDriver to the stack's existing Selenium, sets the viewport with a
CDP `Emulation.setDeviceMetricsOverride` command (Grid's `goog/cdp/execute`
endpoint works), switches the scheme through the `mui-mode` localStorage
key MUI persists, checks that `html[data-dark]` or `html[data-light]`
matches the requested scheme, injects `axe-core` (a transitive dependency of
`@axe-core/playwright`) and writes the PNGs:

```bash
node .claude/skills/ui-verify/shoot.mjs http://<ip>:5173/<path> <out-dir> <name>
# writes <out-dir>/<name>-{390,834,1440}-{light,dark}.png and <name>-axe.json
# exit 1 on any axe violation or if the wrong scheme was applied
```

`SELENIUM_URL` overrides the default `http://selenium:4444`. The Grid
has one session slot: if a run is killed, the stale session blocks the
next one for up to 5 minutes; delete it with `DELETE
http://selenium:4444/session/<id>` (id from `/status`).

Pages behind sign-in need the same flow driven first; extend the helper
or script the login before the loop. Signed-out pages are fine for a
first pass.

Then look at every PNG (Read the image files). The Playwright MCP is fine
for anything that does not need the stack's Selenium (for example if it
is configured with its own local browser).

## 3. Compare and iterate

For each screenshot, check against the stated intent and
`docs/design/README.md`:

- Field Ledger: paper surfaces, ink text, one vermilion action, 2px
  radius, rules not shadows, Fraunces headings / Instrument Sans body.
- No anti-defaults crept in (default blue, shadows, Roboto, cards
  everywhere, gradients).
- Layout: no wrapped or clipped controls or headings at 390, no
  horizontal scroll, sensible use of space at 1440.
- Dark is not an inversion: contrast holds, accents are the lightened ones.
- Axe: zero violations. Fix real ones in the app; do not disable rules.

Fix, re-run, and repeat until both the screenshots and axe are clean.

## 4. Report

In your final message list the 6 screenshot paths per page, the axe
summary per screenshot (violation ids and counts), what you compared
against, and what you changed or still see wrong. Never claim a pass
without having read the screenshots.
