/**
 * M11 prerequisite — the compiler-owned host-export identity (LOCAL, Node).
 *
 * M11 review (§3/§4.1/S1) rejected scanning the emitted namespace for a
 * `__ssrHost` suffix: the compiler owns the emitted export identity because it
 * makes the `hostWrapper` decision that appends `<Name>__ssrHost`. This file
 * pins the one additive build-metadata field that carries that decision to a
 * consumer:
 *
 * - `ssrHostExport` is produced at the SAME emit `hostWrapper` decision and
 *   propagated through `CompiledGeneratedElement`;
 * - the string names an export the emitted module actually declares — asserted
 *   by parsing the emitted module's AST rather than re-deriving
 *   `${component}__ssrHost` in the test;
 * - `null` covers the legal "no host producer" shapes: a light/absent root, a
 *   shadow root whose leaf emitted no `<Name>__ssr`, and a hostless/refused
 *   module. A shadow root without a producer is metadata (`null`), not an
 *   admission verdict: the admission-refusal policy is an owner decision and
 *   is NOT implemented here;
 * - a non-admitted module still returns no result, and the pre-existing
 *   fixed-identifier collision refusal still fails closed with no result;
 * - the field is return-only: the emitted module bytes, tail and source map are
 *   the pre-M11 emitter's output, and the metadata name never enters the text.
 *
 * Not claimed here: M11 registration/entry wiring, a namespace scan, a runtime
 * class static, host-attribute serialization, or any packed/browser evidence.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';

const FILE = '/proj/src/islands/card.tsx';
// D-root-source (2026-11-13): the host fact carries the tag only; the lane
// reads the root from the authored island sidecar.
const SITE: GeneratedElementSite = { tag: 'x-card' };

const SHADOW_SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'shadow', hydrate: 'idle' });\n";
const LIGHT_SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'light', hydrate: 'idle' });\n";

/** A shadow-root island whose leaf emits both `<Card>__ssr` and the host wrapper. */
const SHADOW_ISLAND = `${SHADOW_SIDECAR}
function Card() {
  return <div class="card"><slot></slot></div>;
}
export default Card;
`;

/** The same island shape on a light root: no host template, no wrapper. */
const LIGHT_ISLAND = `${LIGHT_SIDECAR}
function Card() {
  return <div class="card"><slot></slot></div>;
}
export default Card;
`;

/**
 * A shadow-root island whose leaf emits no `<Field>__ssr`: the `value` property
 * channel (`el.value = …`) keeps the component mount-only, so the M08 producer
 * slice has no `__ssr` export for the wrapper to call.
 */
const SHADOW_WITHOUT_SSR_ISLAND = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ root: 'shadow', properties: { value: { default: '' } }, hydrate: 'idle' });
function Field(props: { value: string }) {
  return <input value={props.value} />;
}
export default Field;
`;

/** A shadow-root island that also declares the would-be host name locally. */
const COLLIDING_ISLAND = `${SHADOW_SIDECAR}
const Card__ssrHost = 1;
function Card() {
  return <p>{Card__ssrHost}</p>;
}
export default Card;
`;

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  // The fixtures below are admitted by the function frontend; a null module
  // here would make every assertion vacuous.
  expect(front.diagnostics).toEqual([]);
  expect(front.module).not.toBeNull();
  return front.module!;
}

/** The emitted module's named function exports, read from its own AST. */
function exportedFunctionNames(code: string): string[] {
  const sourceFile = ts.createSourceFile(
    'generated-element.js',
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    const exported = (statement.modifiers ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (exported) names.push(statement.name.text);
  }
  return names;
}

/** The one host-producer export the emitted module's AST declares, if any. */
function emittedHostExports(code: string): string[] {
  return exportedFunctionNames(code).filter((name) => name.endsWith('__ssrHost'));
}

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

describe('M11 prerequisite — compiler-owned ssrHostExport metadata', () => {
  test('the emitter reports the host name from the same decision that appends the export', () => {
    const module = frontModule(SHADOW_ISLAND);
    const leaf = generateLeafModule(module);
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'Card',
      root: 'shadow-open',
    });
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.ssrHostExport).toBe('Card__ssrHost');
    // The reported string IS the emitted declaration (AST read), and the
    // wrapper is still the M09-2a host producer.
    expect(exportedFunctionNames(emitted.module!)).toContain(emitted.ssrHostExport);
    // P-3 (2026-11-21): this fixture carries a static `class="card"`, so the
    // producer grows the declared-stylesheet channel — the shared component
    // stylesheet can only reach the shadow tree through the DSD template, and a
    // utility-styled component has no `styles` declaration to trigger it. The
    // channel is TOLERANT here: absent URLs render without a link, so an app with
    // no utility engine is not failed closed.
    expect(emitted.module).toContain(
      `export function ${emitted.ssrHostExport}(props, lightChildren, attributes, styleLinks) {`,
    );
    expect(emitted.module).not.toContain('OEIR_LEAF_MISSING_VALUE: styleLinks');
    // M11: the emitted producer's third channel is the host attribute wire, and
    // its content props are seeded from the descriptor rows through the shell's
    // canonical conversion — the metadata field itself still never enters text.
    expect(emitted.module).toContain(
      '  const __oeHostProps = seedGeneratedElementHostProperties(__oeElementDescriptor.properties, props, attributes);',
    );
    expect(emitted.module).toContain('    ...(attributes === undefined ? {} : { attributes }),');
    // Return-only: the emitted text is the leaf prefix plus the tail, the
    // metadata field name never enters it, and the map and placement ledger are
    // still the leaf's reused ones. (P-3 grows the PRODUCER's parameter list, so
    // the tail is not byte-identical to the pre-P-3 tail for a class-carrying
    // module — the CANDIDATE-FREE sibling below pins that identity.)
    // The EMITTER's own leaf (not the bare `generateLeafModule` call above): P-3
    // passes `claimStyleLinkPrefix` when the channel exists, which legitimately
    // changes the leaf bytes — the identity that must hold is "module = leaf +
    // tail", not "module = the unflagged leaf + tail".
    expect(emitted.leaf).not.toBeNull();
    expect(emitted.module!.startsWith(emitted.leaf!)).toBe(true);
    expect(emitted.module!.length).toBe(emitted.leaf!.length + emitted.tail!.length);
    expect(emitted.module).not.toContain('ssrHostExport');
    expect(emitted.tail).not.toContain('ssrHostExport');
    expect(emitted.sourceMap).toEqual(leaf.sourceMap);
    expect(emitted.placements).toEqual(leaf.placements);
  });

  test('a candidate-free shadow module keeps the pre-P-3 producer bytes', () => {
    // No static class anywhere: P-3 must not grow the channel, so the producer
    // keeps its pre-slice 3-parameter shape.
    const PLAIN = `${SHADOW_SIDECAR}
function Card() {
  return <div><slot></slot></div>;
}
export default Card;
`;
    const emitted = generateElementModule(frontModule(PLAIN), SITE, {
      rootComponent: 'Card',
      root: 'shadow-open',
    });
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.module).toContain(
      `export function ${emitted.ssrHostExport}(props, lightChildren, attributes) {`,
    );
    expect(emitted.module).not.toContain('styleLinks');
  });

  test('a hostless emitter call reports null and stays byte-identical to the leaf', () => {
    const module = frontModule(SHADOW_ISLAND);
    const leaf = generateLeafModule(module);
    const emitted = generateElementModule(module, null);
    expect(emitted.ssrHostExport).toBeNull();
    expect(emitted.module).toBe(leaf.module);
    expect(emitted.tail).toBeNull();
    expect(emittedHostExports(emitted.module!)).toEqual([]);
  });

  test('a light root and an absent root report null and append no host producer', () => {
    const module = frontModule(SHADOW_ISLAND);
    for (const root of ['light', undefined] as const) {
      const emitted = generateElementModule(module, SITE, {
        rootComponent: 'Card',
        ...(root === undefined ? {} : { root }),
      });
      expect(emitted.diagnostics).toEqual([]);
      expect(emitted.ssrHostExport).toBeNull();
      expect(emittedHostExports(emitted.module!)).toEqual([]);
      expect(emitted.module).not.toContain('__ssrHost');
    }
  });

  test('compile propagates the field and returns the emitter module byte-for-byte', () => {
    const compiled = compileGeneratedElementIfAdmitted(SHADOW_ISLAND, FILE, { site: SITE });
    expect(compiled).not.toBeNull();
    // Additive shape pin: the pre-M11 result keys, the M11 host identity, and the
    // P-1 class-candidate set — one field per dated contract addition, no more.
    expect(Object.keys(compiled!).sort()).toEqual([
      'classCandidates',
      'code',
      'component',
      'map',
      'ssrHostExport',
      'tag',
    ]);
    // The fixture's `<div class="card">` is the one static token: the candidate
    // set reads the SAME model the bytes come from, which is the point of P-1.
    expect(compiled!.classCandidates).toEqual(['card']);
    expect(compiled!.tag).toBe('x-card');
    expect(compiled!.component).toBe('Card');
    expect(compiled!.ssrHostExport).toBe('Card__ssrHost');

    // The compiler lane's output is exactly the emitter contract over the same
    // admitted module (the field adds no bytes, no map segments, no tail).
    const emitted = generateElementModule(frontModule(SHADOW_ISLAND), SITE, {
      rootComponent: 'Card',
      root: 'shadow-open',
    });
    expect(compiled!.code).toBe(emitted.module);
    expect(compiled!.map).toEqual(emitted.sourceMap);
    expect(compiled!.code).not.toContain('ssrHostExport');

    // The reported identity agrees with the export the ARTIFACT declares, not
    // with a suffix rule re-derived by the test.
    expect(emittedHostExports(compiled!.code)).toEqual([compiled!.ssrHostExport]);
    expect(compiled!.code).toContain(`export function ${compiled!.ssrHostExport}(`);
    // The wrapper calls the leaf's content-only producer: one host producer,
    // no registration, no class static.
    expect(compiled!.code).toContain('serializeGeneratedElementHtml');
    expect(compiled!.code).not.toContain('customElements');
    expect(compiled!.code).not.toContain('static ');
  });

  test('a light root compiles with null metadata and no host export in the AST', () => {
    const compiled = compileGeneratedElementIfAdmitted(LIGHT_ISLAND, FILE, { site: SITE });
    expect(compiled).not.toBeNull();
    expect(compiled!.ssrHostExport).toBeNull();
    expect(emittedHostExports(compiled!.code)).toEqual([]);
    expect(compiled!.code).not.toContain('__ssrHost');
    // The light tail keeps the M09-1a shape: the leaf producer still exists.
    expect(exportedFunctionNames(compiled!.code)).toContain('Card__ssr');
  });

  test('a shadow root whose leaf has no __ssr reports null (lawful metadata)', () => {
    const compiled = compileGeneratedElementIfAdmitted(SHADOW_WITHOUT_SSR_ISLAND, FILE, {
      site: SITE,
    });
    // The lane admits the module: the shadow fact is read, only the host
    // producer is absent. Whether that absence is admissible is an owner
    // decision (M11 review §4.4) and is deliberately not this lane's verdict.
    expect(compiled).not.toBeNull();
    expect(compiled!.ssrHostExport).toBeNull();
    expect(compiled!.code).toContain('root: "shadow-open"');
    expect(compiled!.code).not.toContain('__ssrHost');
    expect(
      exportedFunctionNames(compiled!.code).filter((name) => name.startsWith('Field__ssr')),
    ).toEqual([]);
    expect(emittedHostExports(compiled!.code)).toEqual([]);
  });

  test('a non-admitted module returns no result', () => {
    // No host site fact: the lane is inert, even for an island-shaped module.
    expect(compileGeneratedElementIfAdmitted(SHADOW_ISLAND, FILE, { site: null })).toBeNull();
    // A structural opt-out (class default) belongs to the class lane.
    const classDefault = `${SHADOW_SIDECAR}
export default class Card extends HTMLElement {}
`;
    expect(compileGeneratedElementIfAdmitted(classDefault, FILE, { site: SITE })).toBeNull();
  });

  test('the fixed-identifier collision still fails closed and returns no result', () => {
    const error = laneError(COLLIDING_ISLAND);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      GENERATED_ELEMENT_DIAGNOSTIC.NAME_COLLISION,
    ]);
    // The collision is the would-be HOST identifier: the emitted-name decision
    // is still checked against the leaf text before any wrapper (or metadata)
    // is produced.
    expect(error.diagnostics[0]!.message).toContain('"Card__ssrHost"');
  });
});
