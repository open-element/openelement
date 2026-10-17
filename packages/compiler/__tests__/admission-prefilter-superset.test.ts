/**
 * packages/compiler/__tests__/admission-prefilter-superset.test.ts — the cheap
 * admission prefilter is a conservative SUPERSET of semantic admission.
 *
 * Admission has exactly one authority: the semantic core. The prefilter
 * (`isCompiledElementModule`) may only decide whether a module is worth
 * parsing, so every spelling the semantic layer admits must reach it. The
 * prefilter this suite pins used to model the decorator-application shape with
 * an ASCII-identifier-plus-whitespace regex, which rejected legal JavaScript
 * the semantic core accepts:
 *   - a Unicode alias binding (`import { element as 元件 }` with
 *     `@元件('…')`) — TS identifiers are not `[A-Za-z_$][\w$]*`;
 *   - a comment between the decorator name and its call (`@element` with a
 *     block comment before the argument list) — the lexer skips comments, the
 *     regex did not.
 * Both compiled through `analyzeModuleSemantics`/`compileElementProgram` but
 * `compileElementModule` returned null: semantics accepted, prefilter vetoed.
 * The fix narrows the prefilter to the one fact every authored form shares —
 * a supported module whose source contains '@' — and this suite pins both the
 * repaired spellings and the contract around them:
 *   - ASCII alias, canonical name: admitted (unchanged);
 *   - a foreign same-name binding and marker mentions in strings/comments:
 *     still pass through untouched (false-positive '@' costs one parse);
 *   - a namespace spelling still reaches the compiler and fails closed with
 *     the OEC9027 provenance diagnostic;
 *   - a plain module without a decorator (which contains '@' in its import
 *     specifier alone) still passes through.
 */

import { expect, test } from 'vitest';
import { CompiledElementError, compileElementModule } from '../src/compiler.ts';

const FILE = '/proj/app/islands/audit-prefilter.tsx';

/** One decorated component, spelled with the given binding and decorator. */
function decoratedSource(binding: string, decorator: string): string {
  return [
    `import { ${binding}, OpenElement } from '@openelement/element';`,
    decorator,
    'export class AuditPrefilter extends OpenElement {',
    '  render() { return <div>audit</div>; }',
    '}',
  ].join('\n');
}

test('the prefilter admits a Unicode alias binding the semantic core accepts', () => {
  const compiled = compileElementModule(
    decoratedSource('element as 元件', "@元件('audit-prefilter')"),
    FILE,
  );
  expect(compiled, 'semantic admission must not be vetoed by the cheap prefilter').not.toEqual(
    null,
  );
  expect(compiled!.program.tag).toEqual('audit-prefilter');
});

test('the prefilter admits a comment between the decorator name and its call', () => {
  const compiled = compileElementModule(
    decoratedSource('element', "@element/**/('audit-prefilter')"),
    FILE,
  );
  expect(compiled, 'the lexer skips the comment; the prefilter must too').not.toEqual(null);
  expect(compiled!.program.tag).toEqual('audit-prefilter');
});

test('the prefilter still admits the ASCII alias binding', () => {
  const compiled = compileElementModule(
    decoratedSource('element as defineElement', "@defineElement('audit-prefilter')"),
    FILE,
  );
  expect(compiled).not.toEqual(null);
  expect(compiled!.program.tag).toEqual('audit-prefilter');
});

test('the prefilter still admits the canonical @element spelling', () => {
  const compiled = compileElementModule(
    decoratedSource('element', "@element('audit-prefilter')"),
    FILE,
  );
  expect(compiled).not.toEqual(null);
  expect(compiled!.program.tag).toEqual('audit-prefilter');
});

test('a foreign same-name binding still passes through untouched', () => {
  // `element` from another module is not canonical provenance and not
  // unsupported: the semantic core stays silent, so the module is not compiled
  // — even though its source contains '@' and the prefilter lets it through.
  const foreign = [
    "import { element, OpenElement } from 'foreign-lib';",
    "@element('audit-prefilter')",
    'export class Foreign extends OpenElement {',
    '  render() { return <div>foreign</div>; }',
    '}',
  ].join('\n');
  expect(compileElementModule(foreign, FILE)).toEqual(null);
});

test('a namespace spelling still fails closed with the OEC9027 provenance diagnostic', () => {
  // Admission decisions stay with the semantic core: the prefilter must route
  // the unsupported spelling IN so it fails closed, never out silently.
  const namespaced = [
    "import * as Elements from '@openelement/element';",
    "@Elements.element('audit-prefilter')",
    'export class Namespaced extends OpenElement {',
    '  render() { return <div>namespaced</div>; }',
    '}',
  ].join('\n');
  let thrown: unknown;
  try {
    compileElementModule(namespaced, FILE);
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'the namespace spelling must reach the compiler and fail').toBeInstanceOf(
    CompiledElementError,
  );
  const codes = (thrown as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain('OEC9027');
});

test('a plain module without a decorator still passes through untouched', () => {
  // The import specifier alone puts '@' in the source; the prefilter must not
  // turn that into a compile or an error — the semantic core admits nothing.
  const plain = [
    "import { OpenElement } from '@openelement/element';",
    'export class Plain extends OpenElement {',
    '  render() { return <div>plain</div>; }',
    '}',
  ].join('\n');
  expect(compileElementModule(plain, FILE)).toEqual(null);
});

test('a module that only mentions the marker in a string or comment still passes through', () => {
  // The other direction of the same contract: a false-positive '@' costs one
  // parse and nothing else — the semantic layer, not the prefilter, decides.
  const mentionOnly = [
    'const docs = "decorate with @element(\'oe-string\') to opt in";',
    "// @element('oe-line-comment') is what a real opt-in looks like",
    'export class MentionOnly {',
    '  render() { return <div>not compiled</div>; }',
    '}',
  ].join('\n');
  expect(compileElementModule(mentionOnly, FILE)).toEqual(null);
});

test('a non-tsx module id is never admitted, decorator or not', () => {
  const compiled = compileElementModule(
    decoratedSource('element', "@element('audit-prefilter')"),
    '/proj/app/islands/audit-prefilter.ts',
  );
  expect(compiled).toEqual(null);
});
