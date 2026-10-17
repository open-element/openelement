/**
 * A reconnect keeps a streamed instance's pending range alive.
 *
 * A streamed island claims a document whose deferred Parts are inert
 * anchor/end pairs; the frame fills them later and the facade calls
 * `resolveStreamPart(index)` per part. Suspending a streamed instance disposes
 * the scopes that own those ranges, so the reconnect must hand every still
 * pending range a live scope again (revive.ts) — otherwise a resumed streamed
 * island could never adopt its late frame.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import '../../src/internal/compiled/runtime/hydrate-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import {
  STREAM_STATE_KEY,
  type StreamHostState,
} from '../../src/internal/compiled/stream-state.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const STREAM_PROGRAM = testProgram({
  tag: 'oe-resume-stream',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

function streamedHost(message: { value: unknown }): {
  document: TestDocument;
  element: TestElement;
  div: TestElement;
  kernel: CompiledElementKernel;
} {
  const document = new TestDocument();
  const element = document.createElement('oe-resume-stream');
  const div = document.createElement('div');
  const anchor = document.createComment('oe:p0');
  const end = document.createComment('oe:/p0');
  div.appendChild(anchor);
  div.appendChild(end);
  element.appendChild(div);
  // The typed stream seed the claim path validates against the element's
  // attributes (stream-state.ts).
  const state: StreamHostState = {
    request: 'req-1',
    program: `${STREAM_PROGRAM.version}:seed-1`,
    instance: 'i1',
    properties: {},
    parts: [0],
    pending: new Set([0]),
    listen: () => () => {},
  };
  element.setAttribute('data-oe-stream-request', state.request);
  element.setAttribute('data-oe-stream-program', state.program);
  element.setAttribute('data-oe-stream-instance', state.instance);
  (element as unknown as Record<symbol, unknown>)[STREAM_STATE_KEY] = state;
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, STREAM_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'light',
  });
  return { document, element, div, kernel };
}

test('a resumed streamed instance can still resolve its pending Part', () => {
  const message = signal('');
  const { div, kernel } = streamedHost(message);

  const first = kernel.connect();
  expect(first.mode, 'the streamed document is a claim').toEqual('claim');
  expect(first.resumed).toBe(false);
  expect(toHtml(div), 'the pending range holds anchors only').toEqual(
    '<div><!--oe:p0--><!--oe:/p0--></div>',
  );

  kernel.disconnect();
  const resumed = kernel.connect();
  expect(resumed.resumed, 'the reconnect re-binds the same instance').toBe(true);
  expect(toHtml(div), 'the pending range survived the suspend').toEqual(
    '<div><!--oe:p0--><!--oe:/p0--></div>',
  );

  // The late frame arrives after the reconnect: the range must adopt it.
  expect(() => kernel.resolveStreamPart(0), 'the pending range is still resolvable').not.toThrow();
  message.value = 'late';
  expect(toHtml(div), 'the resolved range is bound and live').toEqual(
    '<div><!--oe:p0-->late<!--oe:/p0--></div>',
  );

  assertThrowsIncludes(
    () => kernel.resolveStreamPart(0),
    Error,
    'disposed or already resolved',
    'a resolved range is not adoptable twice',
  );
  kernel.dispose();
});

test('a resumed instance rejects a pending range whose anchors were damaged', () => {
  const message = signal('');
  const { div, kernel } = streamedHost(message);
  kernel.connect();
  kernel.disconnect();
  div.removeChild(div.childNodes[1]);

  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'expected <!--oe:/p0--> anchor',
    'a damaged pending range fails closed instead of being rebuilt',
  );
  expect(toHtml(div), 'the damaged range is left untouched').toEqual('<div><!--oe:p0--></div>');
  kernel.dispose();
});
