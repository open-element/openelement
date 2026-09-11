const UNSAFE_JS_LITERAL_CHARS_RE = /[<>\u2028\u2029]/g;
const UNSAFE_JS_LITERAL_CHAR_ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

// CodeQL treats generated JavaScript literals as code construction, even after
// JSON.stringify. Keep this post-stringify escape set explicit at codegen boundaries.
/** Serialize any JSON-serializable value for safe embedding in generated JS. */
export function quoteGeneratedJavaScriptValue(
  value: unknown,
  space?: string | number,
): string {
  return JSON.stringify(value, null, space).replace(
    UNSAFE_JS_LITERAL_CHARS_RE,
    (char) => UNSAFE_JS_LITERAL_CHAR_ESCAPES[char],
  );
}
