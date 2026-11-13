import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeConfigContext, type RuntimeConfig } from "../auth/config";
import { ConsentBanner } from "./ConsentBanner";
import { ANSWERED_KEY } from "./consent";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ENABLED: RuntimeConfig = {
  analytics: { enabled: true, consent: "opt-in", respectGpc: true },
};

/** `GET /bff/consent` answers `stored`; `POST` answers `post` (default: echo). */
function stubBff(stored: boolean | "fail", post?: "fail") {
  const calls: string[] = [];
  window.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${init?.body ?? ""}`);
    if (method === "POST") {
      return post === "fail"
        ? json({}, 500)
        : json({ analytics: JSON.parse(String(init?.body)).analytics });
    }
    return stored === "fail" ? json({}, 503) : json({ analytics: stored });
  }) as unknown as typeof fetch;
  return calls;
}

function setup(config: RuntimeConfig = ENABLED) {
  return render(
    <RuntimeConfigContext.Provider value={config}>
      <ConsentBanner />
    </RuntimeConfigContext.Provider>,
  );
}

describe("ConsentBanner", () => {
  const realFetch = window.fetch;
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: undefined,
      configurable: true,
    });
  });

  it("asks a visitor who has not answered, with two equal choices", async () => {
    stubBff(false);
    setup();

    const region = await screen.findByRole("region", {
      name: /count my visits/i,
    });
    expect(region).toHaveAccessibleDescription(/which pages are used/i);
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("stores Allow in the BFF, remembers it was asked, and leaves the settings button focused", async () => {
    const calls = stubBff(false);
    setup();

    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));

    expect(calls).toContain('POST {"analytics":true}');
    const settings = await screen.findByRole("button", {
      name: /analytics settings/i,
    });
    expect(screen.queryByRole("region")).toBeNull();
    expect(window.localStorage.getItem(ANSWERED_KEY)).toBe("1");
    await waitFor(() => expect(settings).toHaveFocus());
  });

  it("stores Decline, and does not ask again on the next visit", async () => {
    const calls = stubBff(false);
    const first = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Decline" }),
    );
    expect(calls).toContain('POST {"analytics":false}');
    first.unmount();

    setup();

    expect(
      await screen.findByRole("button", { name: /analytics settings/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("does not ask a visitor who already allowed it (the BFF cookie says so)", async () => {
    stubBff(true);
    setup();

    expect(
      await screen.findByRole("button", { name: /analytics settings/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("reopens from the settings button, says what is stored, and focuses the prompt", async () => {
    stubBff(true);
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /analytics settings/i }),
    );

    const region = await screen.findByRole("region");
    expect(region).toHaveTextContent(/currently: allowed/i);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /count my visits/i }),
      ).toHaveFocus(),
    );
  });

  it("keeps the prompt and says so when the choice could not be saved", async () => {
    stubBff(false, "fail");
    setup();

    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not save/i,
    );
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(window.localStorage.getItem(ANSWERED_KEY)).toBeNull();
  });

  it("asks when the stored choice cannot be read (unknown is not consent)", async () => {
    stubBff("fail");
    setup();

    expect(await screen.findByRole("region")).toBeInTheDocument();
  });

  it("renders nothing when analytics is off, unconfigured or the config is unknown", async () => {
    const calls = stubBff(false);
    for (const config of [
      {},
      { analytics: { enabled: false } },
      { analytics: "yes" },
      { analytics: null },
    ]) {
      const view = setup(config);
      await new Promise((r) => setTimeout(r, 10));
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it("renders nothing under Global Privacy Control: events are dropped anyway", async () => {
    stubBff(false);
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    const view = setup();

    await new Promise((r) => setTimeout(r, 10));
    expect(view.container).toBeEmptyDOMElement();
  });

  it("renders nothing until the stored choice has been read", () => {
    window.fetch = vi.fn(() => new Promise<Response>(() => {})) as never;
    const view = setup();

    expect(view.container).toBeEmptyDOMElement();
  });
});
