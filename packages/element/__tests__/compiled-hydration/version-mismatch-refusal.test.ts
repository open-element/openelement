/**
 * version-mismatch-refusal.test.ts — alpha15 R5 (Workstream D).
 *
 * R5: a client hydration artifact whose Part Program format version does not
 * match the version the server-rendered artifact was produced under must be
 * REFUSED before hydration touches the server DOM, with an expected-vs-actual
 * diagnostic that names the fix. The runtime's one version comparison site is
 * `validatePartProgram` (`version must be 2 (got 1)`), reached by the hydration
 * entry through `normalizePartProgram` BEFORE the staged DOM scan — and, on a
 * streamed host, the server-emitted `data-oe-stream-program="<version>:<sha>"`
 * attribute is the one server-side version stamp visible to the client.
 *
 * These tests run REAL serializer output (the frozen compiler fixture's HTML)
 * through the REAL claim entry point and the REAL public facade connect path,
 * and assert the failed hydration leaves the server-rendered DOM exactly as it
 * was parsed.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { errorToEnvelope } from '@openelement/protocol/diagnostics';
import { ClaimErrorCode, OpenElementError, ProgramErrorCode } from '@openelement/protocol/errors';
import { PART_PROGRAM_VERSION } from '@openelement/protocol/part-program';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { hydrateExistingDom } from '../../src/internal/compiled/runtime.ts';
import {
  createStreamServerExecutor,
  serializeProgramContent,
} from '../../src/internal/compiled/server/index.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { STREAM_STATE_KEY } from '../../src/internal/compiled/stream-state.ts';
import {
  installFacadeDom,
  mountSerialized,
  toHtml as facadeToHtml,
} from '../compiled-runtime/facade-dom.ts';
import { TestDocument, parseHtml, toHtml, type TestElement } from '../compiled-runtime/test-dom.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

/** A structural signal that counts the subscriptions a claim attaches. */
class TestSignal<T> {
  #value: T;
  subscriptions = 0;
  readonly #listeners = new Set<(value: T) => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T {
    return this.#value;
  }

  set value(next: T) {
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.subscriptions++;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** The frozen compiler artifact for the claim fixture (a real Part Program v2). */
const PROGRAM: unknown = JSON.parse(
  await readFile(
    new URL('../../__fixtures__/compiled-hydration/program.json', import.meta.url),
    'utf8',
  ),
);

function fixtureHost() {
  const count = new TestSignal(0);
  const label = new TestSignal('ready');
  const items = new TestSignal([
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
  ]);
  return {
    signals: { count, label, items },
    handlers: {
      increment: () => {
        count.value++;
      },
    },
    count,
    label,
    items,
  };
}

/** The real server-serialized HTML for the fixture program, parsed by the claim harness. */
function serializedRoot(): { doc: TestDocument; root: TestElement; html: string } {
  const host = fixtureHost();
  const html = serializeProgramContent(PROGRAM, host);
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  return { doc, root, html };
}

function nodeIds(root: TestElement): unknown[] {
  const ids: unknown[] = [];
  const walk = (node: TestElement) => {
    ids.push(node);
    for (const child of node.childNodes) {
      ids.push(child);
      if ('childNodes' in child) walk(child as TestElement);
    }
  };
  walk(root);
  return ids;
}

test('a matching artifact version hydrates the real serialized HTML in place', () => {
  const { root, html } = serializedRoot();
  const host = fixtureHost();
  const before = nodeIds(root);
  const beforeHtml = toHtml(root);
  // The parsed DOM is byte-faithful to the serializer's output, so the
  // before/after comparison below is a real HTML-preservation check.
  expect(beforeHtml).toEqual(`<host>${html}</host>`);
  // The server-rendered value node for Part 0: `<h1>Count: <!--oe:p0-->0</h1>`.
  const serverValueNode = root.childNodes[0].childNodes[0].childNodes[2] as { data: string };
  expect(serverValueNode.data).toEqual('0');

  const instance = hydrateExistingDom(PROGRAM as never, host as never, root as unknown as Node) as {
    dispose(): void;
  };

  // The claim attached to the parsed SSR nodes: no allocation, same HTML.
  expect(nodeIds(root)).toEqual(before);
  expect(toHtml(root)).toEqual(beforeHtml);
  expect(host.count.subscriptions).toBeGreaterThan(0);

  // The claimed Part is live: a signal write updates the SAME server-rendered node.
  host.count.value = 7;
  expect(serverValueNode.data).toEqual('7');
  expect(root.childNodes[0].childNodes[0].childNodes[2]).toBe(serverValueNode);

  instance.dispose();
});

test('a client artifact with an unimplemented format version is refused before the DOM is touched', () => {
  const { doc, root, html } = serializedRoot();
  const host = fixtureHost();
  const before = nodeIds(root);
  const beforeHtml = toHtml(root);
  expect(beforeHtml).toEqual(`<host>${html}</host>`);
  const countsBefore = { ...doc.counts };
  const stale = { ...(PROGRAM as Record<string, unknown>), version: PART_PROGRAM_VERSION - 1 };

  const error = assertThrowsIncludes(
    () => hydrateExistingDom(stale as never, host as never, root as unknown as Node),
    OpenElementError,
  ) as OpenElementError;

  // One structured, machine-readable diagnostic, stable code and phase.
  expect(error.code).toEqual(ProgramErrorCode.INVALID_PROGRAM);
  expect(error.severity).toEqual('error');
  expect(error.phase).toEqual('validation');
  expect(error.message).toContain(
    `version must be ${PART_PROGRAM_VERSION} (got ${PART_PROGRAM_VERSION - 1})`,
  );
  // Actionable: the message names the fix and refuses to coerce.
  expect(error.message).toContain('regenerate the program with the current compiler');
  expect(error.message).toContain('refused, never coerced');
  // And it maps onto the #1612 envelope contract without a lossy adapter.
  expect(errorToEnvelope(error)).toEqual({
    code: ProgramErrorCode.INVALID_PROGRAM,
    severity: 'error',
    phase: 'validation',
    message: error.message,
  });

  // Hydration did NOT happen: no subscription attached, no listener added.
  expect(host.count.subscriptions).toEqual(0);
  expect(host.label.subscriptions).toEqual(0);
  expect(host.items.subscriptions).toEqual(0);
  // The server-rendered HTML survives byte-for-byte, with node identity intact.
  expect(toHtml(root)).toEqual(beforeHtml);
  expect(nodeIds(root)).toEqual(before);
  expect({ ...doc.counts }).toEqual(countsBefore);
});

// ─── Public facade: the real connect path over the real SSR document ────────

const dom = installFacadeDom();
const { OpenElement, renderToString } = await import('../../src/index.ts');

const COUNTER_PROGRAM: Record<string, unknown> = JSON.parse(
  await readFile(
    new URL('../../__fixtures__/compiled-element-v2/expected-program.json', import.meta.url),
    'utf8',
  ),
);

/** The fixture class exactly as the adapter compiler emits it (v2 artifact). */
class CurrentCounter extends OpenElement {
  static __partProgram = COUNTER_PROGRAM;
  static __compiledProperties = (COUNTER_PROGRAM as { metadata: { properties: unknown } }).metadata
    .properties;
  static __elementMetadata = (COUNTER_PROGRAM as { metadata: unknown }).metadata;
  static observedAttributes = (COUNTER_PROGRAM as { metadata: { observedAttributes: string[] } })
    .metadata.observedAttributes;
  declare count: number;
  declare label: string;

  increment(): void {
    this.count++;
  }
}

/** The stale artifact the same class would carry in a client bundle from an older build. */
const STALE_COUNTER_PROGRAM = { ...COUNTER_PROGRAM, version: PART_PROGRAM_VERSION - 1 };

class StaleCounter extends OpenElement {
  static __partProgram = STALE_COUNTER_PROGRAM;
  static __compiledProperties = (STALE_COUNTER_PROGRAM as { metadata: { properties: unknown } })
    .metadata.properties;
  static __elementMetadata = (STALE_COUNTER_PROGRAM as { metadata: unknown }).metadata;
  static observedAttributes = (
    STALE_COUNTER_PROGRAM as { metadata: { observedAttributes: string[] } }
  ).metadata.observedAttributes;
  declare count: number;
  declare label: string;

  increment(): void {
    this.count++;
  }
}

const serialized = renderToString('oe-program-counter', {
  componentClass: CurrentCounter as unknown as CustomElementConstructor,
  props: { count: 3 },
});

dom.registry.define('oe-program-counter', StaleCounter as unknown as CustomElementConstructor);

test('the facade refuses to claim server DOM with a stale program version and keeps the SSR DOM', () => {
  let element: TestElement | undefined;
  let before = '';
  let beforeNodes: unknown[] = [];

  const error = assertThrowsIncludes(
    () =>
      mountSerialized(dom, serialized, (host) => {
        element = host as unknown as TestElement;
        beforeNodes = nodeIds(host as unknown as TestElement);
        before = facadeToHtml(host);
      }),
    OpenElementError,
  ) as OpenElementError;

  expect(error.code).toEqual(ProgramErrorCode.INVALID_PROGRAM);
  expect(error.phase).toEqual('validation');
  expect(error.message).toContain(`version must be ${PART_PROGRAM_VERSION} (got 1)`);

  // The connected-but-unhydrated host still carries the server's DOM verbatim:
  // the refusal neither replaced it with a fresh render nor corrupted it.
  expect(element).toBeDefined();
  expect(facadeToHtml(element as unknown as never)).toEqual(before);
  expect(nodeIds(element as unknown as TestElement)).toEqual(beforeNodes);
});

// ─── Streamed host: the server stamps its format version into the DOM ───────

const STREAM_TAG = 'oe-version-stream';
const SERVER_REQUEST = 'req-1';
const SERVER_INSTANCE = 'i-1';
const SERVER_PROGRAM = `${PART_PROGRAM_VERSION - 1}:deadbeef`;

const streamProgram = testProgram({
  tag: STREAM_TAG,
  rootMode: 'light',
  template: [{ k: 'el', tag: 'main', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'label' }],
  properties: [
    {
      name: 'label',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: '',
    },
  ],
});

class StreamHostElement extends OpenElement {
  static __partProgram = streamProgram;
  static __compiledProperties = streamProgram.metadata.properties;
  static __elementMetadata = streamProgram.metadata;
  static observedAttributes = streamProgram.metadata.observedAttributes;
  declare label: string;
}

dom.registry.define(STREAM_TAG, StreamHostElement as unknown as CustomElementConstructor);

test('a streamed host stamped by another format version names the mismatch instead of a generic seed failure', () => {
  const serializedStream = renderToString(STREAM_TAG, {
    componentClass: StreamHostElement as unknown as CustomElementConstructor,
    props: { label: 'Server' },
  });
  const streamHtml = serializedStream.replace(
    `<${STREAM_TAG}`,
    `<${STREAM_TAG} data-oe-stream-request="${SERVER_REQUEST}" ` +
      `data-oe-stream-program="${SERVER_PROGRAM}" data-oe-stream-instance="${SERVER_INSTANCE}"`,
  );

  let element: TestElement | undefined;
  let before = '';

  const error = assertThrowsIncludes(
    () =>
      mountSerialized(dom, streamHtml, (host) => {
        element = host as unknown as TestElement;
        before = facadeToHtml(host);
        // The old build's bootstrap already installed its typed seed: every
        // identity field matches except the Part Program format version.
        Object.defineProperty(host, STREAM_STATE_KEY, {
          configurable: true,
          value: {
            request: SERVER_REQUEST,
            program: SERVER_PROGRAM,
            instance: SERVER_INSTANCE,
            properties: { label: { state: 'resolved', type: 'string', value: 'Server' } },
            parts: [0],
            pending: new Set<number>(),
            listen: () => () => {},
          },
        });
      }),
    OpenElementError,
  ) as OpenElementError;

  // Hydration is refused with the existing structured claim code…
  expect(error.code).toEqual(ClaimErrorCode.STRUCTURE_MISMATCH);
  expect(error.phase).toEqual('csr');
  // …and the diagnostic is expected-vs-actual and actionable, not a generic
  // "no matching typed seed" that hides the version mismatch.
  expect(error.message).toContain(SERVER_PROGRAM);
  expect(error.message).toContain(`v${PART_PROGRAM_VERSION - 1}`);
  expect(error.message).toContain(`v${PART_PROGRAM_VERSION}`);
  expect(error.message).toContain('different builds');
  // Still one machine-readable diagnostic on the #1612 envelope contract.
  expect(errorToEnvelope(error).code).toEqual(ClaimErrorCode.STRUCTURE_MISMATCH);

  // The server-rendered DOM is kept, untouched.
  expect(element).toBeDefined();
  expect(facadeToHtml(element as unknown as never)).toEqual(before);
  expect(before).toContain('<main>');
});

test('the same streamed host with an admitted matching-version seed hydrates in place', () => {
  const matchingIdentity = `${PART_PROGRAM_VERSION}:deadbeef`;
  // The real streamed shell for a pending Part: the server executor owns the
  // range anchors the stream claim binds to.
  const shell = createStreamServerExecutor(
    streamProgram,
    { signals: { label: signal('Server') }, handlers: {} } as never,
    {
      owner: {
        program: streamProgram,
        version: streamProgram.version,
        instanceId: SERVER_INSTANCE,
      },
      pendingParts: [0],
    },
    { mode: 'light' },
  ).shell;
  const streamHtml = shell.replace(
    `<${STREAM_TAG}`,
    `<${STREAM_TAG} data-oe-stream-request="${SERVER_REQUEST}" ` +
      `data-oe-stream-program="${matchingIdentity}" data-oe-stream-instance="${SERVER_INSTANCE}"`,
  );

  let main: unknown;
  let earlyNode: unknown;
  let expected = '';
  const element = mountSerialized(dom, streamHtml, (host) => {
    // The frame arrived before the upgrade: the bootstrap filled the pending
    // range with the server value, so the seed is now resolved (parts [0],
    // pending empty) while the DOM carries the range's text node.
    main = host.childNodes[0];
    const children = (main as { childNodes: Array<{ data?: string }> }).childNodes;
    const end = children.find((node) => node.data === 'oe:/p0');
    earlyNode = dom.document.createTextNode('Server') as unknown as never;
    (main as { insertBefore(node: unknown, ref: unknown): void }).insertBefore(earlyNode, end);
    expected = facadeToHtml(host);
    Object.defineProperty(host, STREAM_STATE_KEY, {
      configurable: true,
      value: {
        request: SERVER_REQUEST,
        program: matchingIdentity,
        instance: SERVER_INSTANCE,
        properties: { label: { state: 'resolved', type: 'string', value: 'Server' } },
        parts: [0],
        pending: new Set<number>(),
        listen: () => () => {},
      },
    });
  }) as unknown as { label: string; childNodes: unknown[] };

  // Happy-path control for the touched kernel branch: an admitted seed of the
  // client's own version still claims the server DOM, in place.
  expect(element.label).toEqual('Server');
  expect(element.childNodes[0]).toBe(main);
  expect((main as { childNodes: unknown[] }).childNodes.includes(earlyNode)).toEqual(true);
  expect(facadeToHtml(element as unknown as never)).toEqual(expected);
});
