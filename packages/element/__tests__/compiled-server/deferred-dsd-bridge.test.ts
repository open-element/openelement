import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  createDeferredDsdExecutor,
  type DeferredDsdManifest,
  renderDsd,
} from '../../src/public-runtime.ts';
import { OpenElementError } from '../../src/internal/protocol/errors.ts';
import type { PartProgramV1 } from '../../src/internal/protocol/part-program.ts';
import { CompiledProgramValidationError } from '../../src/internal/compiled/server/shared.ts';
import { type TestNodeSpec, testProgram } from '../compiled-runtime/test-program.ts';

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

Deno.test('deferred seed enforces the browser 64-property budget fail-loud at seed construction', async () => {
  const propProgram = (count: number): PartProgramV1 =>
    testProgram({
      tag: 'oe-deferred-seed-budget',
      rootMode: 'light',
      template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
      parts: [{ k: 'text', index: 0, signal: 'p0' }],
      properties: Array.from({ length: count }, (_, index) => ({
        name: `p${index}`,
        attribute: null,
        type: 'string' as const,
        converter: 'string' as const,
        reflect: false,
        default: '',
      })),
    }) as PartProgramV1;
  const manifestForField = async (
    selectedProgram: PartProgramV1,
  ): Promise<DeferredDsdManifest> => {
    const { sourceMap: _sourceMap, ...wireProgram } = selectedProgram;
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(wireProgram)),
    );
    return {
      program: {
        version: selectedProgram.version,
        tag: selectedProgram.tag,
        sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        ),
      },
      fields: [{ field: 'p0', signal: 'p0', owners: [{ kind: 'part', index: 0 }] }],
    };
  };
  const classFor = (selectedProgram: PartProgramV1) => {
    class BudgetPage {}
    Object.assign(BudgetPage, {
      __partProgram: selectedProgram,
      __compiledProperties: selectedProgram.metadata.properties,
    });
    return BudgetPage as unknown as CustomElementConstructor;
  };

  // Boundary: exactly 64 seed properties pass and produce a full seed.
  const atLimit = await createDeferredDsdExecutor({
    componentClass: classFor(propProgram(64)),
    manifest: await manifestForField(propProgram(64)),
    instanceId: 'seed-budget-64',
  });
  assertEquals(Object.keys(atLimit.seed).length, 64);

  // Over budget: the 65th property must fail loud server-side, not be
  // silently dropped whole by the browser seed contract at hydration.
  await assertRejects(
    async () => {
      const over = propProgram(65);
      await createDeferredDsdExecutor({
        componentClass: classFor(over),
        manifest: await manifestForField(over),
        instanceId: 'seed-budget-65',
      });
    },
    OpenElementError,
    'at most 64',
  );
});

Deno.test('deferred bridge applies the streamed-frame policy to hand-written manifest regions', async () => {
  const whenProgram = (on: TestNodeSpec[]): PartProgramV1 =>
    testProgram({
      tag: 'oe-deferred-policy',
      rootMode: 'light',
      template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
      parts: [{
        k: 'when',
        index: 0,
        signal: 'enabled',
        test: { signal: 'enabled', op: 'truthy', value: true },
        on,
        off: [],
      }],
      properties: [{
        name: 'enabled',
        attribute: null,
        type: 'boolean' as const,
        converter: 'boolean' as const,
        reflect: false,
        default: false,
      }],
    }) as PartProgramV1;
  const classFor = (selectedProgram: PartProgramV1) => {
    class PolicyPage {}
    Object.assign(PolicyPage, {
      __partProgram: selectedProgram,
      __compiledProperties: selectedProgram.metadata.properties,
    });
    return PolicyPage as unknown as CustomElementConstructor;
  };
  const reject = async (on: TestNodeSpec[], message: string) => {
    const program = whenProgram(on);
    const { sourceMap: _sourceMap, ...wireProgram } = program;
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(wireProgram)),
    );
    await assertRejects(
      () =>
        createDeferredDsdExecutor({
          componentClass: classFor(program),
          manifest: {
            program: {
              version: program.version,
              tag: program.tag,
              sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0'))
                .join(''),
            },
            fields: [{
              field: 'enabled',
              signal: 'enabled',
              owners: [{ kind: 'region', index: 0 }],
            }],
          },
          instanceId: 'policy-instance',
        }),
      CompiledProgramValidationError,
      message,
    );
  };

  // Forbidden frame tags the browser installer would reject wholesale.
  await reject([{ k: 'el', tag: 'iframe', attrs: [], children: [] }], 'opaque');
  await reject([{ k: 'el', tag: 'template', attrs: [], children: [] }], 'opaque');
  await reject([{ k: 'el', tag: 'meta', attrs: [], children: [] }], 'opaque');
  // on*/srcdoc static attributes are already rejected one layer earlier by
  // the Part Program validator ("unsafe name"), so the executor-level gaps are
  // the stream-frame-forbidden tags, seed-spoofing data-oe-* attributes, and
  // script-URL attribute values.
  await reject(
    [{ k: 'el', tag: 'b', attrs: [['data-oe-frame', 'spoof']], children: [] }],
    'opaque',
  );
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'javascript:alert(1)']],
    children: [],
  }], 'opaque');
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'java\tscript:alert(1)']],
    children: [],
  }], 'opaque');
  // Entity obfuscation: the compiler keeps static attribute strings verbatim
  // (no entity decoding into the AST), so admission decodes the standard
  // entity set before the URL check — including the uppercase-hex and
  // semicolon-less numeric forms an HTML parser decodes.
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'javascript&#58;alert(1)']],
    children: [],
  }], 'opaque');
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'javascript&colon;alert(1)']],
    children: [],
  }], 'opaque');
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'java&Tab;script:alert(1)']],
    children: [],
  }], 'opaque');
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'javascript&#X3A;alert(1)']],
    children: [],
  }], 'opaque');
  await reject([{
    k: 'el',
    tag: 'a',
    attrs: [['href', 'javascript&#58alert(1)']],
    children: [],
  }], 'opaque');
  // Nested unsafe content is caught through the recursion too.
  await reject([{
    k: 'el',
    tag: 'span',
    attrs: [],
    children: [{ k: 'el', tag: 'object', attrs: [], children: [] }],
  }], 'opaque');
});

Deno.test('deferred bridge enforces the build-aligned field/owner budget on hand-written manifests', async () => {
  const classFor = (selectedProgram: PartProgramV1) => {
    class BudgetPage {}
    Object.assign(BudgetPage, {
      __partProgram: selectedProgram,
      __compiledProperties: selectedProgram.metadata.properties,
    });
    return BudgetPage as unknown as CustomElementConstructor;
  };
  const anchorTemplate = (count: number) => [{
    k: 'el' as const,
    tag: 'p',
    attrs: [] as Array<[string, string]>,
    children: Array.from({ length: count }, (_, index) => ({ k: 'part' as const, index })),
  }];
  const stringProperty = (name: string) => ({
    name,
    attribute: null,
    type: 'string' as const,
    converter: 'string' as const,
    reflect: false,
    default: '',
  });
  const manifestFor = (
    selectedProgram: PartProgramV1,
    fields: DeferredDsdManifest['fields'],
  ): Promise<DeferredDsdManifest> => {
    const { sourceMap: _sourceMap, ...wireProgram } = selectedProgram;
    return crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(wireProgram)),
    ).then((hash) => ({
      program: {
        version: selectedProgram.version,
        tag: selectedProgram.tag,
        sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        ),
      },
      fields,
    }));
  };

  // Negative: 33 deferred fields are rejected at the public boundary.
  const fields33 = testProgram({
    tag: 'oe-deferred-field-budget',
    rootMode: 'light',
    template: anchorTemplate(33),
    parts: Array.from({ length: 33 }, (_, index) => ({
      k: 'text' as const,
      index,
      signal: `p${index}`,
    })),
    properties: Array.from({ length: 33 }, (_, index) => stringProperty(`p${index}`)),
  }) as PartProgramV1;
  await assertRejects(
    async () => {
      await createDeferredDsdExecutor({
        componentClass: classFor(fields33),
        manifest: await manifestFor(
          fields33,
          Array.from({ length: 33 }, (_, index) => ({
            field: `p${index}`,
            signal: `p${index}`,
            owners: [{ kind: 'part' as const, index }],
          })),
        ),
        instanceId: 'field-budget-33',
      });
    },
    OpenElementError,
    '33 fields (max 32)',
  );

  // Negative: 65 owners on one field are rejected at the public boundary.
  const owners65 = testProgram({
    tag: 'oe-deferred-owner-budget',
    rootMode: 'light',
    template: anchorTemplate(65),
    parts: Array.from({ length: 65 }, (_, index) => ({
      k: 'text' as const,
      index,
      signal: 'p0',
    })),
    properties: [stringProperty('p0')],
  }) as PartProgramV1;
  await assertRejects(
    async () => {
      await createDeferredDsdExecutor({
        componentClass: classFor(owners65),
        manifest: await manifestFor(owners65, [{
          field: 'p0',
          signal: 'p0',
          owners: Array.from({ length: 65 }, (_, index) => ({ kind: 'part' as const, index })),
        }]),
        instanceId: 'owner-budget-65',
      });
    },
    OpenElementError,
    '65 Part owners (max 64)',
  );

  // Boundary: 32 fields with 2 owners each (64 total) build an executor.
  const pairs32 = testProgram({
    tag: 'oe-deferred-pair-budget',
    rootMode: 'light',
    template: anchorTemplate(64),
    parts: Array.from({ length: 64 }, (_, index) => ({
      k: 'text' as const,
      index,
      signal: `p${Math.floor(index / 2)}`,
    })),
    properties: Array.from({ length: 32 }, (_, index) => stringProperty(`p${index}`)),
  }) as PartProgramV1;
  const boundary = await createDeferredDsdExecutor({
    componentClass: classFor(pairs32),
    manifest: await manifestFor(
      pairs32,
      Array.from({ length: 32 }, (_, index) => ({
        field: `p${index}`,
        signal: `p${index}`,
        owners: [
          { kind: 'part' as const, index: index * 2 },
          { kind: 'part' as const, index: index * 2 + 1 },
        ],
      })),
    ),
    instanceId: 'pair-budget-32',
  });
  assertEquals(Object.keys(boundary.seed).length, 32);
});
