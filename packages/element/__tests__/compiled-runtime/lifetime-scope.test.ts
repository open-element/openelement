import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from '@std/assert';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';

Deno.test('scope: abort precedes child and subscription cleanup', () => {
  const root = new LifetimeScope();
  const child = root.child();
  const events: string[] = [];
  root.signal.addEventListener('abort', () => events.push('abort'));
  child.add(() => events.push('child'));
  root.add(() => events.push('parent'));
  root.connect();

  root.dispose();
  root.dispose();
  assertEquals(events, ['abort', 'child', 'parent']);
  assert(root.signal.aborted);
  assert(!root.active);
  assert(child.disposed);
  assertThrows(() => root.child(), Error, 'disposed');
});

Deno.test('scope: cleanup errors do not strand sibling owners', () => {
  const root = new LifetimeScope();
  const sibling = root.child();
  const failing = root.child();
  let cleaned = false;
  failing.add(() => {
    throw new Error('first failure');
  });
  sibling.add(() => {
    cleaned = true;
  });
  assertThrows(() => root.dispose(), Error, 'first failure');
  assert(cleaned);
  assert(root.disposed);
  root.dispose();
});

Deno.test('scope: disconnect preserves owned range and replacement removes it', () => {
  let preserved = 0;
  const root = new LifetimeScope();
  const part = root.child();
  part.addRangeCleanup(() => preserved++);
  root.dispose();
  part.addRangeCleanup(() => preserved++);
  assertEquals(preserved, 0);

  let removed = 0;
  const next = new LifetimeScope();
  const region = next.child();
  region.addRangeCleanup(() => removed++);
  region.dispose(true);
  region.addRangeCleanup(() => removed++);
  assertEquals(removed, 2);
  next.dispose();
});

Deno.test('scope: a reconnect gets a distinct live signal', () => {
  const former = new LifetimeScope();
  const signal = former.signal;
  former.dispose();
  const next = new LifetimeScope();
  assert(signal.aborted);
  assert(!next.signal.aborted);
  assertNotStrictEquals(next.signal, signal);
  // The live getter is cached: every read hands back the same AbortSignal.
  const live = next.signal;
  assertStrictEquals(next.signal, live);
  // A disposed scope's current signal is aborted too
  // (lifetime-scope.ts:42), so "un-aborted" is what identifies the live one.
  assert(former.signal.aborted, 'the disposed scope never hands back a live signal');
  next.dispose();
  assert(live.aborted);
});

Deno.test('scope: animation frame is cancelled on dispose', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const cancelled: number[] = [];
  globalThis.requestAnimationFrame = () => 17;
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
  };
  try {
    const scope = new LifetimeScope();
    assertEquals(scope.requestAnimationFrame(() => {}), 17);
    scope.dispose();
    assertEquals(cancelled, [17]);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
