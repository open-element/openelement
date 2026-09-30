/**
 * control-characters.ts — the canonical control-character scan.
 *
 * One predicate for the island-delivery validation surfaces (authoring.ts,
 * delivery.ts, entry-generators.ts, island-scanner.ts): a string is rejected
 * when it carries a C0 control (U+0000–U+001F) or DEL (U+007F). These values
 * travel through generated artifacts and shell command lines, where control
 * characters are invisible carriers, so the gates fail closed on them before
 * anything is emitted.
 */

/**
 * Whether {@linkcode value} carries a C0 control character (U+0000–U+001F)
 * or DEL (U+007F).
 */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
