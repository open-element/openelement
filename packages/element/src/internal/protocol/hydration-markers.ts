/**
 * hydration-markers.ts - light-mode SSR provenance marker contract.
 *
 * The v0.43 marker-based hydration channel (`data-signal*`, `data-eid`,
 * `data-ssr-props`, `oe-branch:`/`oe-for-item:` comments) was removed with the
 * compiled Part Program model: claim now binds through program anchors
 * (`oe:pN`, internal/compiled/program.ts), and the legacy marker strings are
 * intentionally excluded from built public artifacts.
 *
 * One marker survives. Its consumers (internal/compiled/server,
 * internal/compiled/runtime, and the adapter's SSG/dev toolchain) reference
 * the string literal by design — the writer/reader set crosses the
 * generated-code boundary, so there is no import edge; this module is the
 * single source for the name so a rename cannot drift silently.
 */

/**
 * Internal SSR provenance marker on light-mode host tags (ADR-0142, #1148).
 *
 * Present only when the host's light subtree was server-rendered under the
 * in-place activation contract: the client binds the existing DOM instead of
 * clearing it, and a parent's activation walk prunes the nested host's
 * subtree. Client rendering never writes it and it is never removed.
 */
export const DATA_OE_LIGHT = 'data-oe-light';
