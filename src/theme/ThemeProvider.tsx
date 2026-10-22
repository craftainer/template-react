import type { ReactNode } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { MotionConfig } from "motion/react";
import "./fonts";
import { theme } from "./theme";

/** Theme, CssBaseline and the reduced-motion policy, in one wrapper. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <MuiThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </MuiThemeProvider>
  );
}
