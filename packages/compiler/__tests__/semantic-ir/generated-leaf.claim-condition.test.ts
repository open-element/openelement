/**
 * M08-2 condition — Node contract for mount/SSR/claim.
 *
 * This file owns the generated-code and SSR half of the condition slice. The
 * browser half (`generated-leaf.claim-condition.browser.test.ts`) owns real
 * parse → claim → update → dispose. Both are LOCAL evidence, not M08 exit.
 *
 * The wire is the existing `oe:when` anchor plus one `oe:/when` end marker. No
 * branch id is emitted: branch identity is the client template's structure,
 * static attribute seed, text values and slot ordinals. The equal-seed claim is
 * expected to write nothing; a server-empty branch insert is explicitly
 * activation work, not a 0-mutation claim. Conditions only admit branch content
 * that was already claimable (text/dynamic-text pairs and attributes).
 */

import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';

const FILE = '/proj/src/claim-condition.tsx';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

const SOURCE = `import { signal } from '@openelement/element';
function Panel(props) {
  const open = signal(true);
  const label = signal('open');
  return <section>
    {open.value ? <p class="on">{label.value}</p> : <em class="off">closed</em>}
    <span>after</span>
  </section>;
}
function Maybe(props) {
  const show = signal(false);
  return <div>{show.value ? <p>shown</p> : null}<span>after</span></div>;
}
function StaticBranch(props) {
  return <div>{props.ok ? <i>a</i> : <b>b</b>}</div>;
}
`;

const RUNTIME = { ...compiledRuntime };

function compileWithDiagnostics(authoredSource: string) {
  const front = compileFunctionModule(authoredSource, FILE, {
    importClassifier: CLASSIFIER,
  });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!, { authoredSource });
}

function compile(authoredSource: string) {
  const front = compileFunctionModule(authoredSource, FILE, {
    importClassifier: CLASSIFIER,
  });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!, { authoredSource });
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return generated;
}

interface Host {
  readonly bindings: Record<string, unknown>;
}

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(/^export function ([\w$]+)\(/gm)].map((match) => match[1]!);
  const importMatch = module.match(/^import \{([^}]+)\} from [^;]+;$/m);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(/^import \{[^}]+\} from [^;]+;$/m, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

function ssr(loaded: Record<string, unknown>, name: string) {
  const value = loaded[`${name}__ssr`];
  expect(typeof value, `${name}__ssr`).toBe('function');
  return value as (props: Record<string, unknown>, host: Host) => string;
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

describe('M08-2 condition — generated wire, SSR bytes and source map', () => {
  const generated = compile(SOURCE);
  const loaded = instantiate(generated.module!);

  test('mount emits the existing anchor plus one end marker; no branch id', () => {
    const module = generated.module!;
    expect(module).toContain('function Panel__mount');
    expect(module).toContain('emitComment(MARKERS.when)');
    expect(module).toContain('emitComment(MARKERS.whenEnd)');
    expect(module).not.toContain('oe:when:');
    expect(module).not.toContain('whenBranchId');
    // The claim consumes the pair with one-position asserts, not a scan.
    expect(module).toContain('function Panel__claim');
    expect(module).toContain('assertWhenAnchor(');
    expect(module).toContain('assertWhenEndMarker(');
    expect(module).toContain('isWhenEndMarker(');
    // Both branches get a read-only claim chunk and a mount-style create
    // builder; the empty maybe branch still needs the create builder.
    expect(module).toMatch(/function __oe_whenThenClaim/);
    expect(module).toMatch(/function __oe_whenElseClaim/);
    expect(module).toMatch(/function __oe_whenThen\d/);
    expect(module).toMatch(/function __oe_whenElse\d/);
    // No list wire leaked into the condition slice.
    expect(module).not.toContain('entryKeyMarker');
    expect(module).not.toContain('MARKERS.eachEnd');
  });

  test('SSR and mount share the marker pair; empty branch is two adjacent comments', () => {
    const open = { value: true };
    const label = { value: 'open' };
    expect(ssr(loaded, 'Panel')({}, { bindings: { open, label } })).toBe(
      '<section><!--oe:when--><p class="on"><!--oe:t:0-->open<!--oe:/t:0--></p><!--oe:/when--><span>after</span></section>',
    );
    open.value = false;
    expect(ssr(loaded, 'Panel')({}, { bindings: { open, label } })).toBe(
      '<section><!--oe:when--><em class="off">closed</em><!--oe:/when--><span>after</span></section>',
    );
    const show = { value: false };
    expect(ssr(loaded, 'Maybe')({}, { bindings: { show } })).toBe(
      '<div><!--oe:when--><!--oe:/when--><span>after</span></div>',
    );
    show.value = true;
    expect(ssr(loaded, 'Maybe')({}, { bindings: { show } })).toBe(
      '<div><!--oe:when--><p>shown</p><!--oe:/when--><span>after</span></div>',
    );
  });

  test('a condition with only static branches still gets the request-time producer', () => {
    expect(generated.module).toContain('export function StaticBranch__ssr(__oe_props, __oe_host)');
    expect(ssr(loaded, 'StaticBranch')({ ok: true }, { bindings: {} })).toBe(
      '<div><!--oe:when--><i>a</i><!--oe:/when--></div>',
    );
    expect(ssr(loaded, 'StaticBranch')({ ok: false }, { bindings: {} })).toBe(
      '<div><!--oe:when--><b>b</b><!--oe:/when--></div>',
    );
  });

  test('the condition test is evaluated once per SSR call', () => {
    let reads = 0;
    const open = {
      get value() {
        reads += 1;
        return true;
      },
    };
    const label = { value: 'x' };
    ssr(loaded, 'Panel')({}, { bindings: { open, label } });
    expect(reads).toBe(1);
    expect(ssr(loaded, 'Panel')({}, { bindings: { open, label } })).toContain('<p class="on">');
    expect(reads).toBe(2);
  });

  test('source map positions cover the condition test and both branch slots', () => {
    const map = new TraceMap(
      generated.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    for (const placement of generated.placements) {
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
    }
    const testAt = positionAt(SOURCE, SOURCE.indexOf('open.value ?'));
    const thenSlotAt = positionAt(SOURCE, SOURCE.indexOf('label.value'));
    const testExpected = generated.placements.some(
      (placement) =>
        placement.authoredLine === testAt.line && placement.authoredColumn === testAt.column,
    );
    const slotExpected = generated.placements.some(
      (placement) =>
        placement.authoredLine === thenSlotAt.line &&
        placement.authoredColumn === thenSlotAt.column,
    );
    expect(testExpected, 'condition test placement').toBe(true);
    expect(slotExpected, 'then slot placement').toBe(true);
  });

  test('a local snapshot is declared before the non-shared claim walk (B1)', () => {
    const local = compile(
      'function Local(props) { const visible = props.visible; return <div>{visible ? <p>on</p> : <em>off</em>}</div>; }\n',
    );
    const module = local.module!;
    const claimStart = module.indexOf('function Local__claim');
    const localAt = module.indexOf('const visible = (props . visible);', claimStart);
    const testAt = module.indexOf('const __oe_whenTest', claimStart);
    expect(claimStart).toBeGreaterThanOrEqual(0);
    expect(localAt).toBeGreaterThan(claimStart);
    expect(testAt).toBeGreaterThan(localAt);
    // One evaluation in the claim: the same declaration is not emitted twice.
    expect(
      module
        .slice(claimStart, module.indexOf('export function Local__ssr'))
        .match(/const visible = \(props \. visible\);/g),
    ).toHaveLength(1);
  });
});

describe('M08-2 condition — claimability boundaries (mount stays available)', () => {
  test('a condition under a restricted parser context is mount-only and not diagnosed', () => {
    const tree = compile(
      'function C(props) { return <div><textarea>{props.ok ? <span>x</span> : null}</textarea></div>; }\n',
    );
    expect(tree.diagnostics).toEqual([]);
    expect(tree.module).not.toBeNull();
    expect(tree.module).not.toContain('function C__claim');
    expect(tree.module).not.toContain('function C__ssr');
    // Mount still carries the anchor/end pair; there is no claim to consume it.
    expect(tree.module).toContain('emitComment(MARKERS.when)');
    expect(tree.module).toContain('emitComment(MARKERS.whenEnd)');
    expect(tree.module).not.toContain('assertWhenAnchor(');
  });

  test('a restricted parser context inside a claimable branch is diagnosed, not silently claimed', () => {
    const denied = compileWithDiagnostics(
      'function C(props) { return <div>{props.ok ? <textarea>{props.value}</textarea> : null}</div>; }\n',
    );
    expect(denied.module).toBeNull();
    expect(denied.diagnostics.map((item) => item.code)).toContain(
      'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
  });

  test('nested conditions, lists and composition in a branch stay mount-only', () => {
    const nested = compile(
      'function C(props) { return <div>{props.ok ? <section>{props.inner ? <b>x</b> : <i>y</i>}</section> : null}</div>; }\n',
    );
    expect(nested.diagnostics).toEqual([]);
    expect(nested.module).not.toBeNull();
    expect(nested.module).not.toContain('function C__claim');
    expect(nested.module).not.toContain('function C__ssr');

    const list = compile(
      'import { signal } from "@openelement/element";\n' +
        'function C(props) { const items = signal([]); return <div>{props.ok ? <ul>{items.value.map((item) => <li>{item}</li>)}</ul> : null}</div>; }\n',
    );
    expect(list.diagnostics).toEqual([]);
    expect(list.module).not.toBeNull();
    expect(list.module).not.toContain('function C__claim');
    expect(list.module).not.toContain('function C__ssr');

    const child = compile(
      'function Child(props) { return <b>child</b>; }\n' +
        'function C(props) { return <div>{props.ok ? <Child /> : null}</div>; }\n',
    );
    expect(child.diagnostics).toEqual([]);
    expect(child.module).not.toBeNull();
    expect(child.module).not.toContain('function C__claim');
    expect(child.module).not.toContain('function C__ssr');
    // The child itself remains mountable/claimable; only the branch claim is
    // outside this slice.
    expect(child.module).toContain('function Child__mount');
  });

  test('a property channel in a branch keeps the condition mount-only', () => {
    const property = compile(
      'function C(props) { return <div>{props.ok ? <input value={props.value} /> : null}</div>; }\n',
    );
    expect(property.diagnostics).toEqual([]);
    expect(property.module).not.toBeNull();
    expect(property.module).not.toContain('function C__claim');
    expect(property.module).not.toContain('function C__ssr');
  });

  test('a void element in a branch keeps claim, but the existing SSR boundary omits __ssr', () => {
    const voided = compile('function C(props) { return <div>{props.ok ? <br /> : null}</div>; }\n');
    expect(voided.diagnostics).toEqual([]);
    expect(voided.module).not.toBeNull();
    // Claim can adopt the element; the M08-1a SSR producer still refuses void
    // elements. This is the recorded asymmetry, not a new rejection.
    expect(voided.module).toContain('function C__claim');
    expect(voided.module).not.toContain('function C__ssr');
  });
});
