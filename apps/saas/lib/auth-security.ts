const FALLBACK_PATH = '/notes';
const MAX_REDIRECT_LENGTH = 2048;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/**
 * Accept only an origin-relative application path. Every decode layer is
 * checked so `%252f%252fevil.example` cannot become a protocol-relative URL
 * after a framework/browser decode. Backslashes are rejected because URL
 * parsers may normalize them to slashes.
 */
export function safeInternalNext(raw: string | null | undefined, fallback = FALLBACK_PATH): string {
  if (!raw || raw.length > MAX_REDIRECT_LENGTH) return fallback;
  let candidate = raw.trim();
  for (let depth = 0; depth < 3; depth++) {
    if (
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      candidate.includes('\\') ||
      hasControlCharacter(candidate)
    ) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return fallback;
    }
    if (decoded === candidate) break;
    candidate = decoded;
  }
  try {
    const base = new URL('https://openelement.invalid');
    const resolved = new URL(candidate, base);
    if (resolved.origin !== base.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

/** Public auth errors must not echo authorization codes, JWTs or provider internals. */
export function publicAuthError(_error: unknown): string {
  return 'Authentication could not be completed. Please request a new link and try again.';
}
