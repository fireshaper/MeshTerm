import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
// The same rule entries eslint.config.js uses for apps/web/src/**/*.tsx.
import { themingRestrictedSyntax } from "../../../../eslint/theming-rules.js";

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
