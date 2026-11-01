import { createBff } from "@craftainer/bff";
import type {
  BffConfig,
  CreateBffOptions,
  FastifyInstance,
} from "@craftainer/bff";

/**
 * Builds the BFF: the library's Fastify instance plus this app's own routes.
 * Returns it unstarted (and without calling `ready()`), so tests can
 * `inject()` into it and `main.ts` can `listen()`.
 */
export async function buildApp(
  config: BffConfig,
  opts?: CreateBffOptions,
): Promise<FastifyInstance> {
  const app = await createBff(config, opts);

  // App-specific routes go here, before listen(). Outside /bff/*, /api/*,
  // /health/* and /.well-known/* a path is entirely yours; under /bff/ the
  // library's CSRF rule (non-GET needs `X-CSRF: 1`) and `no-store` apply.
  // This one is only an example; replace or delete it.
  app.get("/bff/ping", () => ({ ok: true }));

  return app;
}
