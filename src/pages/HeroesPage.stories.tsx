import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { heroFixtures } from "../../.storybook/stubs";
import { HeroesPage } from "./HeroesPage";

const meta = {
  title: "Pages/HeroesPage",
  component: HeroesPage,
  parameters: { auth: "signedIn", layout: "padded" },
} satisfies Meta<typeof HeroesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHeroes: Story = {
  parameters: { api: { heroes: heroFixtures } },
};
export const Empty: Story = { parameters: { api: { heroes: [] } } };
export const Loading: Story = { parameters: { api: { heroes: "pending" } } };
export const LoadError: Story = {
  parameters: {
    api: { heroes: { status: 403, detail: "You need the viewer role." } },
  },
};

/** The "Add hero" dialog, opened the way a user opens it. */
export const AddDialogOpen: Story = {
  parameters: { api: { heroes: heroFixtures } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Add hero" }),
    );
    await within(document.body).findByRole("dialog", { name: "Add hero" });
  },
};
