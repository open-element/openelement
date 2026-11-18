/**
 * The canonical UTF-8 hex codec: one byte spelling shared by every marker
 * payload that carries a STRING (the list wire key token and the slot-anchor
 * name). Lowercase hex of the UTF-8 encoding; empty in, empty out.
 *
 * Why a codec at all: a marker lives inside an HTML comment, and a comment's
 * text cannot carry `-->`, `--!>` or `<!--` — a slot name authored as `-->`
 * would terminate the comment early and the anchor would stop being an anchor.
 * Hex is also the alphabet the list-key token already uses, so the vocabulary
 * keeps ONE payload encoding instead of growing a second escaping scheme.
 *
 * Decoding is deliberately total-or-null: a payload that is not canonical
 * lowercase even-length hex, or whose bytes are not well-formed UTF-8, is not a
 * value this codec wrote. Callers treat `null` as "foreign comment", never as
 * a fallback string — a marker reader that guessed would accept a marker
 * nobody wrote.
 *
 * @module ./utf8-hex.ts
 */

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const HEX = '0123456789abcdef';
const HEX_PAYLOAD = /^[0-9a-f]*$/;

/** Encode one string as lowercase hex of its UTF-8 bytes. */
export function encodeUtf8Hex(value: string): string {
  let hex = '';
  for (const byte of UTF8_ENCODER.encode(value)) hex += HEX[byte >> 4] + HEX[byte & 15];
  return hex;
}

/**
 * `true` for the exact spelling `encodeUtf8Hex` produces: even-length lowercase
 * hex. The bytes are not decoded here, so a canonical *spelling* is not yet a
 * canonical *value* — use {@linkcode decodeUtf8Hex} for that.
 */
export function isCanonicalUtf8Hex(payload: string): boolean {
  // `$` also matches before a final line terminator; compare the whole match.
  return payload.length % 2 === 0 && HEX_PAYLOAD.exec(payload)?.[0] === payload;
}

/**
 * Decode a canonical payload back to its string. `null` when the payload is
 * not canonical spelling or its bytes are not well-formed UTF-8; the caller
 * refuses the marker instead of substituting a replacement character.
 */
export function decodeUtf8Hex(payload: string): string | null {
  if (!isCanonicalUtf8Hex(payload)) return null;
  const bytes = new Uint8Array(payload.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(payload.slice(index * 2, index * 2 + 2), 16);
  }
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}
