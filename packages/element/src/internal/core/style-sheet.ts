/**
 * Cross-environment CSSStyleSheet abstraction.
 *
 * In browsers this delegates to the native CSSStyleSheet API. In SSR runtimes
 * it falls back to a minimal in-memory implementation that exposes the subset
 * used by OpenElement and renderDsd().
 */

import type { StyleSheetLike, StyleSheetRule } from '../protocol/style-sheet.ts';
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

    const openBrace = css.indexOf('{', i);
    if (openBrace === -1) break;

    let depth = 0;
    let j = openBrace;
    while (j < len) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
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
