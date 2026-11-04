import createCache from "@emotion/cache";
import type { EmotionCache } from "@emotion/cache";

/**
 * The per-request CSP nonce the BFF put into the served HTML. Vite's
 * `html.cspNonce` (vite.config.ts) emits `<meta property="csp-nonce"
 * nonce="__CSP_NONCE__">` and the BFF swaps the placeholder per request.
 * Browsers hide a `nonce` attribute from `getAttribute`, so this reads the
 * `.nonce` property. Undefined when there is no meta tag or no nonce (tests,
 * Storybook); under `vite dev` it is the literal placeholder, which nothing
 * enforces.
 */
export function readCspNonce(doc: Document = document): string | undefined {
  const meta = doc.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  return meta?.nonce || undefined;
}

/**
 * Emotion's cache for MUI, per MUI's CSP guide: the nonce goes on every
 * injected `<style>`, and `prepend` keeps Emotion's styles ahead of any
 * others in `<head>`, as `StyledEngineProvider injectFirst` would.
 */
export function createEmotionCache(nonce = readCspNonce()): EmotionCache {
  return createCache({ key: "mui", nonce, prepend: true });
}
