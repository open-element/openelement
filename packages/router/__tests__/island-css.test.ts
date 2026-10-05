/**
 * @openelement/router - internal/island-css.ts tests (#1543)
 *
 * The client-build stylesheet minifier: whitespace/comment-only folding that
 * never merges tokens a delimiter cannot join (calc +/- grammar, descendant
 * selectors), plus the module rewrite that locates stylesheet template
 * literals — `static styles` initializers by the compiled-element contract,
 * other templates only through the strict stylesheet test.
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

test('minifyIslandCssModule rewrites non-styles template literals only when they read as CSS', () => {
  const cssConst = 'export const HERO = `\n  .hero-main * { cursor: none !important; }\n`;';
  expect(minifyIslandCssModule(cssConst)).toContain('`.hero-main *{cursor:none !important;}`');
  // Markup residue (tags outside any brace block) is never admitted.
  const htmlConst = 'export const T = `\n<div class="a">  keep   spacing </div>\n`;';
  expect(minifyIslandCssModule(htmlConst)).toBe(null);
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
