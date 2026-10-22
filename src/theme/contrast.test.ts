import { describe, expect, it } from "vitest";
import { palette, type SchemePalette } from "./tokens";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// WCAG 2.2 AA: 4.5:1 for text.
describe.each(Object.entries(palette))(
  "%s scheme text contrast",
  (_name, p: SchemePalette) => {
    const pairs: [string, string, string][] = [
      ["text.primary on default", p.text.primary, p.background.default],
      ["text.primary on paper", p.text.primary, p.background.paper],
      ["text.secondary on default", p.text.secondary, p.background.default],
      ["text.secondary on paper", p.text.secondary, p.background.paper],
      ["primary on paper", p.primary.main, p.background.paper],
      ["primary on default", p.primary.main, p.background.default],
      [
        "primary contrastText on primary",
        p.primary.contrastText,
        p.primary.main,
      ],
      ["secondary on paper", p.secondary.main, p.background.paper],
      [
        "secondary contrastText on secondary",
        p.secondary.contrastText,
        p.secondary.main,
      ],
      ["error on paper", p.error.main, p.background.paper],
      ["warning on paper", p.warning.main, p.background.paper],
      ["info on paper", p.info.main, p.background.paper],
      ["success on paper", p.success.main, p.background.paper],
      ["success on default", p.success.main, p.background.default],
      ["error on default", p.error.main, p.background.default],
      ["warning on default", p.warning.main, p.background.default],
      ["info on default", p.info.main, p.background.default],
      ["error contrastText on error", p.error.contrastText, p.error.main],
      [
        "warning contrastText on warning",
        p.warning.contrastText,
        p.warning.main,
      ],
      ["info contrastText on info", p.info.contrastText, p.info.main],
      [
        "success contrastText on success",
        p.success.contrastText,
        p.success.main,
      ],
    ];
    it.each(pairs)("%s >= 4.5:1", (_label, fg, bg) => {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  },
);
