import type { ReactNode } from "react";
import { CacheProvider } from "@emotion/react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { MotionConfig } from "motion/react";
import { createEmotionCache } from "./emotionCache";
import "./fonts";
import { theme } from "./theme";

// One cache for the page, created at load so the nonce is read once.
const emotionCache = createEmotionCache();

/** Emotion cache (CSP nonce), theme, CssBaseline and the reduced-motion policy, in one wrapper. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <CacheProvider value={emotionCache}>
      <MuiThemeProvider theme={theme} defaultMode="system">
        <CssBaseline />
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </MuiThemeProvider>
    </CacheProvider>
  );
}
