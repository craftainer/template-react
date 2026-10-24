// Storybook decorator that serves the admin's fake backend (adminStub.ts).
import { useState, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { installAdminStub, type AdminStubOptions } from "./adminStub";

/**
 * Installs the fake when the story first renders, and re-assigns it on every
 * render because the global decorator re-installs its own whenever it renders.
 */
function AdminStub({
  options,
  children,
}: {
  options: AdminStubOptions | undefined;
  children: ReactNode;
}) {
  const [stub] = useState(() => installAdminStub(options));
  window.fetch = stub.fetch;
  return children;
}

/** Replaces the global API stub with the admin's; options: `parameters.adminStub`. */
export const withAdminStub: Decorator = (Story, { parameters }) => (
  <AdminStub options={parameters.adminStub as AdminStubOptions | undefined}>
    <Story />
  </AdminStub>
);
