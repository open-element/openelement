/**
 * The list wire key codec: one supported primitive key -> one canonical token,
 * plus the canonical-token predicate the marker reader uses.
 *
 * A token is `<kind>:<payload>`: `s` is the lowercase UTF-8 hex of the string,
 * `n` is `String(value)` for a finite number (`-0` -> `0`), and `b` is `0`/`1`.
 * The `oe:k:` marker prefix belongs to the marker owner. Tokens are compared as
 * strings and never decoded back into a key; the predicate checks spelling only
 * — `n:` round-trips through `Number`/`String`, `s:` checks hex shape (not
 * UTF-8 well-formedness).
 *
 * An unsupported key fails with the internal coded error
 * `OEIR_LEAF_UNSUPPORTED_KEY`, deliberately absent from the public catalogue.
 *
 * @module ./list-key.ts
 */

import { frameworkError } from '@openelement/protocol/errors';

/** Internal identity of an unsupported list key; never a public runtime code. */
export const LEAF_UNSUPPORTED_KEY = 'OEIR_LEAF_UNSUPPORTED_KEY';

/**
 * The mount-only token payload for a key the encoder rejected. It is not a
 * canonical encode output: SSR never writes it and claim rejects it. The
 * constant lives here with the token alphabet so the writer and the reader do
 * not each own a copy.
 */
export const LIST_KEY_UNSUPPORTED = 'u';

const UTF8 = new TextEncoder();
const HEX = '0123456789abcdef';

function unsupported(): never {
  throw frameworkError(
    LEAF_UNSUPPORTED_KEY,
    'list key must be a string without lone surrogates, a finite number or a boolean',
    { phase: 'render' },
  );
}

/**
 * ES2024 `String.prototype.isWellFormed`; the package's `lib: ES2023` needs
 * this type-only cast. Node 24 / modern browsers provide the method.
 */
function isWellFormed(value: string): boolean {
  return (value as string & { isWellFormed(): boolean }).isWellFormed();
}

function utf8Hex(value: string): string {
  let hex = '';
  for (const byte of UTF8.encode(value)) hex += HEX[byte >> 4] + HEX[byte & 15];
  return hex;
}

/** Encode one supported key. Unsupported values throw, never stringify. */
export function encodeListKey(value: unknown): string {
  if (typeof value === 'string') {
    if (!isWellFormed(value)) unsupported();
    return `s:${utf8Hex(value)}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `n:${Object.is(value, -0) ? '0' : String(value)}`;
  }
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  return unsupported();
}

/**
 * Mount-side non-throwing form. Only the module's own unsupported-key failure
 * is converted to `null` (the mount writes the `u` marker); any other error is
 * rethrown, so a caller never silently swallows an unrelated failure.
 */
export function tryEncodeListKey(value: unknown): string | null {
  try {
    return encodeListKey(value);
  } catch (error) {
    if ((error as { code?: unknown }).code === LEAF_UNSUPPORTED_KEY) return null;
    throw error;
  }
}

const HEX_PAYLOAD = /^[0-9a-f]*$/;

function isCanonicalHexPayload(payload: string): boolean {
  // `$` also matches before a final line terminator; compare the whole match.
  return payload.length % 2 === 0 && HEX_PAYLOAD.exec(payload)?.[0] === payload;
}

/** `true` exactly when payload is a finite double's `String()` spelling. */
function isCanonicalNumberPayload(payload: string): boolean {
  const value = Number(payload);
  return Number.isFinite(value) && String(value) === payload;
}

/**
 * `true` for a canonical token spelling. `n:` is exact: `String(Number(payload))`
 * for a finite number, so `-0` is `0` and unencodable payloads fail. `b:` is
 * exact. `s:` is only the even-length lowercase hex alphabet — the hex is not
 * decoded, so non-UTF-8 bytes pass, but a forged token still cannot equal a
 * client token because the claim compares strings.
 */
export function isCanonicalListKeyToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  if (token.startsWith('s:')) return isCanonicalHexPayload(token.slice(2));
  if (token.startsWith('n:')) return isCanonicalNumberPayload(token.slice(2));
  return token === 'b:0' || token === 'b:1';
}
