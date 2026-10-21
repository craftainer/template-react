// The single MUI theme: CSS variables, light/dark schemes that follow the OS
// until the user picks one (see useColorMode), and the Field Ledger
// component overrides for comfortable density and the 2px radius.
import { createTheme } from "@mui/material/styles";
import { cssMotion, fontFamily, palette, radius, spacingUnit } from "./tokens";

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data" },
  colorSchemes: {
    light: { palette: palette.light },
    dark: { palette: palette.dark },
  },
  shape: { borderRadius: radius.base },
  spacing: spacingUnit,
  typography: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    h1: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h3: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h4: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h5: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      fontSize: "2.25rem",
      letterSpacing: "-0.02em",
      fontVariationSettings: '"opsz" 72',
    },
    h6: {
      fontFamily: fontFamily.display,
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "transparent" },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: "transparent",
          color: theme.vars.palette.text.primary,
          borderBottom: `2px solid ${theme.vars.palette.text.primary}`,
        }),
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: "14px 16px",
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
        head: ({ theme }) => ({
          fontFamily: fontFamily.body,
          fontWeight: 600,
          fontSize: "0.75rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: theme.vars.palette.text.secondary,
          borderBottom: `2px solid ${theme.vars.palette.text.primary}`,
        }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: radius.base,
          backgroundColor: "transparent",
          border: `1px solid ${theme.vars.palette.divider}`,
          fontWeight: 500,
        }),
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: radius.base, padding: "8px 20px" },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "tr.MuiTableRow-root td": {
          transition: `background-color ${cssMotion.quick}`,
        },
        "tr.MuiTableRow-root:hover td": {
          backgroundColor:
            "color-mix(in srgb, var(--mui-palette-primary-main) 6%, transparent)",
        },
      },
    },
  },
});
