// The runner stage's `FROM` carries a tag and a digest, and Docker ignores the
// tag when a digest is present, so nothing derives the Node patch from the
// ARGs the builder uses. This test keeps the two equal: the image that serves
// requests runs the Node the bundle was built and tested with.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(
  resolve(import.meta.dirname, "../../Dockerfile"),
  "utf8",
);
const arg = (name: string) =>
  new RegExp(`^ARG ${name}=(\\S+)`, "m").exec(dockerfile)?.[1];

describe("Dockerfile", () => {
  it("runs the runner stage on the Node version the builder uses", () => {
    const from = /^FROM node:(\S+?)@sha256:[0-9a-f]{64} AS runner$/m.exec(
      dockerfile,
    )?.[1];
    expect(from).toBe(`${arg("NODE_VERSION")}-${arg("DEBIAN_VERSION")}-slim`);
  });
});
