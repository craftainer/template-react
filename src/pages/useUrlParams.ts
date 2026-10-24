// The admin's own navigation state (which resource, which view, which
// record) lives in the query string, next to the list state crud-views keeps
// there through the same adapter -- the app has no router, and deep links and
// the back button work from the address bar alone.
import { useCallback, useSyncExternalStore } from "react";
import { defaultUrlAdapter, type UrlAdapter } from "@craftainer/crud-views";

export type ParamUpdate = Readonly<Record<string, string | null>>;

/**
 * The value of query parameter `name` and a setter. `set` takes one or more
 * updates at once (`null` removes a parameter), keeps every other parameter
 * (the lists' filter and paging state) and adds a history entry.
 */
export function useUrlParams(adapter: UrlAdapter = defaultUrlAdapter()) {
  const search = useSyncExternalStore(
    adapter.subscribe,
    adapter.read,
    () => "",
  );
  const params = new URLSearchParams(search);

  const update = useCallback(
    (changes: ParamUpdate) => {
      const next = new URLSearchParams(adapter.read());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      adapter.write(next.toString(), "push");
    },
    [adapter],
  );

  return { params, update };
}
