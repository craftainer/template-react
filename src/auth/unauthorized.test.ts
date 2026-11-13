import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOUNCE_KEY,
  BOUNCE_WINDOW_MS,
  bounceBlocked,
  bounceToLogin,
  clearBounce,
} from "./unauthorized";

/** A `Storage` stand-in; `broken` makes every call throw (storage disabled). */
function memory(initial: Record<string, string> = {}, broken = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (broken) throw new DOMException("denied", "SecurityError");
  };
  return {
    data,
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void data.set(k, v)),
    removeItem: (k: string) => (guard(), void data.delete(k)),
  };
}

const NOW = 1_000_000;

describe("bounceToLogin", () => {
  afterEach(() => window.sessionStorage.clear());

  it("redirects the first time and records the bounce", () => {
    const store = memory();
    const navigate = vi.fn();

    const result = bounceToLogin(
      { attempt: 1 },
      { now: () => NOW, store, navigate },
    );

    expect(result).toBe("redirected");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(store.data.get(BOUNCE_KEY)).toBe(String(NOW));
  });

  it("refuses a second bounce, including after a reload (the marker is in the store)", () => {
    const store = memory({ [BOUNCE_KEY]: String(NOW - 5_000) });
    const navigate = vi.fn();

    expect(
      bounceToLogin({ attempt: 1 }, { now: () => NOW, store, navigate }),
    ).toBe("blocked");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuses when the SDK says this is a repeat (attempt above 1)", () => {
    const store = memory();
    const navigate = vi.fn();

    expect(
      bounceToLogin({ attempt: 2 }, { now: () => NOW, store, navigate }),
    ).toBe("blocked");
    expect(navigate).not.toHaveBeenCalled();
    expect(store.data.has(BOUNCE_KEY)).toBe(false);
  });

  it("allows a new bounce once the old marker is stale", () => {
    const store = memory({ [BOUNCE_KEY]: String(NOW - BOUNCE_WINDOW_MS - 1) });
    const navigate = vi.fn();

    expect(
      bounceToLogin({ attempt: 1 }, { now: () => NOW, store, navigate }),
    ).toBe("redirected");
  });

  it("fails closed when storage is unavailable, unreadable or holds junk", () => {
    const navigate = vi.fn();
    const deps = { now: () => NOW, navigate };

    expect(bounceToLogin({ attempt: 1 }, { ...deps, store: null })).toBe(
      "blocked",
    );
    expect(
      bounceToLogin({ attempt: 1 }, { ...deps, store: memory({}, true) }),
    ).toBe("blocked");
    expect(
      bounceToLogin(
        { attempt: 1 },
        { ...deps, store: memory({ [BOUNCE_KEY]: "junk" }) },
      ),
    ).toBe("blocked");
    expect(
      bounceToLogin(
        { attempt: 1 },
        { ...deps, store: memory({ [BOUNCE_KEY]: String(NOW + 60_000) }) },
      ),
    ).toBe("blocked");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("blocks when the marker cannot be written", () => {
    const store = {
      ...memory(),
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    const navigate = vi.fn();

    expect(
      bounceToLogin({ attempt: 1 }, { now: () => NOW, store, navigate }),
    ).toBe("blocked");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("uses the real sessionStorage by default", () => {
    const navigate = vi.fn();

    expect(bounceToLogin({ attempt: 1 }, { navigate })).toBe("redirected");
    expect(window.sessionStorage.getItem(BOUNCE_KEY)).not.toBeNull();
    expect(bounceToLogin({ attempt: 1 }, { navigate })).toBe("blocked");
  });
});

describe("bounceBlocked / clearBounce", () => {
  it("clearBounce re-arms the guard and tolerates broken storage", () => {
    const store = memory({ [BOUNCE_KEY]: String(NOW) });
    expect(bounceBlocked(NOW, store)).toBe(true);

    clearBounce(store);

    expect(bounceBlocked(NOW, store)).toBe(false);
    expect(() => clearBounce(memory({}, true))).not.toThrow();
    expect(() => clearBounce(null)).not.toThrow();
  });
});
