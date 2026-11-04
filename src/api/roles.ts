// The caller's roles from `GET /bff/user`, for the UI only: they decide which
// buttons to offer, authorization stays server-side. The manifest lists the
// roles each action needs (`auth.write_roles`, `auth.delete_roles`).
import type { BffUser } from "../auth/bff";

/**
 * Every role the BFF reports, whichever realm or client it comes from, or
 * `null` when there is no user (the roles are then unknown).
 */
export function rolesFromUser(
  user: Pick<BffUser, "roles"> | null | undefined,
): ReadonlySet<string> | null {
  if (!user) return null;
  const roles = new Set<string>();
  for (const list of Object.values(user.roles ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const role of list) if (typeof role === "string") roles.add(role);
  }
  return roles;
}

/**
 * Whether to offer an action that needs one of `required`: yes when it names
 * no role or the caller's roles are unknown (the backend decides then).
 */
export function mayDo(
  roles: ReadonlySet<string> | null,
  required: readonly string[],
): boolean {
  return (
    roles === null ||
    required.length === 0 ||
    required.some((role) => roles.has(role))
  );
}
