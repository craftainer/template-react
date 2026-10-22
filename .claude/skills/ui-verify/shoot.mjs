// Screenshots one page at 3 viewports x light/dark through the stack's
// Selenium over W3C WebDriver, and runs axe-core on each. See SKILL.md.
//
// usage: node shoot.mjs <url-as-selenium-sees-it> <out-dir> [name]
// env:   SELENIUM_URL (default http://selenium:4444)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [url, outDir, name = "page"] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("usage: node shoot.mjs <url> <out-dir> [name]");
  process.exit(2);
}
const hub = process.env.SELENIUM_URL ?? "http://selenium:4444";
const viewports = [
  { label: "390", width: 390, height: 844 },
  { label: "834", width: 834, height: 1112 },
  { label: "1440", width: 1440, height: 900 },
];
const modes = ["light", "dark"];

// axe-core is a transitive dependency of @axe-core/playwright.
const require = createRequire(import.meta.url);
const axePath = createRequire(require.resolve("@axe-core/playwright")).resolve(
  "axe-core/axe.min.js",
);
const axeSource = readFileSync(axePath, "utf8");

async function call(method, path, body) {
  const res = await fetch(hub + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json.value;
}

const created = await call("POST", "/session", {
  capabilities: {
    alwaysMatch: {
      browserName: "chrome",
      "goog:chromeOptions": { args: ["--hide-scrollbars"] },
    },
  },
});
const sid = created.sessionId;
const s = (p) => `/session/${sid}${p}`;
const run = (script, args = []) => call("POST", s("/execute/sync"), { script, args });
mkdirSync(outDir, { recursive: true });

const summary = [];
try {
  for (const vp of viewports) {
    // Emulate the viewport exactly; a window resize cannot go below the
    // browser chrome's minimum width.
    await call("POST", s("/goog/cdp/execute"), {
      cmd: "Emulation.setDeviceMetricsOverride",
      params: { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.width < 600 },
    });
    for (const mode of modes) {
      await call("POST", s("/url"), { url });
      await run("localStorage.setItem('mui-mode', arguments[0])", [mode]);
      await call("POST", s("/url"), { url });
      await new Promise((r) => setTimeout(r, 1500));
      // With colorSchemeSelector "data", MUI sets data-mui-color-scheme on <html>.
      const scheme = await run(
        "return document.documentElement.getAttribute('data-mui-color-scheme')",
      );
      const png = await call("GET", s("/screenshot"));
      const file = `${outDir}/${name}-${vp.label}-${mode}.png`;
      writeFileSync(file, Buffer.from(png, "base64"));
      const axe = await call("POST", s("/execute/async"), {
        script:
          axeSource +
          ";var done=arguments[arguments.length-1];axe.run(document).then(function(r){done(r.violations.map(function(v){return {id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length,targets:v.nodes.slice(0,3).map(function(n){return n.target.join(' ')})}}))})",
        args: [],
      });
      summary.push({ file, scheme, violations: axe });
      console.log(`${file}  scheme=${scheme}  axe violations=${axe.length}`);
      for (const v of axe) console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes} nodes) ${v.targets.join(" | ")}`);
    }
  }
} finally {
  await call("DELETE", s(""));
}
writeFileSync(`${outDir}/${name}-axe.json`, JSON.stringify(summary, null, 2));
const bad = summary.some((r) => r.violations.length > 0 || r.scheme !== r.file.split("-").pop().replace(".png", ""));
process.exit(bad ? 1 : 0);
