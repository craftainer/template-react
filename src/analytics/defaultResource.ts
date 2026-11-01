// The admin resource shown when the URL names none (the first one in the
// caller's manifest). Only the admin knows it, and it sits below the page-view
// hook in the tree, so the admin publishes it here and `usePageViews` reads it:
// without it, an admin with one resource (which writes `?view=trash` alone)
// would report every view as `/`.
import { useSyncExternalStore } from "react";

let current: string | undefined;
const listeners = new Set<() => void>();

/** Called by the admin; `undefined` clears it (manifest not loaded, unmounted). */
export function setDefaultResource(name: string | undefined): void {
  if (name === current) return;
  current = name;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => current;

export function useDefaultResource(): string | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
