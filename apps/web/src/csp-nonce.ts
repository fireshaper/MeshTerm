/**
 * Radix's scroll lock (react-remove-scroll) inserts a `<style>` element when a dialog
 * opens. The CSP only allows inline styles with this response's nonce, which the
 * server writes into `<meta name="mt-csp-nonce">`. `get-nonce` (used by
 * react-remove-scroll) reads it from the global `__webpack_nonce__`.
 */
const nonce = document.querySelector<HTMLMetaElement>('meta[name="mt-csp-nonce"]')?.content;
// In dev (Vite) the placeholder is left as is; there's no CSP there.
if (nonce && !nonce.startsWith("__")) {
  Object.assign(globalThis, { __webpack_nonce__: nonce });
}
