// Theming rule 1 for JSX: no literal colors or px values in `style={...}`.
// Components style themselves with --mt-* tokens (CSS) so themes can restyle everything.
// Shared by eslint.config.js and apps/web/src/test/theming-lint.test.ts.

const IN_STYLE = "JSXAttribute[name.name='style']";

const COLOR_LITERAL = String.raw`/(^|\s)#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/`;
const PX = String.raw`/\dpx\b/`;
const LENGTH_PROPS = String.raw`/^(width|height|(min|max)(Width|Height)|margin\w*|padding\w*|top|right|bottom|left|inset\w*|gap|rowGap|columnGap|fontSize|letterSpacing|borderRadius|border\w*Radius|border\w*Width|outlineWidth|outlineOffset|flexBasis)$/`;
const COLOR_PROPS = String.raw`/(color|Color|background|Background|fill|stroke|outline|border|Border|shadow|Shadow)$/`;
const ALLOWED_COLOR_VALUES = String.raw`/^\s*(var\(--|transparent$|currentColor$|inherit$|initial$|unset$|none$)/`;

const TOKENS = "use a --mt-* token (in CSS, or var(--mt-…) in style)";

/** `no-restricted-syntax` entries enforcing the rule. */
export const themingRestrictedSyntax = [
  {
    selector: `${IN_STYLE} Literal[value=${COLOR_LITERAL}]`,
    message: `No literal colors in style={}: ${TOKENS}.`,
  },
  {
    selector: `${IN_STYLE} TemplateElement[value.raw=${COLOR_LITERAL}]`,
    message: `No literal colors in style={}: ${TOKENS}.`,
  },
  {
    selector: `${IN_STYLE} Literal[value=${PX}]`,
    message: `No px values in style={}: ${TOKENS}.`,
  },
  {
    selector: `${IN_STYLE} TemplateElement[value.raw=${PX}]`,
    message: `No px values in style={}: ${TOKENS}.`,
  },
  {
    // React appends "px" to bare numbers on length properties.
    selector: `${IN_STYLE} Property[key.name=${LENGTH_PROPS}] > Literal[raw=/^[0-9.]+$/][value!=0]`,
    message: `No numeric (px) lengths in style={}: ${TOKENS}.`,
  },
  {
    selector: `${IN_STYLE} Property[key.name=${LENGTH_PROPS}] > UnaryExpression > Literal`,
    message: `No numeric (px) lengths in style={}: ${TOKENS}.`,
  },
  {
    // Named colors ("red") and anything else that isn't a token on color properties.
    selector: `${IN_STYLE} Property[key.name=${COLOR_PROPS}] > Literal[value=/./][value!=${ALLOWED_COLOR_VALUES}]`,
    message: `Color properties in style={} must use var(--mt-…), not literals.`,
  },
];
