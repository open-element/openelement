/**
 * Island CSS minification (#1543).
 *
 * The Phase 2 client build minifies JS (`build.minify: 'oxc'`), but a JS
 * minifier never touches template-literal content — and every component
 * stylesheet ships inside one. The oxc-minified chunks therefore carried the
 * authored CSS formatting verbatim (the www app-shell chunk measured 719
 * lines, the bulk of them sheet whitespace), which is why consumers had begun
 * hand-minifying sheets in source (open-page-rail, the hero cursor const).
 *
 * This module minifies those sheets at the client-build transform stage, in
 * two tiers:
 *
 * 1. Template literals inside a `static styles` initializer — CSS by the
 *    compiled-element contract (the compiler copies that initializer verbatim
 *    into the Part Program module; its members are StyleSheetLike values).
 * 2. Any other expression-less template literal that passes a strict
 *    stylesheet test — authored CSS constants outside a class body (the
 *    light-DOM cursor sheet pattern).
 *
 * Everything else is left byte-identical: interpolated templates, quoted
 * strings, non-CSS template content. The minifier itself is whitespace- and
 * comment-only, quote- and escape-aware, and drops a space only against a
 * delimiter that cannot continue the neighbouring token — so `calc(10px + 2px)`
 * and descendant selectors survive (folding `+`/`-` spacing like a general
 * CSS minifier would emit invalid calc grammar). Pure function of its input:
 * deterministic bytes for the DETERMINISTIC_* build contracts.
 */

import { parseAst } from 'vite';

interface AstNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/** Characters after which a following space is always droppable. */
const DROP_SPACE_AFTER = new Set([';', ',', '{', '}', '(', ':']);
/** Characters before which a preceding space is always droppable. */
const DROP_SPACE_BEFORE = new Set([';', ',', '{', '}', ')']);

/**
 * Minify one stylesheet: strip comments, collapse whitespace runs to a single
 * space, and drop that space where a delimiter makes it provably redundant.
 * Quoted strings and backslash escapes are copied verbatim.
 */
export function minifyStyleSheet(css: string): string {
  let out = '';
  let pendingSpace = false;
  let quote: string | null = null;
  let escaped = false;
  let inComment = false;

  const flushSpace = (keepSpace: boolean): void => {
    if (!pendingSpace) return;
    if (keepSpace) out += ' ';
    pendingSpace = false;
  };

  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (inComment) {
      if (char === '*' && css[index + 1] === '/') {
        inComment = false;
        index++;
        pendingSpace = true;
      }
      continue;
    }
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      // A backslash escape can start any token — the space before it may be
      // a descendant combinator, so it is never droppable.
      flushSpace(true);
      out += char;
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === '"' || char === "'") {
      flushSpace(true);
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      inComment = true;
      index++;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (DROP_SPACE_BEFORE.has(char)) {
      pendingSpace = false;
      while (out.endsWith(' ')) out = out.slice(0, -1);
      out += char;
      continue;
    }
    const previous = out[out.length - 1] ?? '';
    flushSpace(!DROP_SPACE_AFTER.has(previous));
    out += char;
  }
  return out.trim();
}

/**
 * Tier-2 admission test: an expression-less template literal outside a
 * `static styles` initializer ships as a stylesheet only when it structurally
 * reads as CSS — at least one braced declaration block, and a residue outside
 * the braces that carries no markup characters (rejects HTML fragments and
 * prose whose braces never wrap `name: value` declarations).
 */
function looksLikeStyleSheet(text: string): boolean {
  if (!/\{[^{}]*:[^{}]*\}/.test(text)) return false;
  const residue = text.replace(/\{[^{}]*\}/g, '');
  return !/[<>]/.test(residue);
}

/** Whitespace/comment evidence that minifying can only shrink the text. */
function hasMinifiableWhitespace(text: string): boolean {
  return /\n|\r|\t| {2}|\/\*/.test(text);
}

function collectReplacements(
  node: AstNode,
  code: string,
  inStyles: boolean,
  out: Replacement[],
): void {
  if (node.type === 'TemplateLiteral') {
    // A single quasi means no `${}` interpolation: the backtick range is
    // exactly [start, end) and the content is runtime data the JS minifier
    // preserves byte-for-byte.
    const start = node.start;
    const end = node.end;
    if (
      typeof start === 'number' &&
      typeof end === 'number' &&
      code[start] === '`' &&
      code[end - 1] === '`' &&
      Array.isArray(node.quasis) &&
      node.quasis.length === 1
    ) {
      const content = code.slice(start + 1, end - 1);
      const admitted = inStyles || looksLikeStyleSheet(content);
      if (admitted && hasMinifiableWhitespace(content)) {
        const minified = minifyStyleSheet(content);
        if (minified.length < content.length) {
          out.push({ start: start + 1, end: end - 1, text: minified });
        }
      }
    }
    return;
  }
  if (
    node.type === 'PropertyDefinition' &&
    node.static === true &&
    !node.computed &&
    (node.key as AstNode | undefined)?.type === 'Identifier' &&
    (node.key as AstNode).name === 'styles' &&
    node.value
  ) {
    collectReplacements(node.value as AstNode, code, true, out);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          collectReplacements(item as AstNode, code, inStyles, out);
        }
      }
    } else if (value && typeof value === 'object') {
      collectReplacements(value as AstNode, code, inStyles, out);
    }
  }
}

/**
 * Rewrite one transformed module's stylesheet template literals. Returns the
 * rewritten code, or null when nothing changed (including unparseable input —
 * a minification pass fails open to today's output, never breaks the build).
 */
export function minifyIslandCssModule(code: string): string | null {
  if (!code.includes('`')) return null;
  let program: AstNode;
  try {
    program = parseAst(code) as unknown as AstNode;
  } catch {
    return null;
  }
  const replacements: Replacement[] = [];
  collectReplacements(program, code, false, replacements);
  if (replacements.length === 0) return null;
  let result = code;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}
