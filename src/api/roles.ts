// The caller's Keycloak roles, read from the access token's claims (not
// verified here: the backend verifies it on every request, this only decides
// which buttons to offer). The manifest lists the roles each action needs
// (`auth.write_roles`, `auth.delete_roles`).

interface RoleClaims {
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown } | undefined>;
}

const asRoles = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((role): role is string => typeof role === "string")
    : [];

/**
 * The realm roles and the client `clientId`'s roles in an access token, or
 * `null` when the token is not a readable JWT (the roles are then unknown).
 */
export function rolesFromToken(
  token: string | undefined,
  clientId: string,
): ReadonlySet<string> | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64)) as RoleClaims;
    return new Set([
      ...asRoles(claims.realm_access?.roles),
      ...asRoles(claims.resource_access?.[clientId]?.roles),
    ]);
  } catch {
    return null;
  }
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
