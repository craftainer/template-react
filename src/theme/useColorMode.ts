import { useColorScheme } from "@mui/material/styles";

export type ColorMode = "light" | "dark" | "system";

/**
 * The color-scheme API for the app: `mode` is the user's choice (default
 * "system" = follow the OS), `resolved` the scheme actually shown. `toggle`
 * flips between light and dark from whatever is currently shown.
 */
export function useColorMode() {
  const { mode, systemMode, setMode } = useColorScheme();
  const resolved: "light" | "dark" | undefined =
    mode === "system" ? systemMode : mode;
  return {
    mode: mode as ColorMode | undefined,
    resolved,
    setMode: (next: ColorMode) => setMode(next),
    toggle: () => setMode(resolved === "dark" ? "light" : "dark"),
  };
}
