import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ANSWERED_KEY,
  fetchConsent,
  hasAnswered,
  markAnswered,
  saveConsent,
  useConsent,
} from "./consent";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("fetchConsent / saveConsent", () => {
  it("reads the stored choice", async () => {
    const fetchImpl = vi.fn(async () => json({ analytics: true }));
    expect(await fetchConsent(fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/bff/consent",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("stores a choice with X-CSRF and returns the BFF's answer", async () => {
    const fetchImpl = vi.fn(async () => json({ analytics: false }));
    expect(await saveConsent(false, fetchImpl)).toBe(false);
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-CSRF": "1" });
    expect(init.body).toBe('{"analytics":false}');
  });

  it("answers null on a failure, a bad body or a network error", async () => {
    expect(await fetchConsent(async () => json({}, 500))).toBeNull();
    expect(
      await fetchConsent(async () => json({ analytics: "yes" })),
    ).toBeNull();
    expect(
      await saveConsent(true, async () => {
        throw new TypeError("network");
      }),
    ).toBeNull();
  });
});

describe("useConsent", () => {
  it("is unknown until the one GET answers, and makes no further request", async () => {
    const fetchImpl = vi.fn(async () => json({ analytics: true }));
    const { result } = renderHook(() => useConsent(fetchImpl));
    expect(result.current.granted).toBeNull();

    await waitFor(() => expect(result.current.granted).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stays unknown when the GET fails", async () => {
    const fetchImpl = vi.fn(async () => json({}, 503));
    const { result } = renderHook(() => useConsent(fetchImpl));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(result.current.granted).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stores a choice, and keeps the previous one when saving fails", async () => {
    const responses = [
      json({ analytics: false }),
      json({ analytics: true }),
      json({}, 500),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const { result } = renderHook(() => useConsent(fetchImpl));
    await waitFor(() => expect(result.current.granted).toBe(false));

    await act(() => result.current.choose(true));
    expect(result.current.granted).toBe(true);

    let saved: boolean | null = true;
    await act(async () => {
      saved = await result.current.choose(false);
    });
    expect(saved).toBeNull();
    expect(result.current.granted).toBe(true);
  });

  it("is ready once the first read settled, even a failed one, and after a choice that pre-empts it", async () => {
    const failing = vi.fn(async () => json({}, 503));
    const a = renderHook(() => useConsent(failing));
    expect(a.result.current.ready).toBe(false);
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    expect(a.result.current.granted).toBeNull();

    const never = vi.fn((_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.resolve(json({}, 500))
        : new Promise<Response>(() => {}),
    ) as unknown as typeof fetch;
    const b = renderHook(() => useConsent(never));
    await act(() => b.result.current.choose(true));
    expect(b.result.current.ready).toBe(true);
  });

  it("ignores a slow mount-time GET that resolves after a choice", async () => {
    let releaseGet: (r: Response) => void = () => {};
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ analytics: true })
        : new Promise<Response>((resolve) => {
            releaseGet = resolve;
          }),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useConsent(fetchImpl));

    await act(() => result.current.choose(true));
    expect(result.current.granted).toBe(true);

    await act(async () => releaseGet(json({ analytics: false })));
    expect(result.current.granted).toBe(true);
  });
});

describe("answered flag", () => {
  it("remembers that the visitor was asked, not what they chose", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(hasAnswered(store)).toBe(false);

    markAnswered(store);

    expect(hasAnswered(store)).toBe(true);
    expect([...data.entries()]).toEqual([[ANSWERED_KEY, "1"]]);
  });

  it("treats unavailable or throwing storage as not asked", () => {
    const broken = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(hasAnswered(broken)).toBe(false);
    expect(hasAnswered(null)).toBe(false);
    expect(() => markAnswered(broken)).not.toThrow();
    expect(() => markAnswered(null)).not.toThrow();
  });
});
