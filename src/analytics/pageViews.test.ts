import { renderHook } from "@testing-library/react";
import { act } from "react";
import { memoryUrlAdapter } from "@craftainer/crud-views";
import { describe, expect, it, vi } from "vitest";
import { setDefaultResource } from "./defaultResource";
import { PAGE_VIEW_EVENT, usePageViews, viewPath } from "./pageViews";

describe("viewPath", () => {
  it("reports path, resource and view, never the id, filters or paging", () => {
    expect(viewPath("/admin", "")).toBe("/admin");
    expect(viewPath("/admin/", "resource=heroes")).toBe("/admin/heroes");
    expect(viewPath("/admin", "resource=heroes&view=trash&q=ada&page=3")).toBe(
      "/admin/heroes/trash",
    );
    expect(viewPath("/admin", "resource=heroes&id=42")).toBe(
      "/admin/heroes/record",
    );
    expect(viewPath("/", "")).toBe("/");
  });

  it("falls back to the admin's default resource when the URL names none", () => {
    expect(viewPath("/", "view=trash", "heroes")).toBe("/heroes/trash");
    expect(viewPath("/", "", "heroes")).toBe("/heroes");
    expect(viewPath("/", "id=42", "heroes")).toBe("/heroes/record");
    expect(viewPath("/", "resource=villains&view=trash", "heroes")).toBe(
      "/villains/trash",
    );
    expect(viewPath("/", "view=trash")).toBe("/");
    expect(viewPath("/", "view=trash", "../x")).toBe("/");
  });

  it("ignores values that are not plain segments", () => {
    expect(viewPath("/admin", "resource=../x")).toBe("/admin");
    expect(viewPath("/admin", "resource=heroes&view=a%2Fb")).toBe(
      "/admin/heroes",
    );
  });
});

describe("usePageViews", () => {
  it("sends one page.view per distinct view and stops on unmount", () => {
    const adapter = memoryUrlAdapter("resource=heroes");
    const send = vi.fn();
    const { unmount } = renderHook(() =>
      usePageViews(adapter, () => "/admin", send),
    );
    expect(send).toHaveBeenCalledWith(
      PAGE_VIEW_EVENT,
      undefined,
      "/admin/heroes",
    );

    act(() => adapter.write("resource=heroes&q=ada", "push")); // filter only
    expect(send).toHaveBeenCalledTimes(1);

    act(() => adapter.write("resource=heroes&view=trash", "push"));
    expect(send).toHaveBeenLastCalledWith(
      PAGE_VIEW_EVENT,
      undefined,
      "/admin/heroes/trash",
    );
    expect(send).toHaveBeenCalledTimes(2);

    unmount();
    act(() => adapter.write("resource=heroes", "push"));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports the default resource once the admin publishes it, without a duplicate", () => {
    const adapter = memoryUrlAdapter("view=trash");
    const send = vi.fn();
    renderHook(() => usePageViews(adapter, () => "/", send));
    expect(send).toHaveBeenLastCalledWith(PAGE_VIEW_EVENT, undefined, "/");

    act(() => setDefaultResource("heroes"));
    expect(send).toHaveBeenLastCalledWith(
      PAGE_VIEW_EVENT,
      undefined,
      "/heroes/trash",
    );
    expect(send).toHaveBeenCalledTimes(2);

    act(() => setDefaultResource("heroes")); // unchanged
    expect(send).toHaveBeenCalledTimes(2);
    act(() => setDefaultResource(undefined));
    expect(send).toHaveBeenLastCalledWith(PAGE_VIEW_EVENT, undefined, "/");
  });

  it("does not re-send the same view when the host re-renders", () => {
    const send = vi.fn();
    const pathname = () => "/admin";
    const { rerender } = renderHook(() =>
      usePageViews(undefined, pathname, send),
    );
    rerender();
    rerender();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
