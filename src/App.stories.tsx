import type { Meta, StoryObj } from "@storybook/react-vite";
import { withAdminStub } from "./pages/withAdminStub";
import { within } from "storybook/test";
import { RuntimeConfigContext } from "./auth/config";
import { ANSWERED_KEY } from "./analytics/consent";
import App from "./App";

const meta = {
  title: "App/App",
  component: App,
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = { parameters: { auth: "signedOut" } };
export const AuthLoading: Story = { parameters: { auth: "loading" } };
export const SignedIn: Story = {
  decorators: [withAdminStub],
  parameters: { auth: "signedIn" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("Captain Ledger");
  },
};
export const BackendDown: Story = {
  parameters: { auth: "signedOut", api: { health: "down" } },
};

/** Analytics is on and this visitor was never asked: the prompt over the page. */
export const AsksForConsent: Story = {
  decorators: [
    (Story) => {
      window.localStorage.removeItem(ANSWERED_KEY);
      return (
        <RuntimeConfigContext.Provider
          value={{
            analytics: { enabled: true, consent: "opt-in", respectGpc: true },
          }}
        >
          <Story />
        </RuntimeConfigContext.Provider>
      );
    },
  ],
  parameters: { auth: "signedOut", api: { consent: "unasked" } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("region", {
      name: /count my visits/i,
    });
  },
};
