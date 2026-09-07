// Single MUI theme, light/dark driven by the OS preference -- an instance
// swaps the palette/typography here rather than scattering `sx` overrides.
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  cssVariables: { colorSchemeSelector: "media" },
});
