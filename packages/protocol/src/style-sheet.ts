/**
 * Cross-environment CSSStyleSheet abstraction.
 *
 * In browsers this delegates to the native CSSStyleSheet API. In SSR runtimes
 * it falls back to a minimal in-memory implementation that exposes the subset
 * used by OpenElement and renderToString().
 */

export interface StyleSheetRule {
  cssText: string;
}

/** Minimal stylesheet contract (replaceSync + cssRules) satisfied by native and shim sheets. */
export interface StyleSheetLike {
  replaceSync(text: string): void;
  readonly cssRules: StyleSheetRule[];
}

/**
 * The one key under which a sheet carries its readiness promise: the generated
 * client style adapter records it on the sheet it exports, and the element
 * runtime reads the same key to hand styles to roots that are already
 * connected. Build-time and runtime cannot drift because the adapter generator
 * interpolates this exact name.
 *
 * The promise settles once. Fulfillment means the rules were installed through
 * `replace()`; rejection carries the load or replacement failure and keeps its
 * rejected state — an observer may attach its own catch, it must never convert
 * the promise into a fulfilled one.
 */
export const STYLE_SHEET_READY = '__openElementStyleReady';

/**
 * The one key under which a sheet carries the URL of the external CSS resource
 * that delivers its rules: the generated client style adapter records the
 * emitted asset URL on the sheet it exports, and the element runtime compares
 * it against the declarative `<link rel="stylesheet" data-oe-static-styles>`
 * nodes an SSR/DSD template already carries (alpha15 S lane). A root whose
 * serialized markup already references the sheet's URL keeps that link as the
 * delivery and does NOT adopt a second constructable copy — one stylesheet
 * resource, one delivery, no duplicate application. Build-time and runtime
 * cannot drift because the adapter generator interpolates this exact name.
 */
export const STYLE_SHEET_URL = '__openElementStyleSheetUrl';

/**
 * The one key marking a sheet whose bytes are a LIVE resource rather than an
 * immutable one (alpha15 S lane, S-C1.3).
 *
 * The dev server serves an authored sheet from a mutable endpoint that
 * hot-updates: the sheet object is the copy the live resource re-fills through
 * `replace()`, so every root that adopted it re-renders on an edit. A root
 * whose serialized markup declares the same URL therefore still ADOPTS this
 * sheet — the declarative `<link>` stays the first-paint / no-JavaScript
 * delivery, and the adopted object is the one an edit reaches. Without that,
 * a CSS-only edit could only be delivered by re-fetching the link, which is a
 * DOM write this protocol does not perform.
 *
 * Production sheets never carry this key: their URL is content-addressed, so
 * the link and the sheet can never disagree and one delivery is the whole
 * story. Build-time and runtime cannot drift because the dev adapter generator
 * interpolates this exact name.
 */
export const STYLE_SHEET_LIVE = '__openElementStyleSheetLive';
