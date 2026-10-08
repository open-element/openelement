/**
 * The `*.css` ambient module type (#1558).
 *
 * A wildcard `declare module` cannot live in a module file (TS2664) and a
 * triple-slash reference is lint-banned, so consuming tsconfigs load this
 * file through the standard `types` array (the vite/client pattern) via the
 * `./css-modules` export.
 *
 * The declared default export is the one shape every style channel serves
 * (router/vite/internal/style-assets.ts): the sheet — the native
 * CSSStyleSheet in the browser, element's SSR shim in Node. The type comes
 * from the element public surface so this declaration carries no second copy
 * of the StyleSheetLike contract.
 */
declare module '*.css' {
  import type { StyleSheetLike } from '@openelement/element';

  const sheet: StyleSheetLike;
  export default sheet;
}
