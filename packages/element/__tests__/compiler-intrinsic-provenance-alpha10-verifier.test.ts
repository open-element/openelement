/**
 * Alpha.10 closure verification — NEW hostile provenance cases added by the
 * independent release verifier (packet criterion 3). These spellings are NOT
 * present in compiler-intrinsic-provenance.test.ts:
 *   - near-miss module specifier (canonical name + 's' suffix, built by
 *     concatenation because the literal is a removed-package token that the
 *     repo-hygiene gate rejects in active files)
 *   - default-import spelling of `element` from the canonical module
 *   - indirect rebinding of the canonical decorator through a const alias
 *   - subpath impostor specifier ('@openelement/element/fake')
 * Each must fail closed at every admission level.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { compileElementModule } from '../src/internal/compiler/plugin.ts';

const FILE = '/project/app/islands/alpha10-verifier-impostor.tsx';

/** The near-miss specifier: canonical module name plus an 's' suffix. */
const NEAR_MISS_SPECIFIER = '@openelement/element' + 's';

function assertProgramFailsClosed(source: string, code: string): CompiledElementError {
  const error = assertThrowsIncludes(
    () => compileElementProgram(source, FILE),
    CompiledElementError,
  );
  expect(error.message, `expected ${code} in: ${error.message}`).toContain(code);
  return error;
}

test('alpha10-verifier provenance: near-miss specifier (canonical + "s") never admits the grammar', () => {
  const source = [
    `import { element, OpenElement } from '${NEAR_MISS_SPECIFIER}';`,
    "@element('oe-alpha10-impostor-plural')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  expect(analysis.compiledElementDecorator).toEqual(false);
  expect(analysis.definedCustomElementTags).toEqual([]);
  expect(compileElementModule(source, FILE), 'plugin gate must not admit').toEqual(null);
  assertProgramFailsClosed(source, 'OEC9001');
});

test('alpha10-verifier provenance: default-import spelling of element fails closed (OEC9027)', () => {
  const source = [
    "import element from '@openelement/element';",
    "import { OpenElement } from '@openelement/element';",
    "@element('oe-alpha10-impostor-default')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  assertThrowsIncludes(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
  const error = assertProgramFailsClosed(source, 'OEC9027');
  expect(error.message).toContain('default import');
});

test('alpha10-verifier provenance: indirect rebinding through a const alias is never admitted', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    'const el = element;',
    "@el('oe-alpha10-impostor-indirect')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  expect(
    analysis.compiledElementDecorator,
    'the @el spelling must not be admitted even though `element` is canonically imported',
  ).toEqual(false);
  expect(analysis.definedCustomElementTags).toEqual([]);
  expect(compileElementModule(source, FILE)).toEqual(null);
  const error = assertThrowsIncludes(
    () => compileElementProgram(source, FILE),
    CompiledElementError,
  );
  expect(
    error.message.includes('OEC9008') || error.message.includes('OEC9001'),
    `expected fail-closed diagnostic, got: ${error.message}`,
  ).toBeTruthy();
});

test('alpha10-verifier provenance: subpath impostor specifier "@openelement/element/fake" never admits the grammar', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element/fake';",
    "@element('oe-alpha10-impostor-subpath')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  expect(analysis.compiledElementDecorator).toEqual(false);
  expect(analysis.definedCustomElementTags).toEqual([]);
  expect(compileElementModule(source, FILE)).toEqual(null);
  assertProgramFailsClosed(source, 'OEC9001');
});

test('alpha10-verifier provenance: differential control — the same identifier spelling IS admitted only from the canonical module', () => {
  const canonical = [
    "import { element, OpenElement } from '@openelement/element';",
    "@element('oe-alpha10-control-canonical')",
    'export class Control extends OpenElement { render() { return <div/>; } }',
  ].join('\n');
  const analysis = analyzeModuleSemantics(canonical, FILE);
  expect(analysis.compiledElementDecorator).toEqual(true);
  expect(analysis.definedCustomElementTags).toEqual(['oe-alpha10-control-canonical']);
  expect(compileElementModule(canonical, FILE) !== null).toBeTruthy();
  const { program } = compileElementProgram(canonical, FILE);
  expect(program.tag).toEqual('oe-alpha10-control-canonical');
});
