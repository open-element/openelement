import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { createDeferredServerExecutor } from '../../src/internal/compiled/server/index.ts';
import {
  claimExistingDom,
  type CompiledRuntimeHost,
  PartProgramClaimError,
} from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { parseHtml, TestDocument, type TestElement, toHtml } from '../compiled-runtime/test-dom.ts';

const program = testProgram({
  tag: 'oe-stream-claim',
  rootMode: 'light',
  template: [{
    k: 'el',
    tag: 'main',
    attrs: [],
    children: [
      { k: 'text', value: 'Start ' },
      { k: 'part', index: 0 },
      { k: 'text', value: ' middle ' },
      { k: 'part', index: 1 },
      { k: 'text', value: ' end' },
    ],
  }],
  parts: [
    { k: 'text', index: 0, signal: 'title' },
    {
      k: 'when',
      index: 1,
      signal: 'enabled',
      test: { signal: 'enabled', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'strong', attrs: [], children: [{ k: 'text', value: 'Ready' }] }],
      off: [{ k: 'text', value: 'Waiting' }],
    },
  ],
});

function setup() {
  const title = signal('');
  const enabled = signal(false);
  const host = { signals: { title, enabled }, handlers: {} } as unknown as CompiledRuntimeHost;
  const owner = { program, version: program.version, instanceId: 'one' };
  const executor = createDeferredServerExecutor(
    program,
    host,
    { owner, pendingParts: [0, 1] },
    { mode: 'light' },
  );
  const doc = new TestDocument();
  const root = parseHtml(doc, executor.shell).childNodes[0] as TestElement;
  const main = root.childNodes[0] as TestElement;
  return { doc, root, main, host, title, enabled };
}

function endMarker(main: TestElement, index: number): Node {
  const end = main.childNodes.find((node) => 'data' in node && node.data === `oe:/p${index}`);
  if (!end) throw new Error(`missing test marker ${index}`);
  return end as unknown as Node;
}

Deno.test('streamed text arriving before claim adopts the original node', () => {
  const { doc, root, main, host, title } = setup();
  title.value = 'Early';
  const text = doc.createTextNode('Early');
  main.insertBefore(text, endMarker(main, 0) as never);
  const instance = claimExistingDom(program, host, root as unknown as Node, {
    streamParts: [0, 1],
    pendingParts: [1],
  });
  assertStrictEquals(main.childNodes[2], text);
  assertEquals(main.childNodes.some((node) => 'data' in node && node.data === 'oe:p1'), true);
  title.value = 'Updated';
  assertEquals(text.data, 'Updated');
  instance.dispose();
});

Deno.test('pending text and Region adopt after claim without touching siblings', () => {
  const { doc, root, main, host, title, enabled } = setup();
  const staticNode = main.childNodes[0];
  const instance = claimExistingDom(program, host, root as unknown as Node, {
    streamParts: [0, 1],
    pendingParts: [0, 1],
  });
  title.value = 'Late';
  const text = doc.createTextNode('Late');
  main.insertBefore(text, endMarker(main, 0) as never);
  instance.resolveDeferred?.(0);
  assertStrictEquals(main.childNodes[0], staticNode);
  assertStrictEquals(main.childNodes[2], text);
  title.value = 'Changed';
  assertEquals(text.data, 'Changed');
  assertThrows(() => instance.resolveDeferred?.(0), PartProgramClaimError);

  enabled.value = true;
  const strong = doc.createElement('strong');
  strong.appendChild(doc.createTextNode('Ready'));
  main.insertBefore(strong, endMarker(main, 1) as never);
  instance.resolveDeferred?.(1);
  assertStrictEquals(main.childNodes[0], staticNode);
  assertStrictEquals(
    main.childNodes.find((node) => node === strong),
    strong,
  );
  enabled.value = false;
  assertEquals(toHtml(root).includes('Waiting<!--oe:/p1-->'), true);
  instance.dispose();
});

Deno.test('streamed Region drift recovers inside its anchors only when opted in', () => {
  const { doc, root, main, host, enabled } = setup();
  const staticNode = main.childNodes[0];
  let mismatches = 0;
  const instance = claimExistingDom(program, host, root as unknown as Node, {
    streamParts: [0, 1],
    pendingParts: [0, 1],
    recovery: 'owning',
    onMismatch: () => mismatches++,
  });
  enabled.value = true;
  const wrong = doc.createElement('em');
  main.insertBefore(wrong, endMarker(main, 1) as never);
  instance.resolveDeferred?.(1);
  assertEquals(mismatches, 1);
  assertStrictEquals(main.childNodes[0], staticNode);
  assertEquals(toHtml(root).includes('<strong>Ready</strong><!--oe:/p1-->'), true);
  assertEquals(toHtml(root).includes('<em>'), false);
  instance.dispose();
});
