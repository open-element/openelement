import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  createDeferredDsdExecutor,
  type DeferredDsdManifest,
  renderDsd,
} from '../../src/public-runtime.ts';
import type { PartProgramV1 } from '../../src/internal/protocol/part-program.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const program = testProgram({
  tag: 'oe-deferred-bridge',
  rootMode: 'shadow-open',
  template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'title' }],
  properties: [{
    name: 'title',
    attribute: null,
    type: 'string',
    converter: 'string',
    reflect: false,
    default: 'default',
  }, {
    name: 'count',
    attribute: 'count',
    type: 'number',
    converter: 'number',
    reflect: false,
    default: 0,
  }],
}) as PartProgramV1;

class Page {}
Object.assign(Page, {
  __partProgram: program,
  __compiledProperties: program.metadata.properties,
  styles: { cssRules: [{ cssText: 'p { color: red; }' }] },
});

async function manifestFor(
  selectedProgram: PartProgramV1 = program,
): Promise<DeferredDsdManifest> {
  const { sourceMap: _sourceMap, ...wireProgram } = selectedProgram;
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(wireProgram)),
  );
  return {
    program: {
      version: selectedProgram.version,
      tag: selectedProgram.tag,
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    },
    fields: [{ field: 'title', signal: 'title', owners: [{ kind: 'part', index: 0 }] }],
  };
}

Deno.test('deferred DSD bridge shares renderDsd property seeding and Part serialization', async () => {
  const manifest = await manifestFor();
  const props = { count: 'not-a-number' } as Record<string, unknown>;
  Object.defineProperty(props, 'title', {
    get() {
      throw new Error('pending title must not be read');
    },
  });
  const bridge = await createDeferredDsdExecutor({
    componentClass: Page as unknown as CustomElementConstructor,
    props,
    manifest,
    instanceId: 'request-instance',
  });
  assertStringIncludes(bridge.shell, '<oe-deferred-bridge>');
  assertEquals(bridge.shell.includes('count='), false);
  assertStringIncludes(
    bridge.shell,
    '<template shadowrootmode="open"><style data-oe-static-styles>p { color: red; }\n</style>',
  );
  assertEquals(bridge.serializeResolved('title', 42), ['42']);
  const rendered = renderDsd('oe-deferred-bridge', {
    componentClass: Page as unknown as CustomElementConstructor,
    props: { count: 'not-a-number' },
  }).html;
  assertStringIncludes(rendered, '<oe-deferred-bridge>');
  assertEquals(rendered.includes('count='), false);
  assertStringIncludes(
    rendered,
    '<template shadowrootmode="open"><style data-oe-static-styles>p { color: red; }\n</style>',
  );
  assertStringIncludes(rendered, '<p><!--oe:p0-->default</p>');
  assertStringIncludes(bridge.shell, '<p><!--oe:p0--><!--oe:/p0--></p>');
});

Deno.test('deferred DSD bridge rejects a manifest for a changed compiled program', async () => {
  const manifest = await manifestFor();
  const changedProgram = structuredClone(program);
  const rootElement = changedProgram.template[0];
  if (rootElement.k !== 'el') throw new Error('expected a root element');
  rootElement.tag = 'section';
  class ChangedPage {}
  Object.assign(ChangedPage, {
    __partProgram: changedProgram,
    __compiledProperties: changedProgram.metadata.properties,
  });
  await assertRejects(
    () =>
      createDeferredDsdExecutor({
        componentClass: ChangedPage as unknown as CustomElementConstructor,
        manifest,
        instanceId: 'request-instance',
      }),
    Error,
    'does not match compiled program',
  );
});

Deno.test('deferred DSD bridge never reads pending properties and follows compiled root mode', async () => {
  const lightProgram = testProgram({
    tag: 'oe-deferred-light',
    rootMode: 'light',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
    properties: [{
      name: 'title',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: '',
    }],
  }) as PartProgramV1;
  class LightPage {}
  Object.assign(LightPage, {
    __partProgram: lightProgram,
    __compiledProperties: lightProgram.metadata.properties,
  });
  const bridge = await createDeferredDsdExecutor({
    componentClass: LightPage as unknown as CustomElementConstructor,
    manifest: await manifestFor(lightProgram),
    instanceId: 'light-instance',
  });
  assertStringIncludes(bridge.shell, '<oe-deferred-light data-oe-light>');
  assertStringIncludes(bridge.shell, '<!--oe:p0--><!--oe:/p0-->');
  assertEquals(bridge.serializeResolved('title', 'settled'), ['settled']);
});

Deno.test('deferred host owns stream identity and typed pending/resolved seed', async () => {
  const bridge = await createDeferredDsdExecutor({
    componentClass: Page as unknown as CustomElementConstructor,
    props: { count: 7 },
    manifest: await manifestFor(),
    instanceId: 'instance-1',
    documentToken: 'request-1',
  });
  assertStringIncludes(bridge.shell, 'data-oe-stream-request="request-1"');
  assertStringIncludes(bridge.shell, 'data-oe-stream-instance="instance-1"');
  assertStringIncludes(bridge.shell, 'data-oe-stream-program="1:');
  assertEquals(bridge.seed.title, { state: 'pending', type: 'string' });
  assertEquals(bridge.seed.count, { state: 'resolved', type: 'number', value: 7 });
  assertEquals(bridge.resolvedValue('title', '<safe>'), '<safe>');
  assertEquals(bridge.resolvedValue('title', null), null);
  assertEquals(bridge.serializeResolved('title', null), ['null']);
});

Deno.test('deferred seed distinguishes absent default, explicit null, and pending', async () => {
  const missingProgram = testProgram({
    tag: 'oe-deferred-missing',
    rootMode: 'light',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
    properties: [{
      name: 'title',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: '',
    }, {
      name: 'optional',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: 'fallback',
    }, {
      name: 'nullable',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: 'fallback',
    }],
  }) as PartProgramV1;
  class MissingPage {}
  Object.assign(MissingPage, {
    __partProgram: missingProgram,
    __compiledProperties: missingProgram.metadata.properties,
  });
  const bridge = await createDeferredDsdExecutor({
    componentClass: MissingPage as unknown as CustomElementConstructor,
    props: { nullable: null },
    manifest: await manifestFor(missingProgram),
    instanceId: 'missing-instance',
  });
  assertEquals(bridge.seed.title, { state: 'pending', type: 'string' });
  assertEquals(bridge.seed.optional, { state: 'missing', type: 'string' });
  assertEquals(bridge.seed.nullable, { state: 'resolved', type: 'string', value: null });
});
