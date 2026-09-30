/**
 * Client script loading descriptors and their CSP nonce policy (#1471 item 3).
 *
 * The structured record of one framework client script a resolved document
 * carries. The descriptor names the facets of a client-module load — its
 * `src`, its module `type`, and the CSP nonce policy that governs the tag —
 * while the loading *strategy* itself stays build data (the client asset
 * manifest and the per-page island manifests carry strategy/layer), because
 * hydration scheduling is a client-runtime concern, not a document fact.
 *
 * The descriptors ride {@linkcode ResolvedDocument.clientScripts} and the
 * document serializer (wrapInDocument's `scripts` channel) is their only
 * rendering point: script tags are produced at document render time, never
 * by post-build HTML surgery. The nonce attaches exactly once, at
 * serialization (wrapInDocument's per-request `cspNonce`) — request-time
 * rendering binds the per-request nonce; SSG output carries none (static
 * bytes cannot be per-request, and the SSG CSP injector rejects the nonce
 * option outright).
 *
 * This module is neutral like the head-safety predicates: no Vite or
 * build-tool imports, so the server document contract does not depend on
 * build tooling.
 */

/**
 * One framework client script a resolved document embeds before `</body>`.
 * Shape-compatible with the serializer's script descriptors, so the document
 * channel routes it through without conversion; entries without src or code
 * are meaningless and rejected at resolution (never silently dropped).
 */
export interface ClientScriptDescriptor {
  /** External script URL (attribute-escaped at serialization). */
  src?: string;
  /** Inline script body. Trusted framework input, never user content. */
  code?: string;
  /** Script type attribute, e.g. 'module'; omitted means a classic script. */
  type?: string;
}

/**
 * Validate one page's client-script descriptors, fail-closed — the same
 * resolution policy every other head field gets: malformed framework wiring
 * fails the render loudly instead of being silently dropped from the
 * document. Returns a validated copy; the input is never mutated.
 *
 * `fail` is the caller's error strategy (document.ts raises the seam's
 * authoring error so every message carries the resolvePageDocument prefix).
 */
export function normalizeClientScriptDescriptors(
  scripts: readonly unknown[],
  fail: (message: string) => never,
): ClientScriptDescriptor[] {
  if (!Array.isArray(scripts)) {
    fail('clientScripts must be an array of script descriptors.');
  }
  return scripts.map((script, index) => {
    if (script === null || typeof script !== 'object' || Array.isArray(script)) {
      fail(`clientScripts[${index}] must be a script descriptor object.`);
    }
    const { src, code, type } = script as {
      src?: unknown;
      code?: unknown;
      type?: unknown;
    };
    if (src !== undefined && (typeof src !== 'string' || src.length === 0)) {
      fail(`clientScripts[${index}].src must be a non-empty string.`);
    }
    if (code !== undefined && typeof code !== 'string') {
      fail(`clientScripts[${index}].code must be a string.`);
    }
    if (type !== undefined && typeof type !== 'string') {
      fail(`clientScripts[${index}].type must be a string.`);
    }
    if (src === undefined && code === undefined) {
      fail(`clientScripts[${index}] must carry a src or an inline code body.`);
    }
    return {
      ...(src !== undefined ? { src } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(type !== undefined ? { type } : {}),
    };
  });
}
