import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("./auth/authContext", () => ({ useAuth: useAuthMock }));
const { usePageViewsMock } = vi.hoisted(() => ({ usePageViewsMock: vi.fn() }));
vi.mock("./analytics/pageViews", () => ({ usePageViews: usePageViewsMock }));
// The admin needs the API; these tests are about the app bar.
vi.mock("./pages/AdminPage", () => ({ AdminPage: () => null }));

describe("App", () => {
  // Vitest globals are off, so Testing Library does not clean up on its own.
  afterEach(cleanup);

  it("reports page views", () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(<App />);

    expect(usePageViewsMock).toHaveBeenCalled();
  });

  it("prompts sign-in when unauthenticated", () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(<App />);

    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sign in to view and manage records/i),
    ).toBeInTheDocument();
  });

  it("has a main landmark and one h1 when unauthenticated", () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: false });

    render(<App />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows a loading indicator while auth is resolving", () => {
    useAuthMock.mockReturnValue({ isLoading: true, isAuthenticated: false });

    render(<App />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("App sign-out", () => {
  afterEach(cleanup);

  it("says so when signing out failed, and clears the message on the next try", async () => {
    const logout = vi
      .fn()
      .mockRejectedValueOnce(new Error("POST /bff/logout failed"))
      .mockResolvedValueOnce(undefined);
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { name: "Ada", sub: "u1", roles: {} },
      logout,
    });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not sign you out/i,
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
