/**
 * @openelement/element — #1209 (A10.1): compiler intrinsics are binding
 * identities, not identifier spellings.
 *
 * Hostile provenance matrix. One canonical intrinsic-binding model (owned by
 * the semantic core, module-analysis.ts) decides whether a decorator,
 * heritage clause or factory call is an OpenElement intrinsic: the identifier
 * must be a runtime named import of the intrinsic from its canonical module
 * ('@openelement/element'), aliases followed. A bare or
 * global spelling NEVER admits an intrinsic; unrelated same-name bindings
 * (third-party imports, local declarations, ambient declares) never enter the
 * grammar; unsupported or ambiguous provenance (type-only imports, namespace
 * access, conflicting duplicates, relative-module re-exports) fails closed
 * with a source-located diagnostic instead of being silently admitted.
 * Sidecar bindings (the island policy statement) are admitted only through
 * host-injected 'static-sidecar' descriptors — the core ships none by
 * default (#1468).
 *
 * Admission levels under test:
 *   - analyzeModuleSemantics: the descriptive module scan (scanner admission)
 *   - compileElementModule:   the plugin gate (null = not admitted)
 *   - compileElementProgram:  the compiler boundary (throws OEC9xx)
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import {
  analyzeModuleSemantics,
  type ModuleVocabularyDescriptor,
  type StaticSidecarDescriptor,
} from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { compileElementModule } from '../src/internal/compiler/plugin.ts';

const FILE = '/project/app/islands/provenance.tsx';

/**
 * The router registration vocabulary a host framework injects (#1473): the
 * module scan ships no router knowledge, so the router's registration factory
 * is recognized only through this explicit descriptor. (`defineIsland` is
 * retired vocabulary — removed from both packages in v0.44 — and is
 * deliberately absent here and in the router's own list.)
 */
const ROUTER_VOCABULARY: readonly ModuleVocabularyDescriptor[] = [
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'defineElement',
    kind: 'element-registration',
  },
];

/**
 * The island sidecar descriptor a host framework injects (#1468): the
 * semantic core ships no router knowledge, so island policy admission is
 * exercised through this explicit descriptor.
 */
const ISLAND_SIDECAR: StaticSidecarDescriptor = {
  moduleSpecifier: '@openelement/router',
  exportName: 'defineIslandConfig',
  kind: 'static-sidecar',
};

function compileError(source: string, file = FILE): CompiledElementError {
  try {
    compileElementProgram(source, file);
  } catch (error) {
    expect(
      error instanceof CompiledElementError,
      `expected CompiledElementError, got ${error}`,
    ).toBeTruthy();
    return error;
  }
  throw new Error(`expected compilation to fail closed:\n${source}`);
}

test('provenance: canonical imports admit the grammar and intrinsic bindings are stripped', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-provenance-canonical')",
    'export class Canonical extends OpenElement {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <div>{this.count}</div>; }',
    '}',
  ].join('\n');

  const analysis = analyzeModuleSemantics(source, FILE);
  expect(analysis.compiledElementDecorator).toEqual(true);
  expect(analysis.definedCustomElementTags).toEqual(['oe-provenance-canonical']);

  const gated = compileElementModule(source, FILE);
  expect(gated !== null, 'canonical module must be admitted through the plugin gate').toBeTruthy();

  const { code, program } = compileElementProgram(source, FILE);
  expect(program.tag).toEqual('oe-provenance-canonical');
  // element/property are compile-time-only intrinsics: the runtime package
  // exports neither, so the generated module must not import them.
  expect(code).toContain("import { OpenElement } from '@openelement/element';");
  expect(code.includes('element,'), code).toEqual(false);
  expect(code.includes('property,'), code).toEqual(false);
  expect(code.includes('@element')).toEqual(false);
  expect(code.includes('@property')).toEqual(false);
});

test('provenance: aliased canonical OpenElement heritage compiles and codegen follows the alias', () => {
  const source = [
    "import { element, OpenElement as OpenBase, property } from '@openelement/element';",
    "@element('oe-provenance-alias-base')",
    'export class AliasBase extends OpenBase {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <div>{this.count}</div>; }',
    '}',
  ].join('\n');
  const { code, program } = compileElementProgram(source, FILE);
  expect(program.tag).toEqual('oe-provenance-alias-base');
  expect(code).toContain('extends OpenBase {');
  expect(code).toContain("import { OpenElement as OpenBase } from '@openelement/element';");
});

test('provenance: aliased canonical decorator and property imports compile', () => {
  const source = [
    "import { element as defineElement, OpenElement, property as field } from '@openelement/element';",
    "@defineElement('oe-provenance-alias-decorator')",
    'export class AliasDecorator extends OpenElement {',
    "  @field({ reflect: false }) label = 'ready';",
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  const analysis = analyzeModuleSemantics(source, FILE);
  expect(analysis.compiledElementDecorator).toEqual(true);
  expect(analysis.definedCustomElementTags).toEqual(['oe-provenance-alias-decorator']);
  const { code, program } = compileElementProgram(source, FILE);
  expect(program.tag).toEqual('oe-provenance-alias-decorator');
  expect(program.metadata.properties[0].name).toEqual('label');
  // Both compile-time-only bindings strip to the one runtime import.
  expect(code).toContain("import { OpenElement } from '@openelement/element';");
  expect(code.includes('defineElement'), code).toEqual(false);
  expect(code.includes('@field'), code).toEqual(false);
});

test('provenance: aliased computed, trustedHtml and defineIslandConfig stay canonical', () => {
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
  const { code, program } = compileElementProgram(source, FILE, {
    staticSidecars: [ISLAND_SIDECAR],
  });
  expect(program.root.kind).toEqual('shadow-open');
  const upper = program.metadata.properties.find((p) => p.name === 'upper');
  expect(upper?.computed).toEqual(true);
  expect(upper?.deps).toEqual(['label']);
  // The island policy statement is recognized by provenance (aliased import)
  // and copied verbatim into the generated module.
  expect(code).toContain(
    "export const openElement = island({ hydrate: 'load', ssr: true, dsd: true });",
  );
  // The derived-signal factory calls the aliased canonical binding.
  expect(code).toContain('derive(() => __s.label.value)');
  expect(
    program.parts.some((part) => part.k === 'html'),
    'html Part must exist',
  ).toBeTruthy();
});

test('provenance: an unrelated third-party function named element is never admitted', () => {
  const source = [
    "import { element } from '@third-party/decorators';",
    "import { OpenElement, property } from '@openelement/element';",
    "@element('oe-foreign-element')",
    'export class Foreign extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  expect(compileElementModule(source, FILE)).toEqual(null);
  const error = compileError(source);
  expect(String(error)).toContain('OEC9001');
});

test('provenance: an unrelated local class named OpenElement fails heritage closed', () => {
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
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(true);
  const error = compileError(source);
  expect(String(error)).toContain('OEC9003');
  expect(String(error)).toContain('OpenElement');
  assertThrowsIncludes(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9003');
});

test('provenance: a local same-name element function is never admitted', () => {
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
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  expect(compileElementModule(source, FILE)).toEqual(null);
  // Fed to the compiler directly, the local function declaration is itself
  // outside the compiled module grammar — either way the module never enters
  // the language through a same-name spelling.
  const error = compileError(source);
  expect(String(error)).toContain('OEC9008');
});

test('provenance: the legacy ambient declare spelling is never admitted', () => {
  const source = [
    "import { OpenElement, property } from '@openelement/element';",
    'declare function element(tag: string): ClassDecorator;',
    "@element('oe-ambient-element')",
    'export class Ambient extends OpenElement {',
    '  @property({ reflect: false }) x = 0;',
    '  render() { return <div>{this.x}</div>; }',
    '}',
  ].join('\n');
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  expect(compileElementModule(source, FILE)).toEqual(null);
  const error = compileError(source);
  expect(String(error)).toContain('OEC9001');
});

test('provenance: an unbound bare element spelling is never admitted', () => {
  const source = [
    "import { OpenElement } from '@openelement/element';",
    "@element('oe-unbound-element')",
    'export class Unbound extends OpenElement {',
    '  render() { return <div>ok</div>; }',
    '}',
  ].join('\n');
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  expect(compileElementModule(source, FILE)).toEqual(null);
  const error = compileError(source);
  expect(String(error)).toContain('OEC9001');
});

test('provenance: lexical shadowing of computed by a local binding fails closed', () => {
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
  expect(String(error)).toContain('OEC9025');
  expect(String(error)).toContain('computed');
});

test('provenance: computed imported from a third-party module fails closed', () => {
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
  expect(String(error)).toContain('OEC9025');
  expect(String(error)).toContain('@openelement/element');
});

test('provenance: a bare trustedHtml wrapper without the canonical import fails closed', () => {
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
  expect(String(error)).toContain('OEC9026');
  expect(String(error)).toContain('trustedHtml');
});

test('provenance: a third-party property decorator fails closed', () => {
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
  expect(String(error)).toContain('OEC9004');
});

test('provenance: type-only element imports are unsupported and fail closed (OEC9027)', () => {
  for (const importLine of [
    "import type { element } from '@openelement/element';\n" +
      "import { OpenElement, property } from '@openelement/element';",
    "import { type element, OpenElement, property } from '@openelement/element';",
  ]) {
    const source = [
      importLine,
      "@element('oe-type-only-element')",
      'export class TypeOnly extends OpenElement {',
      '  @property({ reflect: false }) x = 0;',
      '  render() { return <div>{this.x}</div>; }',
      '}',
    ].join('\n');
    const analysis = analyzeModuleSemantics(source, FILE);
    expect(analysis.compiledElementDecorator).toEqual(false);
    expect(
      typeof analysis.unsupportedElementDecorator === 'string',
      'module analysis must surface the unsupported decorator provenance',
    ).toBeTruthy();
    assertThrowsIncludes(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
    const error = compileError(source);
    expect(String(error)).toContain('OEC9027');
    expect(String(error)).toContain('type-only');
  }
});

test('provenance: namespace imports are unsupported and fail closed (OEC9027)', () => {
  const source = [
    "import * as OE from '@openelement/element';",
    "@OE.element('oe-namespace-element')",
    'export class Namespaced extends OE.OpenElement {',
    '  render() { return <div>ok</div>; }',
    '}',
  ].join('\n');
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  // The cheap plugin prefilter matches '@element(' literally, so a
  // namespace-qualified decorator never even reaches analysis — the module
  // passes through untouched rather than entering the grammar.
  expect(compileElementModule(source, FILE)).toEqual(null);
  // The compiler boundary itself still fails closed with the provenance
  // diagnostic when invoked directly.
  const error = compileError(source);
  expect(String(error)).toContain('OEC9027');
  expect(String(error)).toContain('namespace');
});

test('provenance: duplicate conflicting element bindings fail closed (OEC9027)', () => {
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
  expect(analyzeModuleSemantics(source, FILE).compiledElementDecorator).toEqual(false);
  assertThrowsIncludes(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
  const error = compileError(source);
  expect(String(error)).toContain('OEC9027');
  expect(String(error)).toContain('conflicting');
});

test('provenance: relative-module re-export provenance fails closed (OEC9027)', () => {
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
  expect(analysis.compiledElementDecorator).toEqual(false);
  expect(analysis.unsupportedElementDecorator ?? '').toContain('canonical');
  assertThrowsIncludes(() => compileElementModule(source, FILE), CompiledElementError, 'OEC9027');
  const error = compileError(source);
  expect(String(error)).toContain('OEC9027');
});

test('provenance: the island policy statement requires the canonical defineIslandConfig', () => {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    "export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });",
    "@element('oe-bare-island-config')",
    'export class BareIslandConfig extends OpenElement {',
    '  render() { return <main>ok</main>; }',
    '}',
  ].join('\n');
  const error = compileError(source);
  expect(String(error)).toContain('OEC9008');
  // Injection does not soften the bare-spelling edge: an unbound spelling is
  // never the policy statement, descriptor or not.
  assertThrowsIncludes(
    () => compileElementProgram(source, FILE, { staticSidecars: [ISLAND_SIDECAR] }),
    CompiledElementError,
    'OEC9008',
  );
});

test('provenance: the island sidecar is admitted only through the injected descriptor', () => {
  const imported = [
    "import { element, OpenElement } from '@openelement/element';",
    "import { defineIslandConfig } from '@openelement/router';",
    "export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });",
    "@element('oe-injected-island-config')",
    'export class InjectedIslandConfig extends OpenElement {',
    '  render() { return <main>ok</main>; }',
    '}',
  ].join('\n');

  // Element default (no injection) admits no island sidecar: the canonically
  // imported statement stays outside the compiled module grammar (OEC9008)
  // at both the plugin gate and the compiler boundary.
  const error = compileError(imported);
  expect(String(error)).toContain('OEC9008');
  assertThrowsIncludes(() => compileElementModule(imported, FILE), CompiledElementError, 'OEC9008');

  // With the host descriptor injected, the plugin gate and the compiler
  // boundary share the same admission and copy the statement verbatim.
  const options = { staticSidecars: [ISLAND_SIDECAR] };
  const gated = compileElementModule(imported, FILE, options);
  expect(
    gated !== null,
    'the injected descriptor must admit the island policy statement',
  ).toBeTruthy();
  expect(gated.code).toContain('export const openElement = defineIslandConfig(');
  const { code } = compileElementProgram(imported, FILE, options);
  expect(code).toContain('export const openElement = defineIslandConfig(');

  // The fail-closed provenance edges are descriptor-scoped, not
  // spelling-scoped: namespace access, type-only imports, default imports,
  // relative re-exports and foreign same-name bindings never admit the
  // statement, even under injection.
  const withEdge = (importLine: string, statement: string) =>
    [
      "import { element, OpenElement } from '@openelement/element';",
      importLine,
      statement,
      "@element('oe-island-edge')",
      'export class IslandEdge extends OpenElement {',
      '  render() { return <main>ok</main>; }',
      '}',
    ].join('\n');
  const edges: Array<[string, string]> = [
    [
      "import * as router from '@openelement/router';",
      "export const openElement = router.defineIslandConfig({ hydrate: 'load' });",
    ],
    [
      "import { type defineIslandConfig } from '@openelement/router';",
      "export const openElement = defineIslandConfig({ hydrate: 'load' });",
    ],
    [
      "import defineIslandConfig from '@openelement/router';",
      "export const openElement = defineIslandConfig({ hydrate: 'load' });",
    ],
    [
      "import { defineIslandConfig } from './island-config.ts';",
      "export const openElement = defineIslandConfig({ hydrate: 'load' });",
    ],
    [
      "import { defineIslandConfig } from '@third-party/islands';",
      "export const openElement = defineIslandConfig({ hydrate: 'load' });",
    ],
  ];
  for (const [importLine, statement] of edges) {
    const edgeError = compileError(withEdge(importLine, statement));
    expect(String(edgeError)).toContain('OEC9008');
  }
});

test('provenance: module analysis drops bare-spelling defineElement but keeps bound imports', () => {
  const bare = analyzeModuleSemantics(
    "defineElement('oe-bare-defined', {});",
    '/project/app/routes/bare.tsx',
  );
  expect(bare.definedCustomElementTags).toEqual([]);
  expect(bare.usesExportedTagName).toEqual(false);

  const boundSource = [
    "import { defineElement } from '@openelement/router';",
    "export const tagName = 'oe-bound-defined';",
    'defineElement(tagName, {});',
  ].join('\n');
  // Default scan (no injected vocabulary): the router factory is unknown —
  // fail closed.
  const unadmitted = analyzeModuleSemantics(boundSource, '/project/app/routes/unadmitted.tsx');
  expect(unadmitted.definedCustomElementTags).toEqual([]);
  expect(unadmitted.usesExportedTagName).toEqual(false);
  // Host-injected vocabulary: the bound import is recognized (aliases
  // followed, canonical specifier).
  const bound = analyzeModuleSemantics(boundSource, '/project/app/routes/bound.tsx', {
    vocabulary: ROUTER_VOCABULARY,
  });
  expect(bound.usesExportedTagName).toEqual(true);
});
