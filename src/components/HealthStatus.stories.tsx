import type { Meta, StoryObj } from "@storybook/react-vite";
import { HealthStatus } from "./HealthStatus";

const meta = {
  title: "Components/HealthStatus",
  component: HealthStatus,
  parameters: { layout: "centered" },
} satisfies Meta<typeof HealthStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Up: Story = { parameters: { api: { health: "up" } } };
export const Down: Story = { parameters: { api: { health: "down" } } };
/** The request never answers, so the chip stays in its first state. */
export const Checking: Story = { parameters: { api: { health: "pending" } } };
