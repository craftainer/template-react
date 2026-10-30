import { describe, expect, it } from "vitest";
import { mayDo, rolesFromUser } from "./roles";

describe("rolesFromUser", () => {
  it("collects the roles of every realm or client the BFF reports", () => {
    const roles = rolesFromUser({
      roles: { realm: ["offline_access"], api: ["viewer", "editor"] },
    });

    expect([...(roles ?? [])].sort()).toEqual([
      "editor",
      "offline_access",
      "viewer",
    ]);
  });

  it("is null without a user, empty for one without roles", () => {
    expect(rolesFromUser(null)).toBeNull();
    expect(rolesFromUser(undefined)).toBeNull();
    expect(rolesFromUser({ roles: {} })?.size).toBe(0);
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
