// What must happen when the session ends or the signed-in user changes: the
// SDK does not notice (crud-sdk README, "Logout and user switch"), so the app
// clears its response cache and tears down anything streaming for the old
// user, otherwise the next user could read the previous user's data or get
// events from the previous user's stream. Owners register a teardown while
// they hold such state (the SDK cache and query client in src/api/CrudApi.tsx;
// today the app opens no event hub, and any future `invalidateOnEvents` or
// `subscribeEvents` unsubscribe belongs here too); logout runs them all.
type Teardown = () => void | Promise<void>;

const registered = new Set<Teardown>();

/** Registers `fn`; the returned function removes it. */
export function registerTeardown(fn: Teardown): () => void {
  registered.add(fn);
  return () => {
    registered.delete(fn);
  };
}

/**
 * Runs every registered teardown. A failing one never stops the others or the
 * logout (the BFF session is already gone, and the cache is in memory, so the
 * navigation that follows drops it anyway); it is logged, without data, so
 * the failure is visible.
 */
export async function runTeardown(): Promise<void> {
  const results = await Promise.allSettled(
    [...registered].map(async (fn) => {
      await fn();
    }),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Session teardown step failed", result.reason);
    }
  }
}
