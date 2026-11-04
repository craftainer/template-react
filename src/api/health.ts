// Public health probe of the backend behind the BFF -- app.controllers.health,
// no auth required (see the backend's FR-0010/FR-0011). It must work signed
// out, so a 401 does not send the user to login.
import { apiFetch } from "./client";

export function checkLive(): Promise<unknown> {
  return apiFetch("/health/live", { redirectOnUnauthorized: false });
}
