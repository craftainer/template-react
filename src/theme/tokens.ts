// Design tokens for the "Field Ledger" direction (docs/design/README.md,
// ADR 0004). This is the only place raw colors and px values live; every
// other file under src/ reads them through the MUI theme (CSS variables) or
// the exports below. scripts/check-design-tokens.sh enforces that.

export const fontFamily = {
  display: '"Fraunces Variable", Georgia, serif',
  body: '"Instrument Sans Variable", system-ui, sans-serif',
} as const;

export interface SchemePalette {
  primary: { main: string; contrastText: string };
  secondary: { main: string; contrastText: string };
  error: { main: string; contrastText: string };
  warning: { main: string; contrastText: string };
  info: { main: string; contrastText: string };
  success: { main: string; contrastText: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  divider: string;
}

// Warm paper, vermilion, bottle green. Contrast ratios are asserted in
// contrast.test.ts and recorded in docs/design/README.md.
export const palette: { light: SchemePalette; dark: SchemePalette } = {
  light: {
    primary: { main: "#B3361B", contrastText: "#FFF8EE" },
    secondary: { main: "#2F4A3A", contrastText: "#FFF8EE" },
    error: { main: "#9E1C1C", contrastText: "#FFF8EE" },
    warning: { main: "#8A5300", contrastText: "#FFF8EE" },
    info: { main: "#2D5F86", contrastText: "#FFF8EE" },
    success: { main: "#2F6B3C", contrastText: "#FFF8EE" },
    background: { default: "#F6EFE2", paper: "#FBF7EE" },
    text: { primary: "#231C14", secondary: "#5E5242" },
    divider: "#D9CDB6",
  },
  dark: {
    primary: { main: "#E8795C", contrastText: "#1B1510" },
    secondary: { main: "#9CC0A8", contrastText: "#1B1510" },
    error: { main: "#F08A7E", contrastText: "#1B1510" },
    warning: { main: "#E0A94A", contrastText: "#1B1510" },
    info: { main: "#8FB6DA", contrastText: "#1B1510" },
    success: { main: "#8CC79B", contrastText: "#1B1510" },
    background: { default: "#1B1510", paper: "#241D16" },
    text: { primary: "#F1E7D3", secondary: "#B8AA92" },
    divider: "#3D3328",
  },
};

// MUI multiplies theme.spacing(n) by this: an 8px grid.
export const spacingUnit = 8;

// Radius scale in px, consumed by MUI's `shape.borderRadius` (2px base).
export const radius = { none: 0, base: 2, pill: 999 } as const;

export const duration = {
  instant: 0.08,
  quick: 0.16,
  base: 0.24,
  slow: 0.4,
} as const;

// cubic-bezier control points, usable by both Motion and CSS.
export const easing = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
} as const;

const css = (e: readonly number[]) => `cubic-bezier(${e.join(", ")})`;
export const cssMotion = {
  quick: `${duration.quick * 1000}ms ${css(easing.standard)}`,
  base: `${duration.base * 1000}ms ${css(easing.standard)}`,
} as const;

export const tokens = {
  fontFamily,
  palette,
  spacingUnit,
  radius,
  duration,
  easing,
  cssMotion,
};
