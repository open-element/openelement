import { assertEquals, assertNotStrictEquals, assertThrows } from '@std/assert';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';
import { validatePartProgram as validateCompilerProgram } from '../src/internal/compiler/semantic-core/program.ts';
import { validatePartProgram as validateRuntimeProgram } from '../src/internal/compiled/program.ts';
import { normalizePartProgram } from '../src/internal/compiled/runtime-program.ts';

const FIXTURE = new URL('../__fixtures__/compiled-element-v1/counter.tsx', import.meta.url);
const GOLDEN = new URL(
  '../__fixtures__/compiled-element-v1/expected-program.json',
  import.meta.url,
);
type Path = readonly (string | number)[];

function setPath(root: unknown, path: Path, value: unknown): void {
  let current = root as Record<PropertyKey, unknown>;
  for (const segment of path.slice(0, -1)) {
    current = current[segment] as Record<PropertyKey, unknown>;
  }
  current[path.at(-1)!] = value;
}

interface Fault {
  label: string;
  path: Path;
  value: unknown;
}

const faults: Fault[] = [
  { label: 'version', path: ['version'], value: 2 },
  { label: 'tag', path: ['tag'], value: 'invalid' },
  { label: 'root record', path: ['root'], value: null },
  { label: 'root id', path: ['root', 'id'], value: 'other' },
  { label: 'root kind', path: ['root', 'kind'], value: 'sideways' },
  { label: 'root nodes type', path: ['root', 'nodes'], value: 'e0' },
  { label: 'root nodes identity', path: ['root', 'nodes', 0], value: 'e99' },
  { label: 'template type', path: ['template'], value: null },
  { label: 'template node record', path: ['template', 0], value: null },
  { label: 'element id', path: ['template', 0, 'id'], value: 'root' },
  { label: 'element tag', path: ['template', 0, 'tag'], value: 'Invalid' },
  { label: 'attributes type', path: ['template', 0, 'attrs'], value: null },
  { label: 'attribute tuple', path: ['template', 0, 'attrs', 0], value: ['class'] },
  { label: 'attribute name', path: ['template', 0, 'attrs', 0, 0], value: 'onclick' },
  { label: 'children type', path: ['template', 0, 'children'], value: null },
  { label: 'text value', path: ['template', 0, 'children', 0, 'children', 0, 'value'], value: 1 },
  { label: 'anchor id', path: ['template', 0, 'children', 0, 'children', 1, 'id'], value: 'p9' },
  {
    label: 'anchor index',
    path: ['template', 0, 'children', 0, 'children', 1, 'index'],
    value: -1,
  },
  {
    label: 'void children',
    path: ['template', 0, 'children', 1, 'children'],
    value: [{ k: 'text', value: 'x' }],
  },
  { label: 'parts type', path: ['parts'], value: null },
  { label: 'part record', path: ['parts', 0], value: null },
  { label: 'part index', path: ['parts', 0, 'index'], value: 9 },
  { label: 'part location', path: ['parts', 0, 'location'], value: null },
  { label: 'part location id', path: ['parts', 0, 'location', 'id'], value: 'p9' },
  { label: 'text signal', path: ['parts', 0, 'signal'], value: 'not valid' },
  { label: 'text location kind', path: ['parts', 0, 'location', 'kind'], value: 'sink' },
  { label: 'property name', path: ['parts', 1, 'name'], value: 'onclick' },
  { label: 'property path', path: ['parts', 1, 'path'], value: [99] },
  { label: 'property location node', path: ['parts', 1, 'location', 'node'], value: 'e0' },
  { label: 'event handler', path: ['parts', 2, 'handler'], value: 'not valid' },
  { label: 'event name', path: ['parts', 2, 'event'], value: 'Click!' },
  { label: 'event action', path: ['parts', 2, 'action'], value: { kind: 'future' } },
  { label: 'runtime-only event options', path: ['parts', 2, 'options'], value: { once: true } },
  { label: 'runtime-only event signal', path: ['parts', 2, 'signal'], value: 'handlerSignal' },
  { label: 'event location kind', path: ['parts', 2, 'location', 'kind'], value: 'anchor' },
  {
    label: 'when threshold',
    path: ['parts', 3, 'test', 'value'],
    value: Number.POSITIVE_INFINITY,
  },
  { label: 'when test signal', path: ['parts', 3, 'test', 'signal'], value: 'label' },
  { label: 'duplicate when threshold', path: ['parts', 3, 'gt'], value: 0 },
  { label: 'when branch type', path: ['parts', 3, 'on'], value: null },
  { label: 'each signal', path: ['parts', 4, 'signal'], value: 'not valid' },
  { label: 'each item type', path: ['parts', 4, 'item'], value: null },
  { label: 'each key field', path: ['parts', 4, 'key'], value: 'not valid' },
  { label: 'runtime-only keyed selector', path: ['parts', 4, 'keyed'], value: false },
  { label: 'runtime-only child Region', path: ['parts', 4, 'k'], value: 'child' },
  { label: 'each anchor path', path: ['parts', 4, 'location', 'path'], value: [0] },
  { label: 'regions type', path: ['regions'], value: null },
  { label: 'region id', path: ['regions', 0, 'id'], value: 'r9' },
  { label: 'region index', path: ['regions', 0, 'index'], value: 4 },
  { label: 'region kind', path: ['regions', 0, 'kind'], value: 'each' },
  { label: 'region anchor', path: ['regions', 0, 'anchor'], value: 'p9' },
  { label: 'region end', path: ['regions', 0, 'end'], value: 'p9:end' },
  { label: 'region source', path: ['regions', 0, 'source'], value: 'p0' },
  { label: 'unknown region field', path: ['regions', 0, 'future'], value: true },
  { label: 'dependencies type', path: ['dependencies'], value: null },
  { label: 'dependency record', path: ['dependencies', 0], value: null },
  { label: 'dependency signal', path: ['dependencies', 0, 'signal'], value: 'not valid' },
  { label: 'dependency owner record', path: ['dependencies', 0, 'owner'], value: null },
  { label: 'dependency owner kind', path: ['dependencies', 0, 'owner', 'kind'], value: 'future' },
  { label: 'dependency owner index', path: ['dependencies', 0, 'owner', 'index'], value: -1 },
  { label: 'dependency owner target', path: ['dependencies', 0, 'owner', 'index'], value: 2 },
  { label: 'dependency location', path: ['dependencies', 0, 'location'], value: 'p9' },
  { label: 'unknown dependency field', path: ['dependencies', 0, 'future'], value: true },
  {
    label: 'unknown dependency owner field',
    path: ['dependencies', 0, 'owner', 'future'],
    value: true,
  },
  { label: 'locations type', path: ['locations'], value: null },
  { label: 'location record', path: ['locations', 0], value: null },
  { label: 'location duplicate id', path: ['locations', 1, 'id'], value: 'e0' },
  { label: 'location path', path: ['locations', 0, 'path'], value: [-1] },
  { label: 'element location tag', path: ['locations', 0, 'tag'], value: 'span' },
  { label: 'anchor location part', path: ['locations', 2, 'part'], value: 9 },
  { label: 'anchor location id', path: ['locations', 2, 'id'], value: 'p9' },
  { label: 'sink location part', path: ['locations', 4, 'part'], value: 0 },
  { label: 'sink location node', path: ['locations', 4, 'node'], value: 'e0' },
  { label: 'location kind', path: ['locations', 0, 'kind'], value: 'future' },
  { label: 'unknown element location field', path: ['locations', 0, 'future'], value: true },
  { label: 'unknown anchor location field', path: ['locations', 2, 'future'], value: true },
  { label: 'unknown sink location field', path: ['locations', 4, 'future'], value: true },
  { label: 'source map type', path: ['sourceMap'], value: null },
  { label: 'source map version', path: ['sourceMap', 'version'], value: 2 },
  { label: 'source map file', path: ['sourceMap', 'file'], value: '/other.tsx' },
  { label: 'source records type', path: ['sourceMap', 'records'], value: null },
  { label: 'unknown source map field', path: ['sourceMap', 'future'], value: true },
  { label: 'source record', path: ['sourceMap', 'records', 0], value: null },
  { label: 'source record duplicate', path: ['sourceMap', 'records', 1, 'id'], value: 'root' },
  { label: 'source record kind', path: ['sourceMap', 'records', 0, 'kind'], value: 'future' },
  {
    label: 'unknown source record field',
    path: ['sourceMap', 'records', 0, 'future'],
    value: true,
  },
  { label: 'source range', path: ['sourceMap', 'records', 0, 'source'], value: null },
  {
    label: 'unknown source range field',
    path: ['sourceMap', 'records', 0, 'source', 'future'],
    value: true,
  },
  {
    label: 'unknown source position field',
    path: ['sourceMap', 'records', 0, 'source', 'start', 'future'],
    value: true,
  },
  {
    label: 'source start offset',
    path: ['sourceMap', 'records', 0, 'source', 'start', 'offset'],
    value: -1,
  },
  {
    label: 'source start line',
    path: ['sourceMap', 'records', 0, 'source', 'start', 'line'],
    value: 0,
  },
  {
    label: 'source start column',
    path: ['sourceMap', 'records', 0, 'source', 'start', 'column'],
    value: 0,
  },
  {
    label: 'source end before start',
    path: ['sourceMap', 'records', 0, 'source', 'end', 'offset'],
    value: 0,
  },
  { label: 'metadata type', path: ['metadata'], value: null },
  { label: 'unknown metadata field', path: ['metadata', 'future'], value: true },
  { label: 'metadata tag', path: ['metadata', 'tag'], value: 'other-element' },
  { label: 'metadata class', path: ['metadata', 'className'], value: 'not valid' },
  { label: 'metadata properties type', path: ['metadata', 'properties'], value: null },
  { label: 'metadata property record', path: ['metadata', 'properties', 0], value: null },
  {
    label: 'metadata property name',
    path: ['metadata', 'properties', 0, 'name'],
    value: 'not valid',
  },
  {
    label: 'metadata property attribute',
    path: ['metadata', 'properties', 0, 'attribute'],
    value: 'onclick',
  },
  { label: 'metadata property type', path: ['metadata', 'properties', 0, 'type'], value: 'future' },
  {
    label: 'metadata converter',
    path: ['metadata', 'properties', 0, 'converter'],
    value: 'future',
  },
  { label: 'metadata reflect', path: ['metadata', 'properties', 0, 'reflect'], value: 'yes' },
  { label: 'metadata default', path: ['metadata', 'properties', 0, 'default'], value: Number.NaN },
  {
    label: 'unknown metadata property field',
    path: ['metadata', 'properties', 0, 'future'],
    value: true,
  },
  { label: 'metadata observed type', path: ['metadata', 'observedAttributes'], value: null },
  {
    label: 'metadata observed unsafe',
    path: ['metadata', 'observedAttributes', 0],
    value: 'onclick',
  },
  {
    label: 'metadata observed mismatch',
    path: ['metadata', 'observedAttributes', 0],
    value: 'label',
  },
  { label: 'metadata CEM tag', path: ['metadata', 'cem', 'tagName'], value: 'other-element' },
  { label: 'unknown metadata CEM field', path: ['metadata', 'cem', 'future'], value: true },
  { label: 'metadata CEM declaration', path: ['metadata', 'cem', 'declaration'], value: null },
  {
    label: 'unknown metadata CEM declaration field',
    path: ['metadata', 'cem', 'declaration', 'future'],
    value: true,
  },
  { label: 'metadata CEM attributes type', path: ['metadata', 'cem', 'attributes'], value: null },
  {
    label: 'metadata CEM attribute record',
    path: ['metadata', 'cem', 'attributes', 0],
    value: null,
  },
  {
    label: 'metadata CEM attribute name',
    path: ['metadata', 'cem', 'attributes', 0, 'name'],
    value: 'onclick',
  },
  {
    label: 'metadata CEM attribute field',
    path: ['metadata', 'cem', 'attributes', 0, 'fieldName'],
    value: 'not valid',
  },
  {
    label: 'metadata CEM attribute mismatch',
    path: ['metadata', 'cem', 'attributes', 0, 'fieldName'],
    value: 'label',
  },
  {
    label: 'unknown metadata CEM attribute field',
    path: ['metadata', 'cem', 'attributes', 0, 'future'],
    value: true,
  },
  { label: 'metadata CEM members type', path: ['metadata', 'cem', 'members'], value: null },
  { label: 'metadata CEM member record', path: ['metadata', 'cem', 'members', 0], value: null },
  {
    label: 'metadata CEM member field',
    path: ['metadata', 'cem', 'members', 0, 'fieldName'],
    value: 'not valid',
  },
  {
    label: 'metadata CEM member mismatch',
    path: ['metadata', 'cem', 'members', 0, 'fieldName'],
    value: 'label',
  },
  {
    label: 'unknown metadata CEM member field',
    path: ['metadata', 'cem', 'members', 0, 'future'],
    value: true,
  },
];

Deno.test('canonical serialized corpus normalizes to one immutable RuntimeProgramIR', async () => {
  const source = await Deno.readTextFile(FIXTURE);
  const compiled = compileElementProgram(source, '/project/app/islands/counter.tsx').program;
  const golden = JSON.parse(await Deno.readTextFile(GOLDEN));
  assertEquals(compiled, golden);
  assertEquals(JSON.stringify(compiled), JSON.stringify(golden));
  validateCompilerProgram(golden);
  validateRuntimeProgram(golden);
  const ir = normalizePartProgram(golden);
  assertNotStrictEquals(ir, golden);
  assertEquals(ir, golden);
  assertEquals(Object.isFrozen(ir), true);
  assertEquals(Object.isFrozen(ir.parts), true);
});

Deno.test('Part Program validators independently fail closed across the artifact surface', async () => {
  const source = await Deno.readTextFile(FIXTURE);
  const valid = compileElementProgram(source, '/project/app/islands/counter.tsx').program;
  validateCompilerProgram(valid);
  validateRuntimeProgram(valid);

  for (const fault of faults) {
    const compilerCandidate = structuredClone(valid);
    setPath(compilerCandidate, fault.path, fault.value);
    assertThrows(
      () => validateCompilerProgram(compilerCandidate),
      Error,
      undefined,
      `compiler validator accepted ${fault.label}`,
    );

    const runtimeCandidate = structuredClone(valid);
    setPath(runtimeCandidate, fault.path, fault.value);
    assertThrows(
      () => validateRuntimeProgram(runtimeCandidate),
      Error,
      undefined,
      `runtime validator accepted ${fault.label}`,
    );
  }
});

Deno.test('Part Program sink validators reject corrupted class, style, bool, html, ref and attr records', () => {
  const source = `
    import { element, OpenElement, property, trustedHtml, type TrustedHtml } from '@openelement/element';
    @element('oe-sink-matrix')
    export class SinkMatrix extends OpenElement {
      @property({ reflect: false }) className = 'ready';
      @property({ reflect: false }) styleText = 'color:red';
      @property({ reflect: false }) titleText = 'title';
      @property({ reflect: false }) hidden = false;
      @property({ type: Object, reflect: false, attribute: false }) bodyHtml: TrustedHtml = trustedHtml('<b>safe</b>');
      @property({ reflect: false, attribute: false }) inputRef = null;
      render() {
        return <main>
          <section class={this.className} style={this.styleText} title={this.titleText} hidden={this.hidden}></section>
          <div innerHTML={this.bodyHtml} trustedHtml></div>
          <input ref={this.inputRef} />
        </main>;
      }
    }
  `;
  const valid = compileElementProgram(source, '/project/app/components/sink-matrix.tsx').program;
  validateCompilerProgram(valid);
  validateRuntimeProgram(valid);

  const kinds = ['class', 'style', 'attr', 'bool', 'html', 'ref'] as const;
  for (const kind of kinds) {
    const index = valid.parts.findIndex((part) => part.k === kind);
    if (index < 0) throw new Error(`fixture did not emit ${kind}`);
    const corruptions: Fault[] = [
      {
        label: `${kind} location kind`,
        path: ['parts', index, 'location', 'kind'],
        value: 'anchor',
      },
      { label: `${kind} path`, path: ['parts', index, 'path'], value: [99] },
      { label: `${kind} location node`, path: ['parts', index, 'location', 'node'], value: 'e0' },
    ];
    if (kind === 'ref') {
      corruptions.push({ label: 'ref name', path: ['parts', index, 'ref'], value: 'not valid' });
      corruptions.push({
        label: 'runtime-only ref handler',
        path: ['parts', index, 'handler'],
        value: 'handleRef',
      });
    } else {
      corruptions.push({
        label: `${kind} signal`,
        path: ['parts', index, 'signal'],
        value: 'not valid',
      });
    }
    if (kind === 'attr' || kind === 'bool') {
      corruptions.push({
        label: `${kind} unsafe name`,
        path: ['parts', index, 'name'],
        value: 'onclick',
      });
    }
    for (const fault of corruptions) {
      for (const validate of [validateCompilerProgram, validateRuntimeProgram]) {
        const candidate = structuredClone(valid);
        setPath(candidate, fault.path, fault.value);
        assertThrows(() => validate(candidate), Error, undefined, fault.label);
      }
    }
  }

  const htmlIndex = valid.parts.findIndex((part) => part.k === 'html');
  const occupiedHtmlTarget = structuredClone(valid);
  setPath(occupiedHtmlTarget, ['template', 0, 'children', 1, 'children'], [
    { k: 'text', value: 'occupied' },
  ]);
  for (const validate of [validateCompilerProgram, validateRuntimeProgram]) {
    assertThrows(() => validate(occupiedHtmlTarget), Error, 'childless');
  }
  if (htmlIndex < 0) throw new Error('fixture did not emit html');
});

Deno.test('Part Program event-action and item-slot grammars fail closed independently', () => {
  const source = `
    import { element, OpenElement, property } from '@openelement/element';
    @element('oe-action-matrix')
    export class ActionMatrix extends OpenElement {
      @property({ type: Number, reflect: false }) count = 0;
      @property({ type: Array, reflect: false }) items = [{ id: 'a', text: 'alpha' }];
      reset() { this.count = 0; }
      render() {
        return <main>
          <button onClick={() => this.count++}>inc</button>
          <button onClick={() => this.count--}>dec</button>
          <button onClick={() => this.count = 3}>assign</button>
          <button onClick={() => this.count += 2}>add</button>
          <button onClick={() => this.count -= 2}>subtract</button>
          <button onClick={() => this.reset()}>call</button>
          <ul>{this.items.map((item) => <li key={item.id} data-label={item.text}>{item.text}</li>)}</ul>
        </main>;
      }
    }
  `;
  const valid = compileElementProgram(source, '/project/app/components/action-matrix.tsx').program;
  validateCompilerProgram(valid);
  validateRuntimeProgram(valid);

  const actionKinds = valid.parts
    .filter((part) => part.k === 'event')
    .map((part) => part.action.kind);
  for (
    const kind of ['increment', 'decrement', 'assign', 'add', 'subtract', 'call'] as const
  ) {
    if (!actionKinds.includes(kind)) throw new Error(`fixture did not emit ${kind}`);
  }

  const eventIndices = valid.parts
    .map((part, index) => part.k === 'event' ? index : -1)
    .filter((index) => index >= 0);
  const actionFaults: unknown[] = [
    null,
    { kind: 'increment', signal: 'not valid' },
    { kind: 'decrement', signal: 'not valid' },
    { kind: 'assign', signal: 'count', value: Number.NaN },
    { kind: 'add', signal: 'count', value: '2' },
    { kind: 'subtract', signal: 'not valid', value: 2 },
    { kind: 'call', name: 'not valid' },
    { kind: 'future' },
  ];
  for (const [position, action] of actionFaults.entries()) {
    const index = eventIndices[position % eventIndices.length];
    for (const validate of [validateCompilerProgram, validateRuntimeProgram]) {
      const candidate = structuredClone(valid);
      setPath(candidate, ['parts', index, 'action'], action);
      assertThrows(() => validate(candidate), Error, undefined, `event action fault ${position}`);
    }
  }

  const eachIndex = valid.parts.findIndex((part) => part.k === 'each');
  if (eachIndex < 0) throw new Error('fixture did not emit each');
  const itemFaults: Fault[] = [
    { label: 'item node record', path: ['parts', eachIndex, 'item', 0], value: null },
    {
      label: 'item anchor',
      path: ['parts', eachIndex, 'item', 0, 'children', 0],
      value: { k: 'part', id: 'p0', index: 0 },
    },
    {
      label: 'item value field',
      path: ['parts', eachIndex, 'item', 0, 'children', 0, 'field'],
      value: 'not valid',
    },
    { label: 'item attributes type', path: ['parts', eachIndex, 'item', 0, 'iattrs'], value: null },
    {
      label: 'item attribute tuple',
      path: ['parts', eachIndex, 'item', 0, 'iattrs', 0],
      value: ['data-label'],
    },
    {
      label: 'item attribute unsafe',
      path: ['parts', eachIndex, 'item', 0, 'iattrs', 0, 0],
      value: 'onclick',
    },
    {
      label: 'item attribute key',
      path: ['parts', eachIndex, 'item', 0, 'iattrs', 0, 0],
      value: 'key',
    },
    {
      label: 'item attribute field',
      path: ['parts', eachIndex, 'item', 0, 'iattrs', 0, 1],
      value: 'not valid',
    },
  ];
  for (const fault of itemFaults) {
    for (const validate of [validateCompilerProgram, validateRuntimeProgram]) {
      const candidate = structuredClone(valid);
      setPath(candidate, fault.path, fault.value);
      assertThrows(() => validate(candidate), Error, undefined, fault.label);
    }
  }
});

Deno.test('Part Program ownership tables reject duplicate, missing, and misplaced records', async () => {
  const source = await Deno.readTextFile(FIXTURE);
  const valid = compileElementProgram(source, '/project/app/islands/counter.tsx').program;
  const candidates: Array<{ label: string; mutate(value: typeof valid): void }> = [
    {
      label: 'duplicate static attribute',
      mutate(value) {
        value.template[0].k === 'el' && value.template[0].attrs.push(['CLASS', 'other']);
      },
    },
    {
      label: 'item attribute outside an each template',
      mutate(value) {
        if (value.template[0].k === 'el') value.template[0].iattrs = [['data-x', 'field']];
      },
    },
    {
      label: 'duplicate element identity',
      mutate(value) {
        const root = value.template[0];
        if (root.k === 'el' && root.children[0]?.k === 'el') root.children[0].id = root.id;
      },
    },
    {
      label: 'empty text node',
      mutate(value) {
        const root = value.template[0];
        const heading = root.k === 'el' ? root.children[0] : undefined;
        if (heading?.k === 'el' && heading.children[0]?.k === 'text') {
          heading.children[0].value = '';
        }
      },
    },
    {
      label: 'unknown tree node',
      mutate(value) {
        const root = value.template[0];
        const heading = root.k === 'el' ? root.children[0] : undefined;
        if (heading?.k === 'el') {
          (heading.children[0] as { k: string }).k = 'future';
        }
      },
    },
    {
      label: 'duplicate anchor',
      mutate(value) {
        const root = value.template[0];
        const heading = root.k === 'el' ? root.children[0] : undefined;
        if (heading?.k === 'el' && heading.children[1]) {
          heading.children.push(structuredClone(heading.children[1]));
        }
      },
    },
    {
      label: 'fixed part given an anchor',
      mutate(value) {
        const root = value.template[0];
        const button = root.k === 'el' ? root.children[2] : undefined;
        if (button?.k === 'el') button.children = [{ k: 'part', id: 'p2', index: 2 }];
      },
    },
    {
      label: 'missing dependency',
      mutate(value) {
        value.dependencies = value.dependencies.slice(1);
      },
    },
    {
      label: 'duplicate dependency',
      mutate(value) {
        value.dependencies.push(structuredClone(value.dependencies[0]));
      },
    },
    {
      label: 'missing region',
      mutate(value) {
        value.regions = value.regions.slice(1);
      },
    },
    {
      label: 'missing element location',
      mutate(value) {
        value.locations = value.locations.filter((location) => location.id !== 'e0');
      },
    },
    {
      label: 'missing part location',
      mutate(value) {
        value.locations = value.locations.filter((location) => location.id !== 'p0');
      },
    },
    {
      label: 'missing source record',
      mutate(value) {
        value.sourceMap.records = value.sourceMap.records.filter((record) => record.id !== 'root');
      },
    },
  ];

  for (const candidate of candidates) {
    for (const validate of [validateCompilerProgram, validateRuntimeProgram]) {
      const corrupted = structuredClone(valid);
      candidate.mutate(corrupted);
      assertThrows(() => validate(corrupted), Error, undefined, candidate.label);
    }
  }
});
