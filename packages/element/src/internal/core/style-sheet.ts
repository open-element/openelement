/**
 * Cross-environment CSSStyleSheet abstraction.
 *
 * In browsers this delegates to the native CSSStyleSheet API. In SSR runtimes
 * it falls back to a minimal in-memory implementation that exposes the subset
 * used by OpenElement and renderToString().
 */

import type { StyleSheetLike, StyleSheetRule } from '@openelement/protocol/style-sheet';
export type { StyleSheetLike, StyleSheetRule };

function parseRules(css: string): StyleSheetRule[] {
  const rules: StyleSheetRule[] = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    while (i < len && /\s/.test(css[i])) i++;
    if (i >= len) break;

    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }

    const openBrace = nextStructural(css, i, (c) => c === '{');
    if (openBrace === -1) break;

    let depth = 0;
    let j = openBrace;
    while (j < len) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j = skipProtected(css, j);
    }
    if (depth !== 0) break;

    const ruleText = css.substring(i, j + 1).trim();
    if (ruleText) rules.push({ cssText: ruleText });
    i = j + 1;
  }

  if (rules.length === 0 && css.trim()) {
    rules.push({ cssText: css.trim() });
  }
  return rules;
}

/**
 * The next position at or after `from` holding `match` at a STRUCTURAL
 * position — outside CSS strings (single/double quoted) and comments. Rules
 * are found by brace counting, and a `}` inside `content: "}"`, a quoted
 * string or a comment is content, never a rule boundary: counting raw brace
 * characters truncates the rule text and corrupts the inline text the SSR
 * serializer reads back (alpha15 N-2A).
 */
function nextStructural(css: string, from: number, match: (char: string) => boolean): number {
  let i = from;
  while (i < css.length) {
    if (match(css[i]!)) return i;
    i = skipProtected(css, i);
  }
  return -1;
}

/**
 * The first index at or after `from` not inside a string or comment: skips a
 * quoted string to its closing quote (honouring backslash escapes) and a
 * comment to its terminator; every other character advances by one.
 */
function skipProtected(css: string, from: number): number {
  const char = css[from];
  if (char === '/' && css[from + 1] === '*') {
    const end = css.indexOf('*/', from + 2);
    return end === -1 ? css.length : end + 2;
  }
  if (char === '"' || char === "'") {
    let i = from + 1;
    while (i < css.length) {
      if (css[i] === '\\') {
        i += 2;
        continue;
      }
      if (css[i] === char) return i + 1;
      i++;
    }
    return css.length;
  }
  return from + 1;
}

class ShimStyleSheet implements StyleSheetLike {
  #rules: StyleSheetRule[] = [];

  get cssRules(): StyleSheetRule[] {
    return this.#rules;
  }

  replaceSync(text: string): void {
    this.#rules = parseRules(text);
  }
}

/** Cross-realm StyleSheet constructor: the native CSSStyleSheet or the internal shim. */
export const StyleSheet: new () => StyleSheetLike =
  typeof globalThis.CSSStyleSheet === 'function'
    ? (globalThis.CSSStyleSheet as unknown as new () => StyleSheetLike)
    : ShimStyleSheet;
