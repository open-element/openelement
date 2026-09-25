import { assertEquals, assertStrictEquals } from '@std/assert';
import { createDeferredServerExecutor } from '../../src/internal/compiled/server/index.ts';
import {
  STREAM_STATE_KEY,
  type StreamHostState,
} from '../../src/internal/compiled/stream-state.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import {
  type FacadeElement,
  installFacadeDom,
  mountSerialized,
} from '../compiled-runtime/facade-dom.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const dom = installFacadeDom();
const { OpenElement } = await import('@openelement/element');
const tag = 'oe-stream-facade-test';
const program = testProgram({
  tag,
  rootMode: 'light',
  template: [{
    k: 'el',
    tag: 'main',
    attrs: [],
    children: [{ k: 'text', value: 'Start ' }, { k: 'part', index: 0 }],
  }],
  parts: [{ k: 'text', index: 0, signal: 'title' }],
  properties: [{
    name: 'title',
    attribute: null,
    type: 'string',
    converter: 'string',
    reflect: false,
    default: '',
  }],
});
const ctor = class extends OpenElement {} as unknown as
  & CustomElementConstructor
  & Record<string, unknown>;
ctor.__partProgram = program;
ctor.__compiledProperties = program.metadata.properties;
ctor.__elementMetadata = program.metadata;
dom.registry.define(tag, ctor);

function fixture(early: boolean) {
  const owner = { program, version: program.version, instanceId: 'instance-1' };
  const executor = createDeferredServerExecutor(
    program,
    { signals: { title: signal('') }, handlers: {} },
    { owner, pendingParts: [0] },
    { mode: 'light' },
  );
  const request = 'request-1';
  const identity = `${program.version}:test-hash`;
  const html = executor.shell.replace(
    `<${tag} `,
    `<${tag} data-oe-stream-request="${request}" data-oe-stream-program="${identity}" data-oe-stream-instance="${owner.instanceId}" `,
  );
  const listeners = new Set<(part: number, field: string, outcome: 'content') => void>();
  const state: StreamHostState = {
    request,
    program: identity,
    instance: owner.instanceId,
    properties: {
      title: early
        ? { state: 'resolved', type: 'string', value: 'Early' }
        : { state: 'pending', type: 'string' },
    },
    parts: [0],
    pending: new Set(early ? [] : [0]),
    listen(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  let original: unknown;
  const element = mountSerialized(dom, html, (host) => {
    const main = host.childNodes[0] as FacadeElement;
    if (early) {
      const end = main.childNodes.find((node) => 'data' in node && node.data === 'oe:/p0')!;
      original = dom.document.createTextNode('Early');
      main.insertBefore(original as never, end);
    }
    Object.defineProperty(host, STREAM_STATE_KEY, { value: state });
  }) as FacadeElement & { title: string };
  const main = element.childNodes[0] as FacadeElement;
  return { element, main, state, listeners, original };
}

Deno.test('OpenElement adopts a streamed text Part that arrived before claim', () => {
  const { element, main, original } = fixture(true);
  assertStrictEquals(main.childNodes[2], original);
  assertEquals(element.title, 'Early');
  element.title = 'Updated';
  assertEquals((original as { data: string }).data, 'Updated');
  dom.document.body.removeChild(element);
});

Deno.test('OpenElement claims an empty streamed Part then adopts a late frame', () => {
  const { element, main, state, listeners } = fixture(false);
  const staticNode = main.childNodes[0];
  const end = main.childNodes.find((node) => 'data' in node && node.data === 'oe:/p0')!;
  const text = dom.document.createTextNode('Late');
  main.insertBefore(text, end);
  state.properties.title = { state: 'resolved', type: 'string', value: 'Late' };
  state.pending.delete(0);
  for (const listener of listeners) listener(0, 'title', 'content');
  assertStrictEquals(main.childNodes[0], staticNode);
  assertStrictEquals(main.childNodes[2], text);
  assertEquals(element.title, 'Late');
  element.title = 'Updated';
  assertEquals(text.data, 'Updated');
  dom.document.body.removeChild(element);
  assertEquals(listeners.size, 0);
});

Deno.test('OpenElement disconnect cancels pending stream adoption without losing signal value', () => {
  const { element, main, state, listeners } = fixture(false);
  const original = main.childNodes[0];
  element.title = 'Local';
  dom.document.body.removeChild(element);
  assertEquals(listeners.size, 0);
  state.properties.title = { state: 'resolved', type: 'string', value: 'Too late' };
  state.pending.delete(0);
  for (const listener of listeners) listener(0, 'title', 'content');
  assertEquals(element.title, 'Local');
  assertStrictEquals(main.childNodes[0], original);
});
