/**
 * M08 list — Node contract for mount wire, claimability, SSR bytes and source
 * maps. The real Chromium half lives in
 * `generated-leaf.claim-list.browser.test.ts`; both are LOCAL evidence, not
 * M08 exit.
 *
 * Wire: `oe:each` + one `oe:k:<token>` per entry + `oe:/each`. Tokens are the
 * `encodeListKey` contract (`s:` UTF-8 hex, `n:` canonical finite number,
 * `b:0/1`); mount writes `u` for an unsupported runtime key, SSR throws, claim
 * rejects. Duplicate tokens are legal in every producer with mount's rule: the
 * claim pairs each wire occurrence with a distinct client occurrence and
 * requires server multiplicity <= client multiplicity. Unkeyed lists keep
 * mount's positional key (the index). Nested condition/list/composition inside
 * an entry stays mount-only.
 *
 * The claim checks the parsed DOM. An EOF truncation the HTML parser repairs
 * into the same legal comment (for example `<!--oe:/each` at EOF) is not
 * distinguishable from the producer's DOM by this check; raw-byte transport
 * completeness belongs to HTTP/build and this slice adds no root sentinel.
 */

import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';

const FILE = '/proj/src/claim-list.tsx';

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

const BOARD = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
  </section>;
}
`;

const RUNTIME = { ...compiledRuntime };

function compileWithDiagnostics(authoredSource: string) {
  const front = compileFunctionModule(authoredSource, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!, { authoredSource });
}

function compile(authoredSource: string) {
  const generated = compileWithDiagnostics(authoredSource);
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

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

describe('M08 list — generated wire, claimability and SSR bytes', () => {
  const generated = compile(BOARD);
  const loaded = instantiate(generated.module!);

  test('mount and claim use one anchor/end pair plus one key marker per entry', () => {
    const module = generated.module!;
    expect(module).toContain('function Board__mount');
    expect(module).toContain('function Board__claim');
    expect(module).toContain('emitComment(MARKERS.each)');
    expect(module).toContain('emitComment(MARKERS.eachEnd)');
    expect(module).toContain('entryKeyMarker(');
    expect(module).toContain('assertEachAnchor(');
    expect(module).toContain('assertEachEndMarker(');
    expect(module).toContain('readEntryKeyMarker(');
    expect(module).toContain('entrySeedMismatch(');
    // No per-entry end marker / branch-id-like second vocabulary.
    expect(module).not.toContain('eachEntryEnd');
    expect(module).not.toContain('oe:k:s::');
  });

  test('SSR bytes are the exact S2 Board wire', () => {
    const open = { value: true };
    const count = { value: 0 };
    const items = {
      value: [
        { id: 'a', label: 'A' },
        { id: 'c', label: 'C' },
      ],
    };
    expect(ssr(loaded, 'Board')({}, { bindings: { open, items, count } })).toBe(
      '<section><!--oe:when--><p class="on">open</p><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:k:s:63--><li><!--oe:t:0-->C<!--oe:/t:0-->: <!--oe:t:1-->0<!--oe:/t:1--></li><!--oe:/each--></ul></section>',
    );
    open.value = false;
    count.value = 2;
    expect(ssr(loaded, 'Board')({}, { bindings: { open, items, count } })).toBe(
      '<section><!--oe:when--><em class="off">closed</em><!--oe:/when--><ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0-->: <!--oe:t:1-->2<!--oe:/t:1--></li><!--oe:k:s:63--><li><!--oe:t:0-->C<!--oe:/t:0-->: <!--oe:t:1-->2<!--oe:/t:1--></li><!--oe:/each--></ul></section>',
    );
  });

  test('string/number/boolean keys encode with distinct kinds', () => {
    const source = `import { signal } from '@openelement/element';
function Strings(props) {
  const items = signal(['', 'a', 'é']);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
function Numbers(props) {
  const items = signal([0, 1, 1e21]);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
function Booleans(props) {
  const items = signal([true, false]);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
`;
    const tree = compile(source);
    const api = instantiate(tree.module!);
    const strings = { value: ['', 'a', 'é'] };
    const numbers = { value: [0, 1, 1e21] };
    const booleans = { value: [true, false] };
    const stringHtml = ssr(api, 'Strings')({}, { bindings: { items: strings } });
    for (const token of ['s:', 's:61', 's:c3a9']) {
      expect(stringHtml).toContain(`<!--oe:k:${token}-->`);
    }
    const numberHtml = ssr(api, 'Numbers')({}, { bindings: { items: numbers } });
    for (const token of ['n:0', 'n:1', 'n:1e+21']) {
      expect(numberHtml).toContain(`<!--oe:k:${token}-->`);
    }
    // 0 and -0 share the canonical token, exactly like mount's `===`.
    expect(compiledRuntime.encodeListKey(-0)).toBe(compiledRuntime.encodeListKey(0));
    const booleanHtml = ssr(api, 'Booleans')({}, { bindings: { items: booleans } });
    for (const token of ['b:1', 'b:0']) {
      expect(booleanHtml).toContain(`<!--oe:k:${token}-->`);
    }
    // Kind separation: "1" / 1 / true never share a token.
    expect(compiledRuntime.encodeListKey('1')).not.toBe(compiledRuntime.encodeListKey(1));
    expect(compiledRuntime.encodeListKey(1)).not.toBe(compiledRuntime.encodeListKey(true));
  });

  test('a mapper parameter named `index` cannot collide with generated state', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function IndexParam(props) {
  const items = signal([10, 20]);
  return <ul>{items.value.map((index) => <li key={index}>{index}</li>)}</ul>;
}
`);
    const api = instantiate(tree.module!);
    expect(ssr(api, 'IndexParam')({}, { bindings: { items: { value: [10, 20] } } })).toBe(
      '<ul><!--oe:each--><!--oe:k:n:10--><li><!--oe:t:0-->10<!--oe:/t:0--></li><!--oe:k:n:20--><li><!--oe:t:0-->20<!--oe:/t:0--></li><!--oe:/each--></ul>',
    );
  });

  test('a mapper parameter named `props` shadows component props without a props parameter', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function PropsParam() {
  const items = signal([{ id: 'a', label: 'A' }]);
  return <ul>{items.value.map((props) => <li key={props.id}>{props.label}</li>)}</ul>;
}
`);
    expect(tree.diagnostics).toEqual([]);
    expect(tree.module).toContain('function PropsParam__claim');
    expect(tree.module).toContain('function PropsParam__ssr');
    expect(tree.requiredProps).toEqual([]);
    expect(tree.requiredBindings).toEqual(['items']);
    const api = instantiate(tree.module!);
    expect(
      ssr(api, 'PropsParam')({}, { bindings: { items: { value: [{ id: 'a', label: 'A' }] } } }),
    ).toBe(
      '<ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0--></li><!--oe:/each--></ul>',
    );
  });

  test('a mapper parameter named `props` is entry-local even with a component props parameter', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function PropsParam(p) {
  const items = signal([{ id: 'a', label: 'A' }]);
  return <ul>{items.value.map((props) => <li key={props.id}>{props.label}</li>)}</ul>;
}
`);
    expect(tree.diagnostics).toEqual([]);
    expect(tree.module).toContain('function PropsParam__claim');
    // The declared component props parameter keeps the established host
    // contract, but the list/key reads are entry-local, not props deps.
    expect(tree.requiredProps).toEqual(['p']);
    expect(tree.requiredBindings).toEqual(['items']);
    expect(tree.requiresPropsChanged).toBe(false);
    expect(tree.module).not.toContain('for (const __oe_propDep of __oe_host.propDeps)');
    const api = instantiate(tree.module!);
    expect(
      ssr(api, 'PropsParam')({}, { bindings: { items: { value: [{ id: 'a', label: 'A' }] } } }),
    ).toBe(
      '<ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0--></li><!--oe:/each--></ul>',
    );
  });

  test('an unkeyed list keeps mount positional identity (index key)', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function Unkeyed(props) {
  const items = signal(['a', 'b']);
  return <ul>{items.value.map((item) => <li>{item}</li>)}</ul>;
}
`);
    expect(tree.module).toContain('function Unkeyed__claim');
    expect(tree.module).toContain('function Unkeyed__ssr');
    const api = instantiate(tree.module!);
    expect(ssr(api, 'Unkeyed')({}, { bindings: { items: { value: ['a', 'b'] } } })).toBe(
      '<ul><!--oe:each--><!--oe:k:n:0--><li><!--oe:t:0-->a<!--oe:/t:0--></li><!--oe:k:n:1--><li><!--oe:t:0-->b<!--oe:/t:0--></li><!--oe:/each--></ul>',
    );
  });

  test('unsupported keys throw before the SSR string is returned', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function Objects(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item}>{item.label}</li>)}</ul>;
}
`);
    const api = instantiate(tree.module!);
    const object = { id: 'a', label: 'A' };
    expect(
      codeOf(() => ssr(api, 'Objects')({}, { bindings: { items: { value: [object] } } })),
    ).toBe(compiledRuntime.LEAF_UNSUPPORTED_KEY);
    expect(codeOf(() => ssr(api, 'Objects')({}, { bindings: { items: { value: [null] } } }))).toBe(
      compiledRuntime.LEAF_UNSUPPORTED_KEY,
    );
    // The error is coded and the caller received no partial string.
  });

  test('duplicate keys are legal in SSR and emit one marker per occurrence', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function Dupes(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`);
    const api = instantiate(tree.module!);
    expect(
      ssr(api, 'Dupes')(
        {},
        {
          bindings: {
            items: {
              value: [
                { id: 'a', label: 'A' },
                { id: 'a', label: 'A2' },
              ],
            },
          },
        },
      ),
    ).toBe(
      '<ul><!--oe:each--><!--oe:k:s:61--><li><!--oe:t:0-->A<!--oe:/t:0--></li><!--oe:k:s:61--><li><!--oe:t:0-->A2<!--oe:/t:0--></li><!--oe:/each--></ul>',
    );
  });

  test('SSR evaluates items once and each key once per item', () => {
    let itemReads = 0;
    let keyReads = 0;
    const entries = ['a', 'b', 'c'].map((id) => ({
      get id() {
        keyReads += 1;
        return id;
      },
      label: 'x',
    }));
    const items = {
      get value() {
        itemReads += 1;
        return entries;
      },
    };
    ssr(loaded, 'Board')({}, { bindings: { open: { value: true }, count: { value: 0 }, items } });
    expect(itemReads).toBe(1);
    expect(keyReads).toBe(3);
  });

  test('source map positions cover the list items/key/entry slot', () => {
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
    const itemsAt = positionAt(BOARD, BOARD.indexOf('items.value.map'));
    const keyAt = positionAt(BOARD, BOARD.indexOf('item.id'));
    const labelAt = positionAt(BOARD, BOARD.indexOf('item.label'));
    for (const where of [itemsAt, keyAt, labelAt]) {
      expect(
        generated.placements.some(
          (placement) =>
            placement.authoredLine === where.line && placement.authoredColumn === where.column,
        ),
        JSON.stringify(where),
      ).toBe(true);
    }
  });
});

describe('M08 list — claimability boundaries stay mount-only', () => {
  test('a list under a restricted parser context has no claim/SSR and no module diagnostic', () => {
    const tree = compile(
      `import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  return <div><textarea>{items.value.map((item) => <li key={item}>{item}</li>)}</textarea></div>;
}
`,
    );
    expect(tree.diagnostics).toEqual([]);
    expect(tree.module).not.toContain('function C__claim');
    expect(tree.module).not.toContain('function C__ssr');
    // Mount-only keeps the historical shape: no list end/key wire.
    expect(tree.module).not.toContain('MARKERS.eachEnd');
    expect(tree.module).not.toContain('entryKeyMarker(');
  });

  test('insertion-site / property / nested condition in an entry keeps the component mount-only', () => {
    const insertion = compile(
      `import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  const chip = <i>c</i>;
  return <ul>{items.value.map((item) => <li>{item}{chip}</li>)}</ul>;
}
`,
    );
    expect(insertion.diagnostics).toEqual([]);
    expect(insertion.module).not.toContain('function C__claim');
    expect(insertion.module).not.toContain('function C__ssr');
    expect(insertion.module).not.toContain('MARKERS.eachEnd');

    const property = compile(
      `import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li><input value={item.value} /></li>)}</ul>;
}
`,
    );
    expect(property.diagnostics).toEqual([]);
    expect(property.module).not.toContain('function C__claim');
    expect(property.module).not.toContain('function C__ssr');

    const condition = compile(
      `import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li>{item.on ? <b>on</b> : <i>off</i>}</li>)}</ul>;
}
`,
    );
    expect(condition.diagnostics).toEqual([]);
    expect(condition.module).not.toContain('function C__claim');
    expect(condition.module).not.toContain('function C__ssr');
  });

  test('a list inside a reusable JSX value stays mount-only until it has a consumer test', () => {
    const reusable = compile(
      `import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  const rows = <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
  return <div>{rows}</div>;
}
`,
    );
    expect(reusable.diagnostics).toEqual([]);
    expect(reusable.module).not.toContain('function C__claim');
    expect(reusable.module).not.toContain('function C__ssr');
    // Mount-only keeps the historical shape: no list end/key wire.
    expect(reusable.module).not.toContain('MARKERS.eachEnd');
    expect(reusable.module).not.toContain('entryKeyMarker(');
  });

  test('a heterogeneous list key diagnostic is runtime, not a compile refusal', () => {
    const tree = compile(`import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item}>{item}</li>)}</ul>;
}
`);
    expect(tree.diagnostics).toEqual([]);
    expect(tree.module).toContain('function C__claim');
    expect(tree.module).toContain('tryEncodeListKey(');
  });
});
