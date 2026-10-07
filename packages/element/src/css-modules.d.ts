/**
 * Ambient module typing for the one style authoring form (#1558).
 *
 * A `.css` file import is the sheet itself: the build's style-asset pipeline
 * resolves the import and hands back a module whose default export is the
 * cross-realm `StyleSheetLike` — a constructable stylesheet in the browser,
 * the SSR shim on the server. Authored modules type the binding once, here.
 * Query-suffixed specifiers (`?raw`, `?inline`) are outside this declaration:
 * they stay string channels owned by the bundler.
 *
 * Ambient declarations live in a global script file (a module file would turn
 * the wildcard into an augmentation, which TS refuses for non-existent
 * modules); every consumer program that imports `@openelement/element` pulls
 * this file in through the index's triple-slash reference.
 */
declare module '*.css' {
  const sheet: import('@openelement/protocol/style-sheet').StyleSheetLike;
  export default sheet;
}
