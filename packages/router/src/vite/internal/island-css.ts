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
 * This module minifies those sheets at the client-build transform stage. The
 * one admission channel is the compiled-element contract, in the two shapes
 * the initializer takes: a `static styles` PropertyDefinition (the authored
 * shape) and the compiler-emitted part-program module carrying the
 * `__partProgram` ABI marker (the shape real builds ship — the @element
 * decorator forces class-field lowering, and the compiler copies the
 * initializer verbatim into that module, whose members are StyleSheetLike
 * values, so the CSS reading is provable, not guessed). Everything else —
 * interpolated templates, tagged templates the tag cooks, templates whose
 * raw bytes carry a JS escape, class-external constants and business strings
 * that merely resemble CSS — is left byte-identical.
 *
 * The minifier itself is whitespace- and comment-only, quote- and
 * escape-aware, and drops a space only against a delimiter that cannot
 * continue the neighbouring token — so `calc(10px + 2px)`, descendant
 * selectors, comment-joined compound selectors, and hex escapes with their
 * terminator whitespace survive (folding `+`/`-` spacing like a general CSS
 * minifier would emit invalid calc grammar; eating an escape terminator
 * would merge a descendant into a compound). Pure function of its input:
 * deterministic bytes for the DETERMINISTIC_* build contracts.
 *
 * ADR-0164 (#1553) narrows the admission to the legacy verbatim path: island
 * modules on the style asset protocol's extraction path carry no JS-embedded
 * CSS, and this pass never sees them (see minifyIslandCssModule).
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

const HEX_DIGIT = /[0-9a-fA-F]/;
const WHITESPACE = /\s/;

/**
 * The style asset protocol's request marker (ADR-0164): a generated island
 * module imports its sheet as a `*.oe-style.css` sibling. Its presence marks
 * an extraction-path module — no JS-embedded CSS to minify.
 */
const STYLE_REQUEST_MARKER = '.oe-style.css';

/**
 * Minify one stylesheet: strip comments, collapse whitespace runs to a single
 * space, and drop that space where a delimiter makes it provably redundant.
 * Quoted strings and backslash escapes are copied verbatim; a CSS escape is
 * one to six hex digits plus at most one whitespace terminator (the
 * terminator joins the escape token — it never becomes folding whitespace),
 * any other escaped character is the single character after the backslash.
 * A comment contributes no whitespace of its own: only real adjacent
 * whitespace folds, so a comment between two compound-selector parts never
 * turns the compound into a descendant.
 */
export function minifyStyleSheet(css: string): string {
  let out = '';
  let pendingSpace = false;
  let quote: string | null = null;
  let inComment = false;

  const flushSpace = (keepSpace: boolean): void => {
    if (!pendingSpace) return;
    if (keepSpace) out += ' ';
    pendingSpace = false;
  };

  // Explicit index management (a for-loop update would skip the character
  // after every multi-char token the branches consume).
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (inComment) {
      if (char === '*' && css[index + 1] === '/') {
        inComment = false;
        index += 2;
      } else {
        index++;
      }
      continue;
    }
    if (char === '\\') {
      // A backslash escape can start any token — the space before it may be
      // a descendant combinator, so it is never droppable.
      flushSpace(true);
      out += char;
      index++;
      let hex = 0;
      while (hex < 6 && index < css.length && HEX_DIGIT.test(css[index])) {
        out += css[index];
        index++;
        hex++;
      }
      if (index < css.length && (hex === 0 || WHITESPACE.test(css[index]))) {
        // Hex escape: the optional terminator belongs to the escape token;
        // the next real whitespace still folds separately. Non-hex escape:
        // the single character after the backslash.
        out += css[index];
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      out += char;
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      flushSpace(true);
      quote = char;
      out += char;
      index++;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      inComment = true;
      index += 2;
      continue;
    }
    if (WHITESPACE.test(char)) {
      pendingSpace = true;
      index++;
      continue;
    }
    if (DROP_SPACE_BEFORE.has(char)) {
      pendingSpace = false;
      while (out.endsWith(' ')) out = out.slice(0, -1);
      out += char;
      index++;
      continue;
    }
    const previous = out[out.length - 1] ?? '';
    flushSpace(!DROP_SPACE_AFTER.has(previous));
    out += char;
    index++;
  }
  return out.trim();
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
  if (node.type === 'TaggedTemplateExpression') {
    // The tag cooks the template with its own escape processing, so the raw
    // bytes between the backticks are not the runtime text; a rewrite would
    // corrupt what the tag sees. Never descend into the quasi.
    return;
  }
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
      // The scan reads raw template source. A backslash begins a JS escape
      // whose cooked form the runtime CSS will carry (a cooked quote opens a
      // CSS string where the raw bytes saw an escape), so CSS quote rules on
      // the raw text would misjudge string state. Fail open: byte-identical.
      const admitted = inStyles && !content.includes('\\');
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
 *
 * Narrowed by ADR-0164 (#1553): a module carrying the style asset protocol's
 * request edge is on the extraction path — its stylesheet bytes left the JS
 * graph for the emitted `.css` asset, and the only template literals left in
 * it are Part Program payloads. The transform's admission is the legacy
 * verbatim path alone; when the legacy path empties (every island riding
 * extraction), this pass retires with it.
 */
export function minifyIslandCssModule(code: string): string | null {
  if (code.includes(STYLE_REQUEST_MARKER)) return null;
  if (!code.includes('`')) return null;
  let program: AstNode;
  try {
    program = parseAst(code) as unknown as AstNode;
  } catch {
    return null;
  }
  const replacements: Replacement[] = [];
  // The contract channel's compiled shape: the element compiler copies the
  // `static styles` initializer into a module carrying the compiled-module
  // ABI marker `__partProgram` (element protocol/part-program.ts; the router
  // references the same literal in its runtimes). Real builds never show the
  // authored PropertyDefinition — the @element decorator forces class-field
  // lowering, so the initializer rides `__publicField` module statements —
  // and without this marker the channel would never fire outside unit tests.
  // Inside a part-program module the whitespace-bearing templates are the
  // copied stylesheets; the program object's own literals carry tag names
  // and node ids, nothing minifiable, so the whitespace gate excludes them.
  const contractChannel = code.includes('__partProgram');
  collectReplacements(program, code, contractChannel, replacements);
  if (replacements.length === 0) return null;
  let result = code;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}
