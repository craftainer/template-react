import { useEffect, type ReactNode } from "react";
import { useColorScheme } from "@mui/material/styles";
import type { Preview } from "@storybook/react-vite";
import { ThemeProvider } from "../src/theme";
import { installApiStub, StubAuthProvider, type StubParameters } from "./stubs";

type Scheme = "light" | "dark";

/** Pushes the toolbar's choice into MUI, which then sets the data attribute. */
function SchemeSync({
  scheme,
  children,
}: {
  scheme: Scheme;
  children: ReactNode;
}) {
  const { setMode } = useColorScheme();
  useEffect(() => setMode(scheme), [scheme, setMode]);
  return children;
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Color scheme",
      toolbar: {
        title: "Scheme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, { globals, parameters }) => {
      const { api, auth } = parameters as StubParameters;
      installApiStub(api);
      return (
        <ThemeProvider>
          <SchemeSync scheme={globals.theme === "dark" ? "dark" : "light"}>
            <StubAuthProvider state={auth ?? "signedOut"}>
              <Story />
            </StubAuthProvider>
          </SchemeSync>
        </ThemeProvider>
      );
    },
  ],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    // Fails the story's a11y panel on any violation; the Playwright suite
    // (tests/visual/) enforces serious and critical ones in CI.
    a11y: { test: "error" },
  },
};

export default preview;
