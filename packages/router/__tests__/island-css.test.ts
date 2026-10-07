/**
 * @openelement/router - internal/island-css.ts tests (#1543)
 *
 * The client-build stylesheet minifier: whitespace/comment-only folding that
 * never merges tokens a delimiter cannot join (calc +/- grammar, descendant
 * selectors, comment-joined compounds, hex-escape terminators), plus the
 * module rewrite that locates stylesheet template literals through the
 * compiled-element contract channel — the authored `static styles`
 * PropertyDefinition and the compiler's `__partProgram` part-program module
 * (the shape decorators' class-field lowering actually ships), scoped within
 * that module to the lowered `__publicField(_, "styles", ...)` value subtree
 * (#1563: the module's method-body templates are runtime payloads, not CSS).
 * Anything
 * whose raw bytes the CSS rules cannot judge — JS escapes in the template,
 * tagged templates the tag cooks — and anything outside the contract
 * channel fails open byte-identical.
 */
import { expect, test } from 'vitest';
import { minifyIslandCssModule, minifyStyleSheet } from '../src/vite/internal/island-css.ts';

test('minifyStyleSheet strips comments, newlines, and indentation', () => {
  const sheet = `
  :host {
    display: inline-block;
  }
  /* section comment */
  .a:hover { color: red; }
  `;
  expect(minifyStyleSheet(sheet)).toBe(':host{display:inline-block;}.a:hover{color:red;}');
});

test('minifyStyleSheet preserves calc +- spacing (dropping it emits invalid CSS)', () => {
  const sheet = '.x{width:calc(var(--s) * 0.25 + 10px);}';
  expect(minifyStyleSheet(sheet)).toBe('.x{width:calc(var(--s) * 0.25 + 10px);}');
});

test('minifyStyleSheet preserves descendant combinators and a :hover gap', () => {
  expect(minifyStyleSheet('.wrap .inner * { color: red; }')).toBe('.wrap .inner *{color:red;}');
  expect(minifyStyleSheet('a :hover { fill: currentColor; }')).toBe('a :hover{fill:currentColor;}');
});

test('minifyStyleSheet keeps a comment-joined compound selector compound', () => {
  // A comment contributes no whitespace: .a/**/.b is one compound selector
  // and must not gain a descendant space.
  expect(minifyStyleSheet('.a/**/.b { color: red; }')).toBe('.a.b{color:red;}');
  // Real whitespace still folds to exactly one descendant space, with or
  // without a comment riding in the gap.
  expect(minifyStyleSheet('.a .b { color: red; }')).toBe('.a .b{color:red;}');
  expect(minifyStyleSheet('.a /**/ .b { color: red; }')).toBe('.a .b{color:red;}');
});

test('minifyStyleSheet keeps hex escapes, their terminator space, and the descendant gap', () => {
  // \31 escapes the digit 1; its one optional whitespace terminator belongs
  // to the escape token, and the second space is the descendant combinator.
  // Both must survive: one space would cook the minified sheet as the
  // compound .x1.b instead of the descendant .x1 .b.
  expect(minifyStyleSheet('.x\\31  .b { color: red; }')).toBe('.x\\31  .b{color:red;}');
  // A terminator before a delimiter stays consumable — cooking still reads
  // the same selector.
  expect(minifyStyleSheet('.x\\31 { color: red; }')).toBe('.x\\31{color:red;}');
  // Non-hex escapes still consume exactly one literal character.
  expect(minifyStyleSheet('.x\\@media .b { color: red; }')).toBe('.x\\@media .b{color:red;}');
});

test('minifyStyleSheet keeps quoted content byte-identical', () => {
  // Separator whitespace between content values is syntax, not output; the
  // quoted bodies themselves must survive untouched.
  expect(minifyStyleSheet('a::before{content:"§"  counter(i)  "  ";}')).toBe(
    'a::before{content:"§" counter(i) "  ";}',
  );
});

test('minifyStyleSheet drops spaces only against delimiters that cannot continue the token', () => {
  expect(minifyStyleSheet('a , b > c ; d')).toBe('a,b > c;d');
  expect(minifyStyleSheet('@media (max-width: 900px) { .a { display: none } }')).toBe(
    '@media (max-width:900px){.a{display:none}}',
  );
});

test('minifyStyleSheet is deterministic and idempotent', () => {
  const sheet = '.a{ color: red; } /* c */\n.b { margin : 0 auto ; }';
  const once = minifyStyleSheet(sheet);
  expect(once).toBe(minifyStyleSheet(sheet));
  expect(minifyStyleSheet(once)).toBe(once);
});

test('minifyIslandCssModule rewrites static styles template literals', () => {
  const module = [
    'import { recipe } from "x";',
    'export class Foo {',
    '  static styles = [recipe(`',
    '    .a {',
    '      color: red;',
    '    }',
    '  `)];',
    '}',
  ].join('\n');
  const rewritten = minifyIslandCssModule(module);
  expect(rewritten).toContain('`.a{color:red;}`');
  expect(rewritten).toContain('import { recipe } from "x";');
});

test('minifyIslandCssModule rewrites the compiled part-program module real builds ship', () => {
  // The real pipeline never shows a `static styles` PropertyDefinition: the
  // @element decorator forces class-field lowering, so the initializer rides
  // `__publicField(...)` module statements in the compiler's part-program
  // module. The compiled-module ABI marker `__partProgram` is the provable
  // contract channel there — only the element compiler emits it.
  const partProgramModule = [
    'import { compiledStyle } from "@openelement/element";',
    'class OpenBadge extends OpenElement {}',
    '__publicField(OpenBadge, "styles", [compiledStyle(`',
    '  .control {',
    '    color: red;',
    '  }',
    '`)]);',
    'export const facade = {',
    '  __elementMetadata: () => meta,',
    '  __partProgram: () => program,',
    '};',
  ].join('\n');
  const rewritten = minifyIslandCssModule(partProgramModule);
  expect(rewritten).toContain('`.control{color:red;}`');
  // The program object's own template literals (tag names, node ids) carry
  // no minifiable whitespace and stay verbatim.
  expect(rewritten).toContain('() => program,');
});

test('minifyIslandCssModule scopes part-program admission to the __publicField styles subtree (#1563)', () => {
  // The part-program channel once admitted the whole module: a method-body
  // template (runtime markup, a business string) with minifiable whitespace
  // was silently rewritten like a stylesheet. Admission is the lowered
  // `static styles` field alone — the `__publicField(_, "styles", ...)`
  // value subtree; everything else ships byte-identical.
  const partProgramModule = [
    'import { compiledStyle } from "@openelement/element";',
    'class OpenBadge extends OpenElement {}',
    '__publicField(OpenBadge, "styles", [compiledStyle(`',
    '  .control {',
    '    color: red;',
    '  }',
    '`)]);',
    'export const facade = {',
    '  __elementMetadata: () => meta,',
    '  __partProgram: () => program,',
    '  caption() {',
    '    return `',
    '      <span class="open-badge__count">  keep   this  spacing </span>',
    '    `;',
    '  },',
    '};',
  ].join('\n');
  const rewritten = minifyIslandCssModule(partProgramModule);
  expect(rewritten).toContain('`.control{color:red;}`');
  expect(rewritten).toContain(
    [
      '    return `',
      '      <span class="open-badge__count">  keep   this  spacing </span>',
      '    `;',
    ].join('\n'),
  );
});

test('minifyIslandCssModule refuses the lowered __publicField shape outside a part-program module', () => {
  // The ABI marker is the provenance gate for the lowered shape: a helper
  // call with a "styles" key in a module the element compiler did not emit
  // is a guess, not the contract — it fails open byte-identical.
  const loweredModule = [
    'import { compiledStyle } from "@openelement/element";',
    'class PlainBadge {}',
    '__publicField(PlainBadge, "styles", [compiledStyle(`',
    '  .control {',
    '    color: red;',
    '  }',
    '`)]);',
  ].join('\n');
  expect(minifyIslandCssModule(loweredModule)).toBe(null);
});

test('minifyIslandCssModule still refuses class-external templates in part-program-adjacent modules', () => {
  // Same sheet constant, but the module is not compiler output (no
  // `__partProgram`): the contract channel must not open for it.
  const plainModule = [
    'import { compiledStyle } from "@openelement/element";',
    'export const SHEET = compiledStyle(`',
    '  .control {',
    '    color: red;',
    '  }',
    '`);',
  ].join('\n');
  expect(minifyIslandCssModule(plainModule)).toBe(null);
});

test('minifyIslandCssModule rewrites only static styles templates (admission is the contract channel)', () => {
  // Tier-2 is gone: a template outside a `static styles` initializer is
  // never rewritten, however CSS-like it reads — the light-DOM sheet const
  // ships byte-identical again.
  const cssConst = 'export const HERO = `\n  .hero-main * { cursor: none !important; }\n`;';
  expect(minifyIslandCssModule(cssConst)).toBe(null);
  // A plain business string carrying the brace-colon shape rides a real
  // build byte-identical: the transform (the only stage that touches
  // template-literal content) declines it.
  const business = 'export const MSG = `\nHello { name:  customer }!\n`;';
  expect(minifyIslandCssModule(business)).toBe(null);
  // Markup residue is equally out of the contract channel.
  const htmlConst = 'export const T = `\n<div class="a">  keep   spacing </div>\n`;';
  expect(minifyIslandCssModule(htmlConst)).toBe(null);
});

test('minifyIslandCssModule skips templates whose raw content carries a JS escape', () => {
  // The scan reads raw source between the backticks. The `\"` below cooks
  // into a real quote, so the runtime CSS string opens where the raw bytes
  // saw an escape — CSS quote rules on the raw text fold the string-interior
  // double spaces. Fail open: the sheet ships byte-identical.
  const module = [
    'export class A {',
    '  static styles = `a::before{content:\\"  spaced  \\";}`;',
    '}',
  ].join('\n');
  expect(minifyIslandCssModule(module)).toBe(null);
});

test('minifyIslandCssModule never rewrites a tagged template (the tag cooks it)', () => {
  const tagged = 'export const SHEET = css`\n  .a { color: red; }\n`;';
  expect(minifyIslandCssModule(tagged)).toBe(null);
});

test('minifyIslandCssModule leaves interpolated templates and quoted strings untouched', () => {
  const interpolated = 'const sheet = (v) => `\ncolor: ${v};\n`;';
  expect(minifyIslandCssModule(interpolated)).toBe(null);
  const plain = 'const k = `modulepreload`;';
  expect(minifyIslandCssModule(plain)).toBe(null);
});

test('minifyIslandCssModule fails open on unparseable input', () => {
  expect(minifyIslandCssModule('this is not `java\nscript`')).toBe(null);
});

test('minifyIslandCssModule skips extraction-path modules (ADR-0164 narrowing)', () => {
  // The style asset protocol's extraction path removes the sheet bytes from
  // the module; the request import edge marks it. Whatever templates remain
  // are Part Program payloads, never component CSS — the transform's
  // admission is the legacy verbatim path alone, so an extraction-path
  // module returns null even when it still looks like #1543's channel.
  const extractionPathModule = [
    "import __oeStyle from './open-badge.oe-style.css';",
    'class OpenBadge extends OpenElement {}',
    '__publicField(OpenBadge, "styles", [__oeStyle]);',
    'export const facade = {',
    '  __elementMetadata: () => meta,',
    '  __partProgram: () => program,',
    '};',
  ].join('\n');
  expect(minifyIslandCssModule(extractionPathModule)).toBe(null);
  // The same module WITH an inlined legacy sheet shape is not enough to
  // escape the narrowing — the marker, not the shape, decides.
  const legacyModule = [
    'import { compiledStyle } from "@openelement/element";',
    'class OpenBadge extends OpenElement {}',
    '__publicField(OpenBadge, "styles", [compiledStyle(`',
    '  .control {',
    '    color: red;',
    '  }',
    '`)]);',
    'export const facade = {',
    '  __elementMetadata: () => meta,',
    '  __partProgram: () => program,',
    '};',
  ].join('\n');
  expect(minifyIslandCssModule(legacyModule)).toContain('`.control{color:red;}`');
});
