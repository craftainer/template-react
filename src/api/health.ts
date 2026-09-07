// Public health probes -- app.controllers.health, no auth required (see the
// backend's FR-0010/FR-0011).
import { apiFetch } from "./client";

export function checkLive(): Promise<unknown> {
  return apiFetch("/health/live");
}
