import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';

test('scope: abort precedes child and subscription cleanup', () => {
  const root = new LifetimeScope();
  const child = root.child();
  const events: string[] = [];
  root.signal.addEventListener('abort', () => events.push('abort'));
  child.add(() => events.push('child'));
  root.add(() => events.push('parent'));
  root.connect();

  root.dispose();
  root.dispose();
  expect(events).toEqual(['abort', 'child', 'parent']);
  expect(root.signal.aborted).toBeTruthy();
  expect(!root.active).toBeTruthy();
  expect(child.disposed).toBeTruthy();
  assertThrowsIncludes(() => root.child(), Error, 'disposed');
});

test('scope: cleanup errors do not strand sibling owners', () => {
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
  assertThrowsIncludes(() => root.dispose(), Error, 'first failure');
  expect(cleaned).toBeTruthy();
  expect(root.disposed).toBeTruthy();
  root.dispose();
});

test('scope: disconnect preserves owned range and replacement removes it', () => {
  let preserved = 0;
  const root = new LifetimeScope();
  const part = root.child();
  part.addRangeCleanup(() => preserved++);
  root.dispose();
  part.addRangeCleanup(() => preserved++);
  expect(preserved).toEqual(0);

  let removed = 0;
  const next = new LifetimeScope();
  const region = next.child();
  region.addRangeCleanup(() => removed++);
  region.dispose(true);
  region.addRangeCleanup(() => removed++);
  expect(removed).toEqual(2);
  next.dispose();
});

test('scope: a reconnect gets a distinct live signal', () => {
  const former = new LifetimeScope();
  const signal = former.signal;
  former.dispose();
  const next = new LifetimeScope();
  expect(signal.aborted).toBeTruthy();
  expect(!next.signal.aborted).toBeTruthy();
  expect(next.signal).not.toBe(signal);
  // The live getter is cached: every read hands back the same AbortSignal.
  const live = next.signal;
  expect(next.signal).toBe(live);
  // A disposed scope's current signal is aborted too
  // (lifetime-scope.ts:42), so "un-aborted" is what identifies the live one.
  expect(former.signal.aborted, 'the disposed scope never hands back a live signal').toBeTruthy();
  next.dispose();
  expect(live.aborted).toBeTruthy();
});

test('scope: animation frame is cancelled on dispose', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const cancelled: number[] = [];
  globalThis.requestAnimationFrame = () => 17;
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
  };
  try {
    const scope = new LifetimeScope();
    expect(scope.requestAnimationFrame(() => {})).toEqual(17);
    scope.dispose();
    expect(cancelled).toEqual([17]);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
