// Theming rule 2 for JSX (CR-004 Phase B): every literal `data-mt` value is a registered
// hook, and literal `data-mt-state` / `data-mt-variant` values are ones registered for
// that hook (unless it takes them from data). The registry is
// packages/shared/src/theme-hooks.ts, loaded as plain TypeScript (Node strips the types).
import { THEME_HOOKS } from "../packages/shared/src/theme-hooks.ts";

const REGISTRY = "packages/shared/src/theme-hooks.ts";

/** String values an attribute or expression can take, or null when they aren't all literal. */
function literalValues(node) {
  if (!node) return null;
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "JSXExpressionContainer":
      return literalValues(node.expression);
    case "TemplateLiteral":
      return node.expressions.length === 0 ? [node.quasis[0].value.cooked] : null;
    case "ConditionalExpression": {
      const a = literalValues(node.consequent);
      const b = literalValues(node.alternate);
      return a && b ? [...a, ...b] : null;
    }
    case "LogicalExpression": {
      const right = literalValues(node.right);
      // `x && "a"`: the left side is a condition; `x ?? "a"`: it's a value.
      if (node.operator === "&&") return right;
      const left = literalValues(node.left);
      return left && right ? [...left, ...right] : null;
    }
    case "Identifier":
      return node.name === "undefined" ? [] : null;
    default:
      return null;
  }
}

const attr = (element, name) =>
  element.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "data-mt hooks must be registered in the theme hook registry" },
    schema: [],
    messages: {
      unknownHook: `"{{name}}" isn't a registered theme hook: add it to ${REGISTRY} (hooks are public API).`,
      unknownValue: `"{{value}}" isn't a registered {{kind}} of "{{name}}": add it to ${REGISTRY}.`,
    },
  },
  create(context) {
    const checkHook = (node, name) => {
      if (!Object.hasOwn(THEME_HOOKS, name)) {
        context.report({ node, messageId: "unknownHook", data: { name } });
        return false;
      }
      return true;
    };
    return {
      JSXOpeningElement(element) {
        const mt = attr(element, "data-mt");
        if (!mt) return;
        const names = literalValues(mt.value);
        if (!names) return;
        const known = names.filter((name) => checkHook(mt, name));
        for (const [attrName, kind, list, open] of [
          ["data-mt-state", "state", "states", "openStates"],
          ["data-mt-variant", "variant", "variants", "openVariants"],
        ]) {
          const a = attr(element, attrName);
          const values = a ? literalValues(a.value) : null;
          if (!values) continue;
          for (const name of known) {
            const hook = THEME_HOOKS[name];
            if (hook[open]) continue;
            for (const value of values) {
              if (!(hook[list] ?? []).includes(value)) {
                context.report({ node: a, messageId: "unknownValue", data: { value, kind, name } });
              }
            }
          }
        }
      },
      // `link.dataset.mt = "theme-link"` in code that builds elements itself.
      AssignmentExpression(node) {
        const left = node.left;
        if (
          left.type === "MemberExpression" &&
          left.property.type === "Identifier" &&
          left.property.name === "mt" &&
          left.object.type === "MemberExpression" &&
          left.object.property.type === "Identifier" &&
          left.object.property.name === "dataset"
        ) {
          for (const name of literalValues(node.right) ?? []) checkHook(node.right, name);
        }
      },
    };
  },
};

export const themeHooksPlugin = { rules: { registered: rule } };
