/**
 * T3 / 16b-LC-1 — root setup retention compiler contract (LOCAL, Node).
 *
 * The compiler half of the retained-instance seam, without a browser:
 *
 * - the ROOT component's local setup snapshots move into one module-local
 *   `__oe_rootInstance(owner, host)` factory whose name is reported on the
 *   leaf result (`rootInstanceFactory`) from the SAME emission decision that
 *   wrote the declaration — never re-derived by scanning the emitted text;
 * - `<Root>__mount` and `<Root>__claim` alias the retained record through an
 *   own-property check instead of re-evaluating the initializers, and the
 *   descriptor's `createInstance` row is emitted exactly when that factory
 *   exists (`createBindings` stays never emitted);
 * - the compiler-private root marker is ROOT-ONLY for the retained-settings
 *   factory; a DIRECT hostless child becomes a depth-1 LEAF instance body
 *   (`16b-LC retained-child`): it gets its own `<Child>__setup` factory and aliases the
 *   record from its reference site's host literal, emitting no ledger text, and
 *   a marker naming the child makes the root-target guard emit the whole module
 *   as legacy bytes;
 * - without the marker (hostless leaf, direct leaf tests) every byte path is
 *   unchanged: no factory, no alias, `rootInstanceFactory` null, and the
 *   pre-change two-mount/claim shape still holds;
 * - SSR keeps its own per-request setup evaluation: the initializer appears
 *   once in the factory and once in `<Root>__ssr`, never in mount/claim, and
 *   `<Root>__ssr` is byte-identical with and without the marker;
 * - the source map still decodes: every placement (including the ones that
 *   moved into the factory chunk) anchors on the generated line that carries
 *   its lowered text and decodes to its authored expression start through the
 *   pinned `@jridgewell/trace-mapping` consumer;
 * - a root that reads a host binding is still refused by the unchanged
 *   `UNBOUND_BINDING` gate (the split adds no binding channel).
 *
 * LOCAL Node evidence. Not M09 exit, not the M13 matrix, no nested retention
 * claim, no new public API.
 */

import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  compileFunctionModule,
  type FunctionModelModule,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';

const FILE = '/proj/src/islands/seed-card.tsx';
const SITE: GeneratedElementSite = { tag: 'x-seed-card' };
const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "export const openElement = defineIslandConfig({ root: 'light', properties: { seed: { default: 0 }, label: { default: 'null' } } });\n";

/** Rows 1/2/4/5: one admitted root with two local setup snapshots. */
const ROOT_SOURCE =
  SIDECAR +
  'function SeedCard(props: { seed: number; label: string }) {\n' +
  '  const snapshot = props.seed;\n' +
  '  const parsed = JSON.parse(props.label);\n' +
  '  return <span className="seed">{snapshot}</span>;\n' +
  '}\n' +
  'export default SeedCard;\n';

/** Root with NO local setup snapshot: the marker must not change its bytes. */
const PLAIN_SOURCE =
  SIDECAR +
  'function PlainCard(props: { seed: number; label: string }) {\n' +
  '  return <p className="plain">{props.seed}</p>;\n' +
  '}\n' +
  'export default PlainCard;\n';

/** Row 3: a root with setup plus a second component with setup. */
const TWO_COMPONENT_SOURCE =
  SIDECAR +
  'function Child(props: { seed: number }) {\n' +
  '  const childSnapshot = props.seed;\n' +
  '  return <em className="child">{childSnapshot}</em>;\n' +
  '}\n' +
  'function SeedHost(props: { seed: number; label: string }) {\n' +
  '  const rootSnapshot = props.seed;\n' +
  '  return <span className="root">{rootSnapshot}<Child seed={props.seed} /></span>;\n' +
  '}\n' +
  'export default SeedHost;\n';

/**
 * Row 6: an admitted root whose SETUP reads a host binding stays refused and
 * keeps the pre-change emitted text (the instance record cannot carry a
 * binding, and T3 adds no binding channel).
 */
const SIGNAL_SOURCE =
  "import { signal } from '@openelement/element';\n" +
  SIDECAR +
  'function SignalCard(props: { seed: number; label: string }) {\n' +
  '  const count = signal(0);\n' +
  '  const snapshot = count.value;\n' +
  '  return <p>{snapshot}</p>;\n' +
  '}\n' +
  'export default SignalCard;\n';

function frontModule(source: string): FunctionModelModule {
  const front = compileFunctionModule(source, FILE, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  return front.module!;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

interface FunctionRange {
  /** 0-based inclusive start line index into the module. */
  readonly start: number;
  /** 0-based inclusive end line index into the module. */
  readonly end: number;
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

/** Remove quoted literals so braces inside strings cannot move a range end. */
function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Locate one emitted function by brace slicing (test-side, no generator help). */
function functionRange(module: string, name: string): FunctionRange {
  const lines = module.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = FUNCTION_HEADER.exec(lines[index]!);
    if (match === null || match[1] !== name) continue;
    let depth = 0;
    let opened = false;
    for (let cursor = index; cursor < lines.length; cursor++) {
      for (const character of stripQuoted(lines[cursor]!)) {
        if (character === '{') {
          depth += 1;
          opened = true;
        } else if (character === '}') {
          depth -= 1;
          if (opened && depth === 0) return { start: index, end: cursor };
        }
      }
    }
    throw new Error(`unterminated function '${name}'`);
  }
  throw new Error(`function '${name}' not found in the emitted module`);
}

function functionText(module: string, name: string): string {
  const range = functionRange(module, name);
  return module
    .split('\n')
    .slice(range.start, range.end + 1)
    .join('\n');
}

function codes(error: CompiledElementError): string[] {
  return error.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('T3 root generated setup retention (Node)', () => {
  test('R1 the root emits one factory and mount/claim alias the retained record', () => {
    const module = frontModule(ROOT_SOURCE);
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'SeedCard',
      authoredSource: ROOT_SOURCE,
    });
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.rootInstanceFactory).toBe('__oe_rootInstance');
    const leaf = emitted.leaf!;
    expect(occurrences(leaf, 'function __oe_rootInstance(')).toBe(1);
    expect(leaf).not.toContain('export function __oe_rootInstance(');

    const factory = functionText(leaf, '__oe_rootInstance');
    const mount = functionText(leaf, 'SeedCard__mount');
    const claim = functionText(leaf, 'SeedCard__claim');
    // The factory holds exactly the setup work: the live props read, the
    // lowered initializers in authored order, and the returned record.
    expect(factory).toContain('__oe_host.props');
    expect(factory).toContain('const snapshot = (');
    expect(factory).toContain('const parsed = (');
    expect(factory).toContain('return { snapshot, parsed };');
    // No DOM, no projection/recipe work and no subscription in the factory.
    expect(factory).not.toContain('document');
    expect(factory).not.toContain('createRecipe');
    expect(factory).not.toContain('insertRecipe');
    expect(factory).not.toContain('bindSignalWrites');
    expect(factory).not.toContain('addRangeCleanup');
    // Both claim branches and the mount alias the record by own-property
    // presence; neither re-evaluates the initializer.
    for (const chunk of [mount, claim]) {
      expect(chunk).toContain('const __oe_setup = __oe_host.bindings ?? {};');
      expect(chunk).toContain('Object.hasOwn(__oe_setup, name)');
      expect(chunk).toContain('const snapshot = __oe_requireRootSetup("snapshot");');
      expect(chunk).toContain('const parsed = __oe_requireRootSetup("parsed");');
      expect(chunk).not.toContain('(props . seed)');
      expect(chunk).not.toContain('JSON . parse');
    }
    // Descriptor: exactly the one compiler-private createInstance row.
    expect(occurrences(emitted.tail!, 'createInstance: __oe_rootInstance,')).toBe(1);
    expect(emitted.tail).not.toContain('createBindings');
    // Append-only relative to the selected leaf.
    expect(emitted.module!.startsWith(leaf)).toBe(true);
    expect(emitted.module!.length).toBe(leaf.length + emitted.tail!.length);
  });

  test('R2 without the root marker every byte path is unchanged', () => {
    const module = frontModule(ROOT_SOURCE);
    const noOptions = generateLeafModule(module);
    expect(noOptions.rootInstanceFactory).toBeNull();
    expect(noOptions.module).not.toBeNull();
    // No factory and no alias prologue anywhere in the hostless artifact.
    expect(noOptions.module).not.toContain('__oe_rootInstance');
    expect(noOptions.module).not.toContain('__oe_setup');
    expect(noOptions.module).not.toContain('__oe_requireRootSetup');
    expect(generateLeafModule(module, {}).module).toBe(noOptions.module);
    // A marker naming a component that is not the module's component is inert.
    expect(generateLeafModule(module, { rootInstance: 'Other' }).module).toBe(noOptions.module);
    // Pre-change shape pinned: mount + claim + SSR each evaluate the snapshot
    // initializer, and the unread `parsed` local is evaluated by mount + claim
    // only (SSR prunes the client-only local).
    expect(occurrences(noOptions.module!, '(props . seed)')).toBe(3);
    expect(occurrences(noOptions.module!, 'JSON . parse')).toBe(2);
    // Hostless element emission is byte-identical to the hostless leaf.
    const hostless = generateElementModule(module, null);
    expect(hostless.module).toBe(noOptions.module);
    expect(hostless.tail).toBeNull();
    expect(hostless.rootInstanceFactory).toBeNull();
  });

  test('R2b a site root with no setup snapshot keeps the M09-1a descriptor bytes', () => {
    const module = frontModule(PLAIN_SOURCE);
    const emitted = generateElementModule(module, SITE, { rootComponent: 'PlainCard' });
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.rootInstanceFactory).toBeNull();
    expect(emitted.leaf).not.toContain('__oe_rootInstance');
    expect(emitted.tail).not.toContain('createInstance');
    expect(emitted.tail).toContain('createRecipe: createPlainCardRecipe,');
    expect(emitted.module!.startsWith(emitted.leaf!)).toBe(true);
  });

  test('R3 the marker is root-only for the factory; a direct child is a depth-1 leaf body', () => {
    const module = frontModule(TWO_COMPONENT_SOURCE);
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'SeedHost',
      authoredSource: TWO_COMPONENT_SOURCE,
    });
    expect(emitted.diagnostics).toEqual([]);
    expect(emitted.rootInstanceFactory).toBe('__oe_rootInstance');
    const leaf = emitted.leaf!;
    expect(occurrences(leaf, 'function __oe_rootInstance(')).toBe(1);
    const factory = functionText(leaf, '__oe_rootInstance');
    expect(factory).toContain('return { rootSnapshot };');
    expect(factory).not.toContain('childSnapshot');

    // 16b-LC retained-child DEPTH-1: the direct hostless child is a LEAF instance body. Its
    // setup moves into one module-local `<Child>__setup` factory, and its own
    // mount/claim alias the retained record from the child host literal's
    // `setup` property instead of re-evaluating the initializer. The leaf body
    // emits NO ledger text of its own.
    expect(occurrences(leaf, 'function Child__setup(')).toBe(1);
    const childSetup = functionText(leaf, 'Child__setup');
    expect(childSetup).toContain('return { childSnapshot };');
    expect(childSetup).toContain('const childSnapshot = (props . seed);');
    const childMount = functionText(leaf, 'Child__mount');
    const childClaim = functionText(leaf, 'Child__claim');
    for (const chunk of [childMount, childClaim]) {
      expect(chunk).toContain('const childSnapshot = __oe_requireRootSetup("childSnapshot");');
      expect(chunk).not.toContain('const childSnapshot = (');
      expect(chunk).not.toContain('retainChildInstance(');
      expect(chunk).not.toContain('beginInstancePass(');
      expect(chunk).not.toContain('releaseChildInstance(');
    }

    // The ROOT retaining body brackets exactly one instance pass (mount + the
    // shared-cursor claim), retains the child once per body with the same
    // authored-span site key, and aliases its own retained setup record.
    const rootMount = functionText(leaf, 'SeedHost__mount');
    const rootClaim = functionText(leaf, 'SeedHost__claim');
    for (const chunk of [rootMount, rootClaim]) {
      expect(occurrences(chunk, 'beginInstancePass(__oe_host.instance);')).toBe(1);
      expect(occurrences(chunk, 'endInstancePass(__oe_host.instance);')).toBe(1);
      expect(occurrences(chunk, 'retainChildInstance(')).toBe(1);
      expect(chunk).toContain('const rootSnapshot = __oe_requireRootSetup("rootSnapshot");');
      expect(chunk).not.toContain('const rootSnapshot = (');
    }
    // Mount and claim carry the SAME span key and one retain each.
    const keys = [...leaf.matchAll(/retainChildInstance\(__oe_host\.instance, ("[^"]+")/g)].map(
      (match) => match[1],
    );
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(1);
    // A leaf body's factory call passes the per-read props record; the record
    // is reused, never re-evaluated (`<Child>__setup(__oe_setupScopeN, ...)`).
    expect(rootMount).toContain('Child__setup(__oe_setupScope');
    expect(rootClaim).toContain('Child__setup(__oe_setupScope');
    // Only one descriptor row, for the root.
    expect(occurrences(emitted.tail!, 'createInstance: __oe_rootInstance,')).toBe(1);

    // A marker naming the CHILD makes the module reference the module root from
    // a non-root body, so the B3b conservative whole-module guard applies: the
    // module is emitted legacy (today's bytes/semantics, no nested retention)
    // while the root setup factory still exists for the marked component.
    const childMarked = generateLeafModule(module, { rootInstance: 'Child' });
    expect(childMarked.diagnostics).toEqual([]);
    expect(childMarked.rootInstanceFactory).toBe('__oe_rootInstance');
    const childModule = childMarked.module!;
    expect(occurrences(childModule, 'function __oe_rootInstance(')).toBe(1);
    expect(functionText(childModule, '__oe_rootInstance')).toContain('return { childSnapshot };');
    expect(childModule).not.toContain('retainChildInstance(');
    expect(childModule).not.toContain('beginInstancePass(');
    expect(childModule).not.toContain('releaseChildInstance(');
    // No nested-retention text anywhere: the module is legacy for the LC-2
    // feature. Child is the marked ROOT, so its own setup is the T3 retained
    // root setup (aliased from `host.bindings`); the SeedHost ancestor's setup
    // keeps the pre-change inline text.
    expect(functionText(childModule, 'SeedHost__mount')).toContain(
      'const rootSnapshot = (props . seed);',
    );
    expect(functionText(childModule, 'Child__mount')).toContain(
      'const childSnapshot = __oe_requireRootSetup("childSnapshot");',
    );
    expect(occurrences(childModule, 'Child__setup(')).toBe(0);
  });

  test('R4 SSR keeps its own setup evaluation and its bytes', () => {
    const module = frontModule(ROOT_SOURCE);
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'SeedCard',
      authoredSource: ROOT_SOURCE,
    });
    const leaf = emitted.leaf!;
    const factory = functionText(leaf, '__oe_rootInstance');
    const ssr = functionText(leaf, 'SeedCard__ssr');
    const mount = functionText(leaf, 'SeedCard__mount');
    const claim = functionText(leaf, 'SeedCard__claim');
    // One client setup evaluation (factory) + one server evaluation (SSR).
    expect(occurrences(factory, '(props . seed)')).toBe(1);
    expect(occurrences(ssr, '(props . seed)')).toBe(1);
    expect(occurrences(mount, '(props . seed)')).toBe(0);
    expect(occurrences(claim, '(props . seed)')).toBe(0);
    expect(occurrences(leaf, '(props . seed)')).toBe(2);
    // The SSR-pruning rule is unchanged: the client-only `parsed` local runs in
    // the factory but never in the server producer.
    expect(occurrences(factory, 'JSON . parse')).toBe(1);
    expect(occurrences(ssr, 'JSON . parse')).toBe(0);
    // No alias/factory marker may leak into the server producer.
    for (const marker of ['__oe_rootInstance', '__oe_requireRootSetup', '__oe_setup']) {
      expect(ssr).not.toContain(marker);
    }
    // Without the marker the extracted SSR function is byte-identical.
    const without = generateLeafModule(module, { authoredSource: ROOT_SOURCE });
    expect(ssr).toBe(functionText(without.module!, 'SeedCard__ssr'));
  });

  test('R5 source map decodes setup, mount, claim and SSR placements', () => {
    const module = frontModule(ROOT_SOURCE);
    const emitted = generateElementModule(module, SITE, {
      rootComponent: 'SeedCard',
      authoredSource: ROOT_SOURCE,
    });
    expect(emitted.sourceMap).not.toBeNull();
    const map = new TraceMap(
      emitted.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    const moduleLines = emitted.module!.split('\n');
    const records = new Map(
      module.expressions.expressions.map((record) => [record.id, record] as const),
    );
    const factoryRange = functionRange(emitted.module!, '__oe_rootInstance');
    let setupPlacements = 0;
    for (const placement of emitted.placements) {
      const record = records.get(placement.exprId);
      expect(record, placement.exprId).toBeDefined();
      // The placement line physically carries that lowered expression ...
      const firstLoweredLine = record!.lowered.split('\n')[0]!.trim();
      expect(moduleLines[placement.generatedLine - 1], placement.exprId).toContain(
        firstLoweredLine,
      );
      // ... and the source map decodes it to the authored expression start.
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.source, placement.exprId).toBe(FILE);
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
      if (
        placement.generatedLine - 1 >= factoryRange.start &&
        placement.generatedLine - 1 <= factoryRange.end
      ) {
        setupPlacements += 1;
      }
    }
    // Both setup initializers really moved into the factory chunk and stayed
    // mapped (the line offset is the factory prologue's actual line count).
    expect(setupPlacements).toBeGreaterThanOrEqual(2);
  });

  test('R6 a root reading a host binding still fails closed at the lane gate', () => {
    expect(() => compileGeneratedElementIfAdmitted(SIGNAL_SOURCE, FILE, { site: SITE })).toThrow(
      CompiledElementError,
    );
    try {
      compileGeneratedElementIfAdmitted(SIGNAL_SOURCE, FILE, { site: SITE });
    } catch (error) {
      expect(error).toBeInstanceOf(CompiledElementError);
      expect(codes(error as CompiledElementError)).toContain(
        GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING,
      );
    }
    // The split adds no binding channel: a setup that reads a host binding
    // cannot be served by the instance record (`instanceHostFor` carries props
    // only), so the emitter keeps the pre-change text and reports no factory
    // instead of writing a factory that references an undeclared name. The
    // lane gate above remains the refusal authority.
    const module = frontModule(SIGNAL_SOURCE);
    const emitted = generateElementModule(module, SITE, { rootComponent: 'SignalCard' });
    expect(emitted.rootInstanceFactory).toBeNull();
    expect(emitted.tail).not.toContain('createInstance');
    expect(emitted.module!.startsWith(generateLeafModule(module).module!)).toBe(true);
  });
});
