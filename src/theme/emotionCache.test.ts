import { afterEach, describe, expect, it } from "vitest";
import { createEmotionCache, readCspNonce } from "./emotionCache";

function addMeta(nonce?: string) {
  const meta = document.createElement("meta");
  meta.setAttribute("property", "csp-nonce");
  if (nonce !== undefined) meta.nonce = nonce;
  document.head.append(meta);
  return meta;
}

afterEach(() => {
  document.head.querySelector('meta[property="csp-nonce"]')?.remove();
});

describe("readCspNonce", () => {
  it("reads the nonce property of the csp-nonce meta tag", () => {
    addMeta("abc123");
    expect(readCspNonce()).toBe("abc123");
  });

  it("is undefined without a meta tag", () => {
    expect(readCspNonce()).toBeUndefined();
  });

  it("is undefined when the meta tag carries no nonce", () => {
    addMeta();
    expect(readCspNonce()).toBeUndefined();
  });
});

describe("createEmotionCache", () => {
  it("passes the nonce from the meta tag to the cache", () => {
    addMeta("abc123");
    const cache = createEmotionCache();
    expect(cache.nonce).toBe("abc123");
    expect(cache.key).toBe("mui");
  });

  it("works without a nonce", () => {
    const cache = createEmotionCache();
    expect(cache.nonce).toBeUndefined();
    expect(cache.key).toBe("mui");
  });

  it("tags the style elements it inserts with the nonce", () => {
    const cache = createEmotionCache("n0nce");
    expect(cache.sheet.tags.length).toBe(0);
    cache.sheet.insert(".x{color:red}");
    expect(cache.sheet.tags[0]?.nonce).toBe("n0nce");
    cache.sheet.flush();
  });
});
