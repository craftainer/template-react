import { afterEach, describe, expect, it, vi } from "vitest";
import { createCrudClient } from "./crud";

interface Widget {
  id: number;
  name: string;
}

interface WidgetCreate {
  name: string;
}

describe("createCrudClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists records against the base path", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify([{ id: 1, name: "a" }])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCrudClient<Widget, WidgetCreate>("/crud/v1/widgets");
    const result = await client.list("tok");

    expect(result).toEqual([{ id: 1, name: "a" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/crud/v1/widgets");
  });

  it("creates a record via POST", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 1, name: "a" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCrudClient<Widget, WidgetCreate>("/crud/v1/widgets");
    await client.create("tok", { name: "a" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/crud/v1/widgets");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "a" }));
  });

  it("removes a record by id via DELETE", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createCrudClient<Widget, WidgetCreate>("/crud/v1/widgets");
    await client.remove("tok", 5);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/crud/v1/widgets?id=5");
    expect(init?.method).toBe("DELETE");
  });
});
