import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { fetchConsent, saveConsent, useConsent } from "./consent";

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

  it("stores a choice, and falls back to unknown when saving fails", async () => {
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

    await act(() => result.current.choose(false));
    expect(result.current.granted).toBeNull();
  });
});
