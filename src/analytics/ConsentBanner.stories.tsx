import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { expect, userEvent, within } from "storybook/test";
import { RuntimeConfigContext } from "../auth/config";
import { ConsentBanner } from "./ConsentBanner";
import { ANSWERED_KEY } from "./consent";

/** A page-sized frame, so the sticky prompt sits at the bottom as in the app. */
function Frame({ children }: { children: ReactNode }) {
  // Every story starts as a visitor who has never been asked.
  window.localStorage.removeItem(ANSWERED_KEY);
  return (
    <RuntimeConfigContext.Provider
      value={{
        analytics: { enabled: true, consent: "opt-in", respectGpc: true },
      }}
    >
      <Box
        sx={{ minHeight: "24rem", display: "flex", flexDirection: "column" }}
      >
        <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
          <Typography>Page content.</Typography>
        </Box>
        {children}
      </Box>
    </RuntimeConfigContext.Provider>
  );
}

const meta = {
  title: "Analytics/ConsentBanner",
  component: ConsentBanner,
  decorators: [
    (Story) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
} satisfies Meta<typeof ConsentBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A visitor nobody has asked yet. */
export const Asking: Story = {
  parameters: { api: { consent: "unasked" } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("region", {
      name: /count my visits/i,
    });
  },
};

/** The BFF already holds "allowed": only the quiet settings button remains. */
export const Allowed: Story = {
  parameters: { api: { consent: "allowed" } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", {
      name: /analytics settings/i,
    });
  },
};

/** Reopened from the settings button, showing the stored choice. */
export const Reopened: Story = {
  parameters: { api: { consent: "allowed" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: /analytics settings/i }),
    );
    await expect(await canvas.findByRole("region")).toHaveTextContent(
      /currently: allowed/i,
    );
  },
};

/** The save failed: the prompt stays and says nothing changed. */
export const SaveFailed: Story = {
  parameters: { api: { consent: "failing" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Allow" }));
    await canvas.findByRole("alert");
  },
};
