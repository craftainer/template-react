import { describe, expect, it, vi } from "vitest";
import { registerTeardown, runTeardown } from "./teardown";

describe("teardown registry", () => {
  it("runs every registered teardown and waits for async ones", async () => {
    const order: string[] = [];
    const off = [
      registerTeardown(() => void order.push("sync")),
      registerTeardown(async () => {
        await Promise.resolve();
        order.push("async");
      }),
    ];

    await runTeardown();

    expect(order.sort()).toEqual(["async", "sync"]);
    off.forEach((f) => f());
  });

  it("keeps going when one throws, and skips an unregistered one", async () => {
    const survivor = vi.fn();
    const removed = vi.fn();
    const offThrowing = registerTeardown(() => {
      throw new Error("boom");
    });
    const offSurvivor = registerTeardown(survivor);
    registerTeardown(removed)();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runTeardown();

    expect(log).toHaveBeenCalledWith(
      "Session teardown step failed",
      expect.any(Error),
    );
    log.mockRestore();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    offThrowing();
    offSurvivor();
  });
});
