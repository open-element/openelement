/**
 * escape-text.ts — the ONE text-node escape contract for the compiled
 * serializers (B1.1 audit remediation, #1272 / finding F3).
 *
 * Both compiled serializers (the runtime seed serializer `runtime.ts` and the
 * server serializer `server/index.ts`) emit text-node bytes through this one
 * helper; before the convergence each carried a private byte-identical copy
 * with no named owner and no byte-level parity corpus (the claim-parity guard
 * `compiled-escape-parity.test.ts` covered attributes only).
 *
 * The contract is deliberately reduced: `&`, `<`, `>` only. Quotes are NOT
 * escaped — they are inert in text content and the wire bytes must stay
 * stable for claim parity. Distinct contracts exist elsewhere and are NOT
 * this surface:
 * - `escapeAttr`/`escapeHtml` (`internal/core/html-escape.ts`) additionally
 *   escape quotes for the attribute context.
 */
export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
