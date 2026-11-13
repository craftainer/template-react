import { describe, expect, it, vi } from "vitest";
import { closeOnSignal } from "./shutdown.ts";

function setup(close: () => Promise<void>) {
  const handlers = new Map<string, () => void>();
  const exit = vi.fn();
  const app = {
    close: vi.fn(close),
    log: { info: vi.fn(), error: vi.fn() },
  };
  closeOnSignal(app as never, {
    on: (signal, handler) => handlers.set(signal, handler),
    exit,
    graceMs: 50,
  });
  return { handlers, exit, app };
}

describe("closeOnSignal", () => {
  it("handles SIGTERM and SIGINT", () => {
    const { handlers } = setup(async () => undefined);
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("closes the server, then exits 0", async () => {
    const { handlers, exit, app } = setup(async () => undefined);
    handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when closing fails", async () => {
    const { handlers, exit, app } = setup(async () => {
      throw new Error("boom");
    });
    handlers.get("SIGINT")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(app.log.error).toHaveBeenCalled();
  });

  it("exits 1 straight away on a second signal", () => {
    const { handlers, exit, app } = setup(() => new Promise(() => undefined));
    handlers.get("SIGTERM")!();
    handlers.get("SIGINT")!();
    expect(exit).toHaveBeenCalledWith(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when closing outlasts the grace period", async () => {
    const { handlers, exit } = setup(() => new Promise(() => undefined));
    handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
