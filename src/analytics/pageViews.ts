// Page views for an app without a router (ADR 0006): the admin's navigation
// state lives in the query string through crud-views' `UrlAdapter`, so a
// "page" is the path plus that state's resource and view. Record ids, filters
// and paging (which can carry personal data) never leave the browser: the
// reported `url` is a bare path such as `/admin/heroes/trash`.
import { useEffect, useRef, useState } from "react";
import { defaultUrlAdapter, type UrlAdapter } from "@craftainer/crud-views";
import { useDefaultResource } from "./defaultResource";
import { track } from "./track";

export const PAGE_VIEW_EVENT = "page.view";

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** The reported path for a location: `<pathname>[/<resource>[/<view>|/record]]`. */
export function viewPath(
  pathname: string,
  search: string,
  defaultResource?: string,
): string {
  const params = new URLSearchParams(search);
  const base = pathname.replace(/\/+$/, "");
  const parts = [base];
  // The admin leaves `resource` out when it shows its default (first) one.
  const resource = params.get("resource") ?? defaultResource;
  if (resource && SEGMENT.test(resource)) {
    parts.push(resource);
    const view = params.get("view");
    if (view && SEGMENT.test(view)) parts.push(view);
    else if (params.has("id")) parts.push("record"); // never the id itself
  }
  return parts.join("/") || "/";
}

/**
 * Sends `page.view` once per distinct view: on mount and whenever the
 * adapter's state changes the reported path (filter or paging changes do not).
 */
const windowPathname = () => window.location.pathname;

export function usePageViews(
  adapterArg?: UrlAdapter,
  pathname: () => string = windowPathname,
  send: typeof track = track,
): void {
  // Created once: a fresh default adapter per render would re-run the effect
  // and re-send the same view.
  const [adapter] = useState(() => adapterArg ?? defaultUrlAdapter());
  const defaultResource = useDefaultResource();
  // Survives the effect re-running when the default resource arrives, so the
  // same path is not sent twice.
  const last = useRef<string | null>(null);
  useEffect(() => {
    const report = () => {
      const path = viewPath(pathname(), adapter.read(), defaultResource);
      if (path === last.current) return;
      last.current = path;
      send(PAGE_VIEW_EVENT, undefined, path);
    };
    report();
    return adapter.subscribe(report);
  }, [adapter, pathname, send, defaultResource]);
}
