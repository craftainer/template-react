import type { Meta, StoryObj } from "@storybook/react-vite";
import { heroFixtures } from "../.storybook/stubs";
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
  parameters: { auth: "signedIn", api: { heroes: heroFixtures } },
};
export const BackendDown: Story = {
  parameters: { auth: "signedOut", api: { health: "down" } },
};
