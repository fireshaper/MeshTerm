import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
// The same rule entries eslint.config.js uses for apps/web/src/**/*.tsx.
import { themingRestrictedSyntax } from "../../../../eslint/theming-rules.js";
import { themeHooksPlugin } from "../../../../eslint/theme-hooks.js";

const linter = new Linter({ configType: "flat" });

function lintStyle(style: string): string[] {
  const code = `export const C = () => <div style={${style}} />;`;
  return linter
    .verify(
      code,
      [
        {
          files: ["**/*.tsx"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { "no-restricted-syntax": ["error", ...themingRestrictedSyntax] },
        },
      ],
      "probe.tsx",
    )
    .map((m) => m.message);
}

describe("theming lint rule for style={}", () => {
  it.each([
    `{ color: "#fff" }`,
    `{ color: "#12345678" }`,
    `{ background: "rgb(0 0 0)" }`,
    `{ boxShadow: "0 0 4px hsl(0 0% 0%)" }`,
    `{ borderColor: "red" }`,
    "{ color: `#fff` }",
    `{ width: "12px" }`,
    `{ margin: \`\${1}px 2px\` }`,
    `{ padding: 8 }`,
    `{ marginTop: -4 }`,
    `{ fontSize: 14 }`,
  ])("rejects %s", (style) => {
    expect(lintStyle(style).length).toBeGreaterThan(0);
  });

  it.each([
    `{ color: "var(--mt-text)" }`,
    `{ background: "var(--mt-surface-bg)" }`,
    `{ borderColor: "transparent" }`,
    `{ color: "currentColor" }`,
    `{ width: "50%" }`,
    `{ padding: "var(--mt-space-2)" }`,
    `{ margin: 0 }`,
    `{ opacity: 0.5, zIndex: 2, flexGrow: 1, lineHeight: 1.4 }`,
    `{ gridTemplateColumns: "1fr 2fr" }`,
    `{ "--mt-progress": "40%" }`,
  ])("allows %s", (style) => {
    expect(lintStyle(style)).toEqual([]);
  });
});

describe("theme hook registry rule (CR-004 Phase B)", () => {
  const lintJsx = (jsx: string) =>
    linter
      .verify(
        `export const C = ({ on }: { on: boolean }) => ${jsx};`,
        [
          {
            files: ["**/*.tsx"],
            languageOptions: {
              parser: tseslint.parser,
              parserOptions: { ecmaFeatures: { jsx: true } },
            },
            plugins: { "theme-hooks": themeHooksPlugin },
            rules: { "theme-hooks/registered": "error" },
          },
        ],
        "probe.tsx",
      )
      .map((m) => m.message);

  it.each([
    `<div data-mt="not-a-hook" />`,
    `<div data-mt={on ? "segment" : "nope"} />`,
    `<button data-mt="segment" data-mt-state={on ? "active" : "sideways"} />`,
    `<div data-mt="theme-card" data-mt-variant="weird" />`,
  ])("rejects %s", (jsx) => {
    expect(lintJsx(jsx).length).toBeGreaterThan(0);
  });

  it.each([
    `<div data-mt="segment" data-mt-state={on ? "active" : "inactive"} />`,
    `<div data-mt="theme-card" data-mt-variant="override" />`,
    // State from data: anything goes for hooks marked open.
    `<div data-mt="status-pill" data-mt-state="whatever" />`,
    // Not literal: checked by the e2e crawl instead.
    `<div data-mt={name} />`,
  ])("accepts %s", (jsx) => {
    expect(lintJsx(jsx)).toEqual([]);
  });
});
