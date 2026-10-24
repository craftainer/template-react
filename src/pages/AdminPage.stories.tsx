import type { Meta, StoryObj } from "@storybook/react-vite";
import { memoryUrlAdapter } from "@craftainer/crud-views";
import { userEvent, within } from "storybook/test";
import { AdminPage } from "./AdminPage";
import { withAdminStub } from "./withAdminStub";

const meta = {
  title: "Pages/AdminPage",
  component: AdminPage,
  decorators: [withAdminStub],
  parameters: { auth: "signedIn", layout: "padded" },
} satisfies Meta<typeof AdminPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The records table of the one resource the manifest lists. */
export const Records: Story = {
  args: { urlAdapter: memoryUrlAdapter() },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("Captain Ledger");
  },
};

export const Empty: Story = {
  args: { urlAdapter: memoryUrlAdapter() },
  parameters: { adminStub: { records: [] } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/no rows/i);
  },
};

/** The statistics tab, shown because the manifest says `stats`. */
export const Statistics: Story = {
  args: { urlAdapter: memoryUrlAdapter("view=stats") },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("tab", {
      name: "Statistics",
      selected: true,
    });
  },
};

/** The create form, opened the way a user opens it. */
export const AddDialogOpen: Story = {
  args: { urlAdapter: memoryUrlAdapter() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Add record" }),
    );
    await within(document.body).findByRole("dialog");
  },
};

/** One record: the edit form inside the detail page. */
export const RecordForm: Story = {
  args: { urlAdapter: memoryUrlAdapter("id=1") },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByDisplayValue("Captain Ledger");
  },
};

export const NoResources: Story = {
  args: { urlAdapter: memoryUrlAdapter() },
  parameters: { adminStub: { manifest: "none" } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/can see no resources/i);
  },
};

export const ManifestDenied: Story = {
  args: { urlAdapter: memoryUrlAdapter() },
  parameters: { adminStub: { manifest: "denied" } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/could not load the api/i);
  },
};
