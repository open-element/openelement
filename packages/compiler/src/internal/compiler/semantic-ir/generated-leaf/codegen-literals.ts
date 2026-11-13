/**
 * M09-2c — the generated-leaf code-literal boundary.
 *
 * CodeQL's `js/bad-code-sanitization` rule (CWE-79/94/116) treats a
 * `JSON.stringify` result inserted into generated JavaScript as code
 * construction: a literal containing `<`, `>`, U+2028 or U+2029 can break out
 * of an inline-script context even though it is a valid JavaScript string. The
 * rule's own remediation is the post-stringify escape set below, which the
 * router already implements as
 * `packages/router/src/vite/internal/ssg/codegen-literals.ts`.
 *
 * The generator cannot import that helper: the router depends on the compiler,
 * not the other way round. This module is the compiler-side mirror at the one
 * codegen boundary in this lane (event/ref names and their authored-location
 * error details); it is deliberately the same implementation, not a new
 * sanitizer policy.
 */
const UNSAFE_JS_LITERAL_CHARS_RE = /[<>\u2028\u2029]/g;
const UNSAFE_JS_LITERAL_CHAR_ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** Serialize any JSON-serializable value for safe embedding in generated JS. */
export function quoteGeneratedJavaScriptValue(value: unknown, space?: string | number): string {
  return JSON.stringify(value, null, space).replace(
    UNSAFE_JS_LITERAL_CHARS_RE,
    (char) => UNSAFE_JS_LITERAL_CHAR_ESCAPES[char],
  );
}
