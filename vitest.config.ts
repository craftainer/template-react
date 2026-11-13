import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // The hook runs next to Keycloak, Chromium and Vite on a few cores; a
    // full-width pool starves them and the run times out. Two workers are
    // enough for a suite this size.
    maxWorkers: 2,
  },
});
