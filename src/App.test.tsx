import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("./auth/authContext", () => ({ useAuth: useAuthMock }));
const { usePageViewsMock } = vi.hoisted(() => ({ usePageViewsMock: vi.fn() }));
vi.mock("./analytics/pageViews", () => ({ usePageViews: usePageViewsMock }));

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
