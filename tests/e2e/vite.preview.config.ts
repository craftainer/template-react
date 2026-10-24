// vite.config.ts plus `preview.cors: false`. Vite's own servers add
// `Vary: Origin` to every response, proxied ones included, and
// @craftainer/crud-sdk's cache refuses to store a response that varies on
// anything but Authorization/Accept/Accept-Encoding -- so without this the SDK
// never holds a record's ETag and no save is conditional. The production
// image's nginx adds no such header (docs/adrs/0006-manifest-driven-admin.md).
import { defineConfig, mergeConfig, type ConfigEnv } from "vite";
import base from "../../vite.config";

export default defineConfig((env: ConfigEnv) =>
  mergeConfig(typeof base === "function" ? base(env) : base, {
    preview: { cors: false },
  }),
);
