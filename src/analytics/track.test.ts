import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_PATH,
  browserOptedOut,
  createTracker,
  pathOnly,
} from "./track";

/** The `[url, init]` of the `index`th fetch call. */
function callOf(
  mock: { mock: { calls: unknown[][] } },
  index: number,
): [string, RequestInit] {
  return mock.mock.calls[index] as unknown as [string, RequestInit];
}

function setup(
  respond: () => Promise<Response> = async () =>
    new Response(null, { status: 202 }),
  extra: { optedOut?: () => boolean } = {},
) {
  const fetchImpl = vi.fn(respond);
  let clock = 1_000;
  const tracker = createTracker({
    fetchImpl,
    now: () => clock,
    cooldownMs: 100,
    ...extra,
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    fetchImpl,
    flush,
    track: tracker.track,
    advance: (ms: number) => (clock += ms),
  };
}

describe("track", () => {
  it("posts the event with X-CSRF, keepalive and no referrer", async () => {
    const { fetchImpl, track } = setup();

    track("page.view", { plan: "pro", n: 2, ok: true }, "/admin/heroes?id=7#x");

    const [url, init] = callOf(fetchImpl, 0);
    expect(url).toBe(ANALYTICS_PATH);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("same-origin");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.headers).toMatchObject({ "X-CSRF": "1" });
    expect(JSON.parse(init.body as string)).toEqual({
      name: "page.view",
      props: { plan: "pro", n: 2, ok: true },
      url: "/admin/heroes",
    });
  });

  it("omits props and url when there are none, and drops non-scalar props", () => {
    const { fetchImpl, track } = setup();

    track("a.b", { o: {} as never, nan: Number.NaN, long: "x".repeat(300) });
    track("a.c");

    const first = JSON.parse(callOf(fetchImpl, 0)[1].body as string) as {
      props: { long: string };
    };
    expect(Object.keys(first.props)).toEqual(["long"]);
    expect(first.props.long).toHaveLength(200);
    expect(JSON.parse(callOf(fetchImpl, 1)[1].body as string)).toEqual({
      name: "a.c",
    });
  });

  it("ignores names that break the I3 pattern or length", () => {
    const { fetchImpl, track } = setup();

    track("nodot");
    track("Page.View");
    track(`a.${"b".repeat(50)}`);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends nothing when the browser signals GPC or DNT", () => {
    const { fetchImpl, track } = setup(undefined, { optedOut: () => true });

    track("page.view");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never throws, whether fetch throws or rejects", async () => {
    const throwing = createTracker({
      fetchImpl: () => {
        throw new Error("boom");
      },
    });
    expect(() => throwing.track("a.b")).not.toThrow();

    const { track, flush } = setup(async () => {
      throw new TypeError("network");
    });
    expect(() => track("a.b")).not.toThrow();
    await flush();
  });

  it("goes quiet for the cool-down after a failure, without retrying", async () => {
    const { fetchImpl, track, flush, advance } = setup(
      async () => new Response(null, { status: 503 }),
    );

    track("a.b");
    await flush();
    track("a.c");
    track("a.d");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    advance(101);
    track("a.e");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("goes quiet after a network error and after a 429", async () => {
    const network = setup(async () => {
      throw new TypeError("network");
    });
    network.track("a.b");
    await network.flush();
    network.track("a.c");
    expect(network.fetchImpl).toHaveBeenCalledTimes(1);

    const limited = setup(async () => new Response(null, { status: 429 }));
    limited.track("a.b");
    await limited.flush();
    limited.track("a.c");
    expect(limited.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops one event on a 400 but keeps tracking", async () => {
    const { fetchImpl, track, flush } = setup(
      async () => new Response("{}", { status: 400 }),
    );

    track("a.b");
    await flush();
    track("a.c");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("pathOnly", () => {
  it("strips query and fragment and refuses non-paths", () => {
    expect(pathOnly("/a/b?x=1#y")).toBe("/a/b");
    expect(pathOnly("?x=1")).toBe("/");
    expect(pathOnly("//evil.example/x")).toBe("/");
    expect(pathOnly("https://evil.example/x")).toBe("/");
  });
});

describe("browserOptedOut", () => {
  it("is true for Global Privacy Control or Do Not Track", () => {
    expect(browserOptedOut()).toBe(false);
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(browserOptedOut()).toBe(true);
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    expect(browserOptedOut()).toBe(true);
    vi.unstubAllGlobals();
  });
});
