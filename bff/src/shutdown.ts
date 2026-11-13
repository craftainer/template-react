// Graceful shutdown. Node is PID 1 in the image and the library installs no
// signal handler, so without this `docker stop` and a pod's termination wait
// out the grace period and are then killed (SIGKILL), cutting in-flight
// proxied writes and login round trips mid-request. On SIGTERM / SIGINT the
// server stops accepting, lets running requests finish and closes its
// connections (Fastify's `close()`), then the process exits; a second signal,
// or a close that outlasts `graceMs`, exits straight away.
import type { FastifyInstance } from "@craftainer/bff";

export interface ShutdownDeps {
  readonly on?: (signal: NodeJS.Signals, handler: () => void) => void;
  readonly exit?: (code: number) => void;
  readonly graceMs?: number;
}

/** Registers the handlers; returns nothing (the process is going away). */
export function closeOnSignal(
  app: Pick<FastifyInstance, "close" | "log">,
  deps: ShutdownDeps = {},
): void {
  const on = deps.on ?? ((signal, handler) => process.once(signal, handler));
  const exit = deps.exit ?? ((code) => process.exit(code));
  const graceMs = deps.graceMs ?? 25_000;
  let closing = false;

  const stop = (signal: NodeJS.Signals) => () => {
    if (closing) {
      exit(1);
      return;
    }
    closing = true;
    app.log.info({ signal }, "shutting down");
    const timer = setTimeout(() => exit(1), graceMs);
    timer.unref();
    app.close().then(
      () => exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, "shutdown failed");
        exit(1);
      },
    );
  };
  on("SIGTERM", stop("SIGTERM"));
  on("SIGINT", stop("SIGINT"));
}
