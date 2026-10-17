/**
 * Build-time light-root CSS scoping (alpha15 S lane, S-C1.2).
 *
 * The scoping contract the runtime used to apply per activation is now the
 * build's: the emitted asset IS the scoped stylesheet. These tests pin the
 * shape of that asset — one native `@scope` block per component tag, the
 * shadow-selector projection, byte-preservation outside the deliberate moves,
 * and the prologue-at-rule rule.
 */
import { expect, test } from 'vitest';
import { scopeLightRootCss } from '../src/vite/internal/light-css-scope.ts';

test('light-root CSS uses one native scope and projects shadow selectors', () => {
  const css = `
:host { display: block; }
:host([rail]) .shell, :host(:not([rail])) .main { color: red; }
.body ::slotted(p) { margin: 0; }
@media (max-width: 40rem) { .shell { display: grid; } }
`;

  expect(scopeLightRootCss('open-reading-shell', css)).toEqual(`@scope (open-reading-shell) {\n
:scope { display: block; }
:scope:is([rail]) .shell, :scope:is(:not([rail])) .main { color: red; }
.body slot > :is(p) { margin: 0; }
@media (max-width: 40rem) { .shell { display: grid; } }
\n}`);
});

test('light-root CSS preserves selector-like text in strings and comments', () => {
  const scoped = scopeLightRootCss(
    'oe-card',
    `/* :host ::slotted(*) */ .card::before { content: ":host ::slotted(*)"; }`,
  );

  expect(scoped).toContain('/* :host ::slotted(*) */');
  expect(scoped).toContain('content: ":host ::slotted(*)"');
});

test('light-root CSS leaves empty styles empty', () => {
  expect(scopeLightRootCss('oe-card', '')).toEqual('');
});

test('a sheet with no prologue at-rule is wrapped byte-for-byte', () => {
  // The whole sheet is copied, trivia included: the only deliberate moves are
  // the wrapper and the shadow-selector projection.
  const css = '  .a {\n  color: red;\n}\n.b::after { content: "}"; }\n';
  expect(scopeLightRootCss('oe-x', css)).toEqual(`@scope (oe-x) {\n${css}\n}`);
});

test('prologue at-rules are hoisted above the scope, everything else stays inside', () => {
  const css = [
    `@charset "utf-8";`,
    `@import url('./palette.css') layer(base);`,
    `@namespace svg url(http://www.w3.org/2000/svg);`,
    `@layer tokens, components;`,
    `@font-face { font-family: x; src: url('./x.woff2'); }`,
    `@property --tone { syntax: "<color>"; inherits: true; initial-value: red; }`,
    `@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }`,
    `@container (min-width: 10rem) { .a { color: red } }`,
    `@supports (display: grid) { .b { display: grid } }`,
    `:host { --tone: blue; }`,
  ].join('\n');

  const scoped = scopeLightRootCss('oe-x', css);
  const scopeIndex = scoped.indexOf('@scope (oe-x) {');

  // The three prologue at-rules precede the wrapper — inside it they would be
  // dropped by the parser — and the sheet's own conditional/registration
  // at-rules stay in the scoped body, exactly as authored.
  expect(scoped.indexOf(`@charset "utf-8";`)).toBeLessThan(scopeIndex);
  expect(scoped.indexOf(`@import url('./palette.css') layer(base);`)).toBeLessThan(scopeIndex);
  expect(scoped.indexOf(`@namespace svg url(http://www.w3.org/2000/svg);`)).toBeLessThan(
    scopeIndex,
  );
  for (const inside of [
    '@layer tokens, components;',
    '@font-face',
    '@property --tone',
    '@keyframes pulse',
    '@container (min-width: 10rem)',
    '@supports (display: grid)',
    ':scope { --tone: blue; }',
  ]) {
    expect(scoped.indexOf(inside), `${inside} stays inside the scope`).toBeGreaterThan(scopeIndex);
  }
  expect(scoped.indexOf('@scope (oe-x) {')).toEqual(scoped.lastIndexOf('@scope (oe-x) {'));
});

test('a prologue inside a comment or a string is not hoisted', () => {
  const css = `/* @import './decoy.css'; */ .a::before { content: "@charset \\"utf-8\\";"; }`;
  const scoped = scopeLightRootCss('oe-x', css);
  expect(scoped.startsWith('@scope (oe-x) {')).toEqual(true);
  expect(scoped).toContain(`/* @import './decoy.css'; */`);
});
