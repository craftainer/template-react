import { describe, expect, it } from "vitest";
import { mayDo, rolesFromToken } from "./roles";

const token = (claims: object) =>
  `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_")}.s`;

describe("rolesFromToken", () => {
  it("reads realm roles and the named client's roles", () => {
    const roles = rolesFromToken(
      token({
        realm_access: { roles: ["offline_access"] },
        resource_access: {
          api: { roles: ["viewer", "editor"] },
          other: { roles: ["admin"] },
        },
      }),
      "api",
    );

    expect([...(roles ?? [])].sort()).toEqual([
      "editor",
      "offline_access",
      "viewer",
    ]);
  });

  it("is null for a missing or malformed token, empty for one without roles", () => {
    expect(rolesFromToken(undefined, "api")).toBeNull();
    expect(rolesFromToken("not-a-jwt", "api")).toBeNull();
    expect(rolesFromToken("a.%%%.c", "api")).toBeNull();
    expect(
      rolesFromToken(token({ resource_access: { api: {} } }), "api")?.size,
    ).toBe(0);
  });
});

describe("mayDo", () => {
  it("needs one of the required roles, or none being required", () => {
    expect(mayDo(new Set(["viewer"]), ["editor", "maintainer"])).toBe(false);
    expect(mayDo(new Set(["editor"]), ["editor", "maintainer"])).toBe(true);
    expect(mayDo(new Set(), [])).toBe(true);
    expect(mayDo(null, ["editor"])).toBe(true);
  });
});
