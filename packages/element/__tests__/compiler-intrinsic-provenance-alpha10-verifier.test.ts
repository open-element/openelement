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

import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
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
  const error = assertThrows(
    () => compileElementProgram(source, FILE),
    CompiledElementError,
  );
  assertStringIncludes(error.message, code, `expected ${code} in: ${error.message}`);
  return error;
}

Deno.test('alpha10-verifier provenance: near-miss specifier (canonical + "s") never admits the grammar', () => {
  const source = [
    `import { element, OpenElement } from '${NEAR_MISS_SPECIFIER}';`,
    "@element('oe-alpha10-impostor-plural')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(analysis.compiledElementDecorator, false);
  assertEquals(analysis.definedCustomElementTags, []);
  assertEquals(compileElementModule(source, FILE), null, 'plugin gate must not admit');
  assertProgramFailsClosed(source, 'OEC9001');
});

Deno.test('alpha10-verifier provenance: default-import spelling of element fails closed (OEC9027)', () => {
  const source = [
    "import element from '@openelement/element';",
    "import { OpenElement } from '@openelement/element';",
    "@element('oe-alpha10-impostor-default')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  assertThrows(
    () => compileElementModule(source, FILE),
    CompiledElementError,
    'OEC9027',
  );
  const error = assertProgramFailsClosed(source, 'OEC9027');
  assertStringIncludes(error.message, 'default import');
});

Deno.test('alpha10-verifier provenance: indirect rebinding through a const alias is never admitted', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    'const el = element;',
    "@el('oe-alpha10-impostor-indirect')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(
    analysis.compiledElementDecorator,
    false,
    'the @el spelling must not be admitted even though `element` is canonically imported',
  );
  assertEquals(analysis.definedCustomElementTags, []);
  assertEquals(compileElementModule(source, FILE), null);
  const error = assertThrows(() => compileElementProgram(source, FILE), CompiledElementError);
  assert(
    error.message.includes('OEC9008') || error.message.includes('OEC9001'),
    `expected fail-closed diagnostic, got: ${error.message}`,
  );
});

Deno.test('alpha10-verifier provenance: subpath impostor specifier "@openelement/element/fake" never admits the grammar', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element/fake';",
    "@element('oe-alpha10-impostor-subpath')",
    'export class Impostor extends OpenElement { render() { return <div/>; } }',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(analysis.compiledElementDecorator, false);
  assertEquals(analysis.definedCustomElementTags, []);
  assertEquals(compileElementModule(source, FILE), null);
  assertProgramFailsClosed(source, 'OEC9001');
});

Deno.test('alpha10-verifier provenance: differential control — the same identifier spelling IS admitted only from the canonical module', () => {
  const canonical = [
    "import { element, OpenElement } from '@openelement/element';",
    "@element('oe-alpha10-control-canonical')",
    'export class Control extends OpenElement { render() { return <div/>; } }',
  ].join('\n');
  const analysis = analyzeModuleSemantics(canonical, FILE);
  assertEquals(analysis.compiledElementDecorator, true);
  assertEquals(analysis.definedCustomElementTags, ['oe-alpha10-control-canonical']);
  assert(compileElementModule(canonical, FILE) !== null);
  const { program } = compileElementProgram(canonical, FILE);
  assertEquals(program.tag, 'oe-alpha10-control-canonical');
});
