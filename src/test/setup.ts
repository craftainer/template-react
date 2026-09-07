import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Tests never hit a real backend -- HealthStatus polls it from an effect on
// every render, so a global stub keeps that from becoming per-test boilerplate.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response(null, { status: 200 })),
);
