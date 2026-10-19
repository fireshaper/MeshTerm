/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["**/node_modules/**", "**/dist/**", "playwright-report/**"],
  rules: {
    // Token files group related custom properties with blank lines.
    "custom-property-empty-line-before": null,
    // Theming rule 1: literal colors live only in themes/.
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
    ],
  },
  overrides: [
    {
      files: ["**/themes/**/*.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
      },
    },
  ],
};
