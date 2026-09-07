import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("react-oidc-context", () => ({ useAuth: useAuthMock }));

describe("App", () => {
  it("prompts sign-in when unauthenticated", () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(<App />);

    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sign in to view and manage heroes/i),
    ).toBeInTheDocument();
  });

  it("shows a loading indicator while auth is resolving", () => {
    useAuthMock.mockReturnValue({ isLoading: true, isAuthenticated: false });

    render(<App />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
