/**
 * Nested-host expansion for the generated SSR producer (alpha16 slice).
 *
 * The class lane expands a nested custom-element host because its serializer
 * walks `renderNestedElement` for every `*-*` tag. A generated element's `__ssr`
 * is a STRING BUILDER, so it had no such walk and every host inside its markup
 * stayed an unexpanded tag — which is a second island-descriptor-less element,
 * not DSD. This module is that walk's generated-lane counterpart: ONE call the
 * emitted producer makes for each dash tag, so the expansion rule stays in the
 * runtime where the class lane's already lives.
 *
 * Two properties this helper guarantees:
 *
 * - **Additive.** When the render supplies no expander (a nested render, a unit
 *   test, a module with no admitted tags) or the host declines the tag
 *   (`undefined`), the caller's own literal bytes are returned verbatim. An
 *   admission regression therefore shows up as "no DSD", never as wrong markup.
 * - **No second serializer.** It builds nothing: the host expander owns the
 *   nested markup, and the caller owns the literal fallback.
 */

/** What a nested host needs from the caller's markup, already serialized. */
export interface NestedHostRequest {
  /** The dash tag, e.g. `open-page-rail`. */
  readonly tag: string;
  /**
   * The element's evaluated attribute pairs, in authored order. The SAME values
   * the `open` string carries (evaluated once, recorded twice), so an expander
   * that seeds a nested host's props cannot disagree with the serialized bytes.
   */
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  /** The element's serialized start tag (open tag plus attributes and `>`). */
  readonly open: string;
  /** The caller's already-serialized children (may be empty). */
  readonly children: string;
  /** The caller's literal markup for the whole element. */
  readonly fallback: string;
}

/**
 * The expander one render supplies on its host record.
 *
 * `undefined` is the explicit "this tag is not admitted here" answer; a string
 * is the expanded markup and replaces the caller's literal bytes.
 */
export type NestedHostExpander = (request: NestedHostRequest) => string | undefined;

/** The compiler-private host field carrying the expander. */
export const NESTED_HOST_PROPERTY = '__oe_nestedHost';

/**
 * Ask the render's host to expand one nested custom-element host, or return the
 * caller's literal markup.
 *
 * The host record is optional by construction: a generated element's `__ssr`
 * runs in renders that carry no expansion (a nested render of an un-admitted
 * tag, a direct unit call), and those must keep today's bytes rather than fail.
 */
export function nestedHost(host: unknown, request: NestedHostRequest): string {
  if (host === null || host === undefined || typeof host !== 'object') return request.fallback;
  const expander = (host as Record<string, unknown>)[NESTED_HOST_PROPERTY];
  if (typeof expander !== 'function') return request.fallback;
  const expanded = (expander as NestedHostExpander)(request);
  return typeof expanded === 'string' ? expanded : request.fallback;
}
