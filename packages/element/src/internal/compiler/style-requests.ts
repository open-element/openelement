/**
 * Style-resource request payload channel (ADR-0164).
 *
 * The compiler never writes files (three-owner seam split, ADR-0164 §1): an
 * admitted island `static styles` becomes an import of a reserved-suffix
 * sibling id (`./<tag>.oe-style.css`), and the host build's style-asset plugin
 * intercepts that request and owns the emitted `.css` artifact. This registry
 * is how the request's CSS text travels from the compiled-element transform
 * (the one writer) to the intercepting plugin (the one reader) within a build
 * process — keyed by the resolved request module id, the same id the bundler's
 * resolver lands on for the emitted import. No registry entry, no answer: an
 * activated protocol without an intercepting host build fails at import
 * resolution, never by silently re-inlining the sheet.
 */

import type { CompiledStyleRequest } from './semantic-core/style-admission.ts';

/** A registered request: the compiler's descriptor plus its build-graph anchors. */
export interface RegisteredStyleRequest extends CompiledStyleRequest {
  /** Resolved request module id — the registry key, and what resolveId answers. */
  readonly moduleId: string;
  /** The importing module's id as the build graph tracks it. */
  readonly importer: string;
}

const requests = new Map<string, RegisteredStyleRequest>();

/** Register one generated request (idempotent per module id — recompiles overwrite). */
export function registerStyleRequest(request: RegisteredStyleRequest): void {
  requests.set(request.moduleId, request);
}

/** The request a resolved `.oe-style.css` module id carries, if any. */
export function getStyleRequest(moduleId: string): RegisteredStyleRequest | undefined {
  return requests.get(moduleId);
}

/** Drop every registered request (a build's bookkeeping is its own lifetime). */
export function clearStyleRequests(): void {
  requests.clear();
}

/**
 * The registry key for an emitted request: the importing module's directory
 * plus the specifier's file name. Query suffixes on the importer id (dev-time
 * cache busting) never change the directory, so recompiles re-register under
 * one key.
 */
export function styleRequestModuleId(importerId: string, specifier: string): string {
  const clean = importerId.split('?', 1)[0]!;
  const directory = clean.slice(0, clean.lastIndexOf('/'));
  const file = specifier.slice(specifier.lastIndexOf('/') + 1);
  return `${directory}/${file}`;
}
