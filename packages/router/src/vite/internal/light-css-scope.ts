/**
 * Build-time light-root CSS scoping (alpha15 S lane, S-C1.2).
 *
 * A light root has no native style boundary: the component's DOM lives in the
 * document, so its authored selectors would apply document-wide and its
 * shadow-only `:host`/`::slotted` selectors would never match. The boundary
 * is native CSS `@scope (<tag>)` — the scope root is the component's own tag,
 * which is compiler-known component identity, not a per-instance fact: every
 * instance of a component shares one scoped stylesheet, exactly as it shares
 * one sheet file.
 *
 * This runs at the style-asset boundary (the router client/SSR/dev style
 * plugins), so the emitted asset IS the scoped stylesheet: the bytes the
 * browser parses are the bytes the build wrote, content-addressed, and no
 * runtime can re-derive them.
 *
 * Why a scan instead of a CSS AST: the build's toolchain ships no CSS parser
 * this package may resolve (neither postcss, lightningcss nor css-tree is
 * resolvable from `@openelement/router`; the installed Tailwind toolchain
 * exposes only its own compiler and minifier). The scan below is therefore
 * string-, comment- and escape-aware — never a regex over CSS text — and
 * copies every byte it does not deliberately move. When a CSS AST becomes
 * resolvable, this module is the single seam to swap.
 *
 * What it does, and why each part is where it is:
 *
 *   - One `@scope (<tag>)` wrapper around the sheet. `@scope` matches the
 *     scope root and its subtree; a plain selector inside does not match the
 *     root itself, which is why `:host` is projected to `:scope`.
 *   - `:host` → `:scope`, `:host(<sel>)` → `:scope:is(<sel>)`,
 *     `::slotted(<sel>)` → `slot > :is(<sel>)`: the shadow-selector grammar
 *     projected onto the light tree, byte-for-byte the rewrite the runtime
 *     used to apply to the same sheet.
 *   - Prologue at-rules (`@charset`, `@import`, `@namespace`) are hoisted
 *     above the wrapper: they are only valid before any other rule, so
 *     leaving them inside `@scope` would drop them. They stay unscoped, and
 *     that is the honest boundary — the protocol scopes the sheet it owns,
 *     and an imported sheet resolves against the emitted asset's URL like any
 *     other URL in that file.
 *
 * Every other at-rule (`@media`, `@supports`, `@layer`, `@container`,
 * `@keyframes`, `@font-face`, `@property`, …) is a valid member of `@scope`'s
 * rule list and stays inside the wrapper, so conditional and registration
 * at-rules keep the component's scope exactly as authored.
 */

/** At-rules that must precede every other rule, so they cannot be scoped. */
const PROLOGUE_AT_RULES = new Set(['charset', 'import', 'namespace']);

/** Index of the first byte after the comment starting at `index`. */
function skipComment(css: string, index: number): number {
  let cursor = index + 2;
  while (cursor < css.length) {
    if (css[cursor] === '*' && css[cursor + 1] === '/') return cursor + 2;
    cursor++;
  }
  return css.length;
}

/** Index of the first byte after the string starting at `index` (quote form). */
function skipString(css: string, index: number): number {
  const quote = css[index];
  let cursor = index + 1;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    cursor++;
    if (char === quote) return cursor;
  }
  return css.length;
}

/** Index of the first non-trivia byte at or after `index`. */
function skipTrivia(css: string, index: number): number {
  let cursor = index;
  while (cursor < css.length) {
    const char = css[cursor]!;
    if (char === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      cursor++;
      continue;
    }
    return cursor;
  }
  return css.length;
}

/** Index of the first byte after the block opened at `open`. */
function skipBlock(css: string, open: number): number {
  let depth = 0;
  let cursor = open;
  while (cursor < css.length) {
    const char = css[cursor]!;
    if (char === '"' || char === "'") {
      cursor = skipString(css, cursor);
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (char === '{') {
      depth++;
      cursor++;
      continue;
    }
    if (char === '}') {
      depth--;
      cursor++;
      if (depth === 0) return cursor;
      continue;
    }
    cursor++;
  }
  return css.length;
}

interface AtRuleHead {
  readonly name: string;
  /** Index of the first byte after the at-rule's `;` or block. */
  readonly end: number;
  /** True when the at-rule owns a block (`{…}`) rather than a `;`. */
  readonly block: boolean;
}

/**
 * Read the at-rule opening at `index` (`@name …`), without interpreting its
 * prelude: the scan is string-, comment- and paren-aware and stops at the
 * first `;` or `{` outside any of them. Returns undefined when `index` does
 * not open an at-rule.
 */
function readAtRule(css: string, index: number): AtRuleHead | undefined {
  if (css[index] !== '@') return undefined;
  let cursor = index + 1;
  const nameStart = cursor;
  while (cursor < css.length && /[A-Za-z0-9-]/.test(css[cursor]!)) cursor++;
  const name = css.slice(nameStart, cursor).toLowerCase();
  if (name === '') return undefined;
  let parens = 0;
  while (cursor < css.length) {
    const char = css[cursor]!;
    if (char === '"' || char === "'") {
      cursor = skipString(css, cursor);
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      cursor = skipComment(css, cursor);
      continue;
    }
    if (char === '(') {
      parens++;
      cursor++;
      continue;
    }
    if (char === ')') {
      parens = Math.max(0, parens - 1);
      cursor++;
      continue;
    }
    if (parens === 0 && char === ';') return { name, end: cursor + 1, block: false };
    if (parens === 0 && char === '{') return { name, end: skipBlock(css, cursor), block: true };
    cursor++;
  }
  return { name, end: css.length, block: false };
}

/**
 * Split the sheet's leading prologue at-rules from the rest. The split is a
 * byte offset into the original text: a sheet with no prologue at-rule is
 * handed back verbatim, so the emitted asset of an ordinary component sheet
 * is `@scope (<tag>) {…}` around the authored bytes and nothing else changes.
 */
function splitPrologue(css: string): { prologue: string; body: string } {
  let cursor = skipTrivia(css, 0);
  let prologueEnd = -1;
  for (;;) {
    const head = readAtRule(css, cursor);
    if (!head || !PROLOGUE_AT_RULES.has(head.name)) break;
    prologueEnd = head.end;
    cursor = skipTrivia(css, head.end);
  }
  if (prologueEnd < 0) return { prologue: '', body: css };
  return { prologue: css.slice(0, prologueEnd), body: css.slice(prologueEnd) };
}

/**
 * Project the shadow-selector grammar onto the light tree. Strings and
 * comments are preserved byte-for-byte — a `:host` inside a string or a
 * comment is text, not a selector.
 */
function projectLightRootSelectors(css: string): string {
  let output = '';
  let quote: '"' | "'" | undefined;
  let comment = false;

  for (let index = 0; index < css.length;) {
    const char = css[index]!;
    const next = css[index + 1];

    if (comment) {
      output += char;
      index++;
      if (char === '*' && next === '/') {
        output += next;
        index++;
        comment = false;
      }
      continue;
    }

    if (quote) {
      output += char;
      index++;
      if (char === '\\' && index < css.length) {
        output += css[index];
        index++;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output += '/*';
      index += 2;
      comment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      output += char;
      index++;
      quote = char;
      continue;
    }
    if (css.startsWith(':host(', index)) {
      output += ':scope:is(';
      index += ':host('.length;
      continue;
    }
    if (css.startsWith(':host', index)) {
      const boundary = css[index + ':host'.length];
      if (boundary === undefined || !/[\w-]/.test(boundary)) {
        output += ':scope';
        index += ':host'.length;
        continue;
      }
    }
    if (css.startsWith('::slotted(', index)) {
      output += 'slot > :is(';
      index += '::slotted('.length;
      continue;
    }

    output += char;
    index++;
  }

  return output;
}

/**
 * Scope one light-root component stylesheet to its own tag. Empty input stays
 * empty: a component with no authored rules must not emit an empty scope
 * block into its asset.
 */
export function scopeLightRootCss(tag: string, css: string): string {
  if (css.length === 0) return '';
  const { prologue, body } = splitPrologue(css);
  const scoped = `@scope (${tag}) {\n${projectLightRootSelectors(body)}\n}`;
  return prologue === '' ? scoped : `${prologue}\n${scoped}`;
}
