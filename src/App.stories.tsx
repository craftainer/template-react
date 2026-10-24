import type { Meta, StoryObj } from "@storybook/react-vite";
import { withAdminStub } from "./pages/withAdminStub";
import { within } from "storybook/test";
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
