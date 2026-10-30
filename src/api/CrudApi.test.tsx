import { cleanup, render, screen } from "@testing-library/react";
import { useCrud } from "@craftainer/crud-views";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installAdminStub } from "../pages/adminStub";
import { CrudApiProvider } from "./CrudApi";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth/authContext", () => ({ useAuth: useAuthMock }));

function Scope() {
  const { namespace } = useCrud();
  return <output>{namespace ? namespace.scope : "pending"}</output>;
}

async function scopeFor(user: unknown): Promise<string> {
  useAuthMock.mockReturnValue({ isAuthenticated: true, user });
  installAdminStub();
  render(
    <CrudApiProvider>
      <Scope />
    </CrudApiProvider>,
  );
  const output = await screen.findByText(/^(?!pending$).+/);
  const text = output.textContent ?? "";
  cleanup();
  return text;
}

describe("CrudApiProvider query scope", () => {
  const realFetch = window.fetch;
  afterEach(() => {
    cleanup();
    window.fetch = realFetch;
  });

  it("uses the BFF user's sub, so two users never share a scope", async () => {
    const a = await scopeFor({ sub: "u1", name: "A", roles: {} });
    const b = await scopeFor({ sub: "u2", name: "B", roles: {} });

    expect(a).toBe("u1");
    expect(b).toBe("u2");
  });

  it("falls back to the SDK namespace without a sub", async () => {
    expect(await scopeFor(undefined)).toBe("anon");
  });
});
