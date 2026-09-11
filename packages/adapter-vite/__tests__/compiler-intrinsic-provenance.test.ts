/**
 * @openelement/adapter-vite — #1209 (A10.1): compiler intrinsics are binding
 * identities, not identifier spellings.
 *
 * Hostile provenance matrix. One canonical intrinsic-binding model (owned by
 * the semantic core, module-analysis.ts) decides whether a decorator,
 * heritage clause or factory call is an OpenElement intrinsic: the identifier
 * must be a runtime named import of the intrinsic from its canonical module
 * ('@openelement/element', '@openelement/router'), aliases followed. A bare or
 * global spelling NEVER admits an intrinsic; unrelated same-name bindings
 * (third-party imports, local declarations, ambient declares) never enter the
 * grammar; unsupported or ambiguous provenance (type-only imports, namespace
 * access, conflicting duplicates, relative-module re-exports) fails closed
 * with a source-located diagnostic instead of being silently admitted.
 *
 * Admission levels under test:
 *   - analyzeModuleSemantics: the descriptive module scan (scanner admission)
 *   - compileElementModule:   the plugin gate (null = not admitted)
 *   - compileElementProgram:  the compiler boundary (throws OEC9xx)
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { compileElementModule } from '../src/internal/compiler/plugin.ts';

const FILE = '/project/app/islands/provenance.tsx';

function compileError(source: string, file = FILE): CompiledElementError {
  try {
    compileElementProgram(source, file);
  } catch (error) {
    assert(error instanceof CompiledElementError, `expected CompiledElementError, got ${error}`);
    return error;
  }
  throw new Error(`expected compilation to fail closed:\n${source}`);
}

Deno.test('provenance: canonical imports admit the grammar and intrinsic bindings are stripped', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-provenance-canonical')",
    'export class Canonical extends OpenElement {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <div>{this.count}</div>; }',
    '}',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(analysis.compiledElementDecorator, true);
  assertEquals(analysis.definedCustomElementTags, ['oe-provenance-canonical']);

  const gated = compileElementModule(source, FILE);
  assert(gated !== null, 'canonical module must be admitted through the plugin gate');

  const { code, program } = compileElementProgram(source, FILE);
  assertEquals(program.tag, 'oe-provenance-canonical');
  // element/property are compile-time-only intrinsics: the runtime package
  // exports neither, so the generated module must not import them.
  assertStringIncludes(code, "import { OpenElement } from '@openelement/element';");
  assertEquals(code.includes('element,'), false, code);
  assertEquals(code.includes('property,'), false, code);
  assertEquals(code.includes('@element'), false);
  assertEquals(code.includes('@property'), false);
});

Deno.test('provenance: aliased canonical OpenElement heritage compiles and codegen follows the alias', () => {
  const source = [
    "import { element, OpenElement as OpenBase, property } from '@openelement/element';",
    "@element('oe-provenance-alias-base')",
    'export class AliasBase extends OpenBase {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <div>{this.count}</div>; }',
    '}',
  ].join('\n');
  const { code, program } = compileElementProgram(source, FILE);
  assertEquals(program.tag, 'oe-provenance-alias-base');
  assertStringIncludes(code, 'extends OpenBase {');
  assertStringIncludes(code, "import { OpenElement as OpenBase } from '@openelement/element';");
});

Deno.test('provenance: aliased canonical decorator and property imports compile', () => {
  const source = [
    "import { element as defineElement, OpenElement, property as field } from '@openelement/element';",
    "@defineElement('oe-provenance-alias-decorator')",
    'export class AliasDecorator extends OpenElement {',
    "  @field({ reflect: false }) label = 'ready';",
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(analysis.compiledElementDecorator, true);
  assertEquals(analysis.definedCustomElementTags, ['oe-provenance-alias-decorator']);
  const { code, program } = compileElementProgram(source, FILE);
  assertEquals(program.tag, 'oe-provenance-alias-decorator');
  assertEquals(program.metadata.properties[0].name, 'label');
  // Both compile-time-only bindings strip to the one runtime import.
  assertStringIncludes(code, "import { OpenElement } from '@openelement/element';");
  assertEquals(code.includes('defineElement'), false, code);
  assertEquals(code.includes('@field'), false, code);
});

Deno.test('provenance: aliased computed, trustedHtml and defineIslandConfig stay canonical', () => {
  const source = [
    'import {',
    '  computed as derive,',
    '  element,',
    '  OpenElement,',
    '  property,',
    '  trustedHtml as html,',
    '  type TrustedHtml,',
    "} from '@openelement/element';",
    "import { defineIslandConfig as island } from '@openelement/router';",
    "export const openElement = island({ hydrate: 'load', ssr: true, dsd: true });",
    "@element('oe-provenance-alias-factories', { root: 'shadow-open' })",
    'export default class AliasFactories extends OpenElement {',
    "  @property({ reflect: false }) label = 'x';",
    '  @property({ reflect: false, attribute: false }) upper = derive(() => this.label);',
    '  @property({ type: Object, reflect: false, attribute: false }) body: TrustedHtml =' +
    " html('<b>x</b>');",
    '  render() {',
    '    return <main><div innerHTML={this.body} trustedHtml></div><span>{this.upper}</span></main>;',
    '  }',
    '}',
  ].join('\n');
  const { code, program } = compileElementProgram(source, FILE);
  assertEquals(program.root.kind, 'shadow-open');
  const upper = program.metadata.properties.find((p) => p.name === 'upper');
  assertEquals(upper?.computed, true);
  assertEquals(upper?.deps, ['label']);
  // The island policy statement is recognized by provenance (aliased import)
  // and copied verbatim into the generated module.
  assertStringIncludes(
    code,
    "export const openElement = island({ hydrate: 'load', ssr: true, dsd: true });",
  );
  // The derived-signal factory calls the aliased canonical binding.
  assertStringIncludes(code, 'derive(() => __s.label.value)');
  assert(program.parts.some((part) => part.k === 'html'), 'html Part must exist');
});

Deno.test('provenance: an unrelated third-party function named element is never admitted', () => {
  const source = [
    "import { element } from '@third-party/decorators';",
    "import { OpenElement, property } from '@openelement/element';",
    "@element('oe-foreign-element')",
    'export class Foreign extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  assertEquals(compileElementModule(source, FILE), null);
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9001');
});

Deno.test('provenance: an unrelated local class named OpenElement fails heritage closed', () => {
  const source = [
    "import { element, property } from '@openelement/element';",
    // An ambient module-scope binding keeps the compiled-module grammar shape
    // intact so the heritage provenance check (not a module shape rule)
    // decides: the local OpenElement never counts as the canonical import.
    'declare const OpenElement: new () => HTMLElement;',
    "@element('oe-local-open-element')",
    'export class LocalBase extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  // The decorator is canonical, so the module is admitted — then the heritage
  // clause fails closed because the local class is not the canonical binding.
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, true);
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9003');
  assertStringIncludes(String(error), 'OpenElement');
  assertThrows(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9003');
});

Deno.test('provenance: a local same-name element function is never admitted', () => {
  const source = [
    "import { OpenElement, property } from '@openelement/element';",
    'function element(_tag: string) {',
    '  return () => {};',
    '}',
    "@element('oe-local-element')",
    'export class LocalDecorator extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  assertEquals(compileElementModule(source, FILE), null);
  // Fed to the compiler directly, the local function declaration is itself
  // outside the compiled module grammar — either way the module never enters
  // the language through a same-name spelling.
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9008');
});

Deno.test('provenance: the legacy ambient declare spelling is never admitted', () => {
  const source = [
    "import { OpenElement, property } from '@openelement/element';",
    'declare function element(tag: string): ClassDecorator;',
    "@element('oe-ambient-element')",
    'export class Ambient extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  assertEquals(compileElementModule(source, FILE), null);
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9001');
});

Deno.test('provenance: an unbound bare element spelling is never admitted', () => {
  const source = [
    "import { OpenElement } from '@openelement/element';",
    "@element('oe-unbound-element')",
    'export class Unbound extends OpenElement {',
    '  render() { return <div>ok</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  assertEquals(compileElementModule(source, FILE), null);
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9001');
});

Deno.test('provenance: lexical shadowing of computed by a local binding fails closed', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    // An ambient module-scope binding shadows the (absent) canonical import:
    // the `computed(...)` call resolves to the local declaration, never to
    // the intrinsic.
    'declare function computed(fn: () => unknown): unknown;',
    "@element('oe-shadow-computed')",
    'export class ShadowComputed extends OpenElement {',
    "  @property({ reflect: false }) label = 'x';",
    '  @property({ reflect: false, attribute: false }) derived = computed(() => this.label);',
    '  render() { return <main>{this.label}</main>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9025');
  assertStringIncludes(String(error), 'computed');
});

Deno.test('provenance: computed imported from a third-party module fails closed', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "import { computed } from '@preact/signals-core';",
    "@element('oe-foreign-computed')",
    'export class ForeignComputed extends OpenElement {',
    "  @property({ reflect: false }) label = 'x';",
    '  @property({ reflect: false, attribute: false }) derived = computed(() => this.label);',
    '  render() { return <main>{this.label}</main>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9025');
  assertStringIncludes(String(error), '@openelement/element');
});

Deno.test('provenance: a bare trustedHtml wrapper without the canonical import fails closed', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-bare-trusted-html')",
    'export class BareTrustedHtml extends OpenElement {',
    '  @property({ type: Object, reflect: false, attribute: false }) body = ' +
    "trustedHtml('<b>x</b>');",
    '  render() { return <main><div innerHTML={this.body} trustedHtml></div></main>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9026');
  assertStringIncludes(String(error), 'trustedHtml');
});

Deno.test('provenance: a third-party property decorator fails closed', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    "import { property } from '@third-party/decorators';",
    "@element('oe-foreign-property')",
    'export class ForeignProperty extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9004');
});

Deno.test('provenance: type-only element imports are unsupported and fail closed (OEC9027)', () => {
  for (
    const importLine of [
      "import type { element } from '@openelement/element';\n" +
      "import { OpenElement, property } from '@openelement/element';",
      "import { type element, OpenElement, property } from '@openelement/element';",
    ]
  ) {
    const source = [
      importLine,
      "@element('oe-type-only-element')",
      'export class TypeOnly extends OpenElement {',
      '  @property({ reflect: false }) x = 0;',
      '  render() { return <div>{this.x}</div>; }',
      '}',
    ].join('\n');
    const analysis = analyzeModuleSemantics(source, FILE);
    assertEquals(analysis.compiledElementDecorator, false);
    assert(
      typeof analysis.unsupportedElementDecorator === 'string',
      'module analysis must surface the unsupported decorator provenance',
    );
    assertThrows(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
    const error = compileError(source);
    assertStringIncludes(String(error), 'OEC9027');
    assertStringIncludes(String(error), 'type-only');
  }
});

Deno.test('provenance: namespace imports are unsupported and fail closed (OEC9027)', () => {
  const source = [
    "import * as OE from '@openelement/element';",
    "@OE.element('oe-namespace-element')",
    'export class Namespaced extends OE.OpenElement {',
    '  render() { return <div>ok</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  // The cheap plugin prefilter matches '@element(' literally, so a
  // namespace-qualified decorator never even reaches analysis — the module
  // passes through untouched rather than entering the grammar.
  assertEquals(compileElementModule(source, FILE), null);
  // The compiler boundary itself still fails closed with the provenance
  // diagnostic when invoked directly.
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9027');
  assertStringIncludes(String(error), 'namespace');
});

Deno.test('provenance: duplicate conflicting element bindings fail closed (OEC9027)', () => {
  const source = [
    "import { element } from '@openelement/element';",
    "import { element } from '@third-party/decorators';",
    "import { OpenElement, property } from '@openelement/element';",
    "@element('oe-conflicting-element')",
    'export class Conflicting extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, FILE).compiledElementDecorator, false);
  assertThrows(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9027');
  assertStringIncludes(String(error), 'conflicting');
});

Deno.test('provenance: relative-module re-export provenance fails closed (OEC9027)', () => {
  // Deliberate non-support: the semantic core analyzes one module and stays
  // bundler-neutral (ADR-0148), so it never follows re-exports across files.
  // A relative import of the intrinsic name is treated as an intended but
  // unsupported re-export and fails closed with a clear diagnostic rather
  // than passing through silently like a genuine third-party binding.
  const source = [
    "import { element, OpenElement, property } from './oe-intrinsics.ts';",
    "@element('oe-re-exported-element')",
    'export class ReExported extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  const analysis = analyzeModuleSemantics(source, FILE);
  assertEquals(analysis.compiledElementDecorator, false);
  assertStringIncludes(analysis.unsupportedElementDecorator ?? '', 'canonical');
  assertThrows(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9027');
});

Deno.test('provenance: the island policy statement requires the canonical defineIslandConfig', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    "export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });",
    "@element('oe-bare-island-config')",
    'export class BareIslandConfig extends OpenElement {',
    '  render() { return <main>ok</main>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  assertStringIncludes(String(error), 'OEC9008');
});

Deno.test('provenance: module analysis drops bare-spelling defineElement but keeps bound imports', () => {
  const bare = analyzeModuleSemantics(
    "defineElement('oe-bare-defined', {});",
    '/project/app/routes/bare.tsx',
  );
  assertEquals(bare.definedCustomElementTags, []);
  assertEquals(bare.usesExportedTagName, false);

  const bound = analyzeModuleSemantics(
    [
      "import { defineElement } from '@openelement/router';",
      "export const tagName = 'oe-bound-defined';",
      'defineElement(tagName, {});',
    ].join('\n'),
    '/project/app/routes/bound.tsx',
  );
  assertEquals(bound.usesExportedTagName, true);
});
