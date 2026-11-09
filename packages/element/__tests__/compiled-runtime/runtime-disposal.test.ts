/**
 * G2 probe (c) — the Alpha16a M04 exit evidence for disposal modes and
 * exception-safe setup/rollback (JSX model §4.1a/§4.1b, TSX-27; execution plan
 * §1 M04 "disposal modes").
 *
 * Pinned here:
 *
 * - default disposal releases resources but KEEPS the owned DOM — the
 *   disconnect/suspend behaviour the revive path (`runtime/revive.ts`) depends
 *   on; detach mode (`dispose(true)`) additionally removes the region;
 * - parent disposal cascades with its mode (children inherit it);
 * - a throwing cleanup does not stop the remaining cleanups and the first error
 *   surfaces once;
 * - every §4.1b failure row: before the first node, after partial DOM, after
 *   subscriptions, after listeners, during insertion into the parent, during
 *   nested component setup, and inside one cleanup while others remain.
 */

import { beforeEach, expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { bindSignalWrites } from '../../src/internal/compiled/runtime/bindings.ts';
import { createRecipe, insertRecipe } from '../../src/internal/compiled/runtime/recipe.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import { removeNodes } from '../../src/internal/compiled/runtime/values.ts';
import { TestDocument, type TestElement } from './test-dom.ts';

const asNode = (node: TestElement): Node => node as unknown as Node;

beforeEach(() => {
  runtimeProbe.reset();
});

test('G2(c): default disposal keeps the owned DOM (the revive dependency) and releases resources', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const source = signal(0);
  const observed: number[] = [];
  const cleanups: string[] = [];

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Suspend.tsx',
    mount(scope) {
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => cleanups.push('resource'));
      bindSignalWrites(scope, source, 'value', (value) => observed.push(Number(value)));
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  const element = projection.nodes[0] as unknown as TestElement;
  source.value = 1;
  expect(observed).toEqual([1]);

  // Suspend: plain dispose. The region stays in the document for a reconnect,
  // every live resource is gone (a write after disposal touches no DOM and no
  // handler), and the disposal is idempotent.
  projection.dispose();
  expect(cleanups).toEqual(['resource']);
  expect(projection.owner.disposed).toBe(true);
  expect(parent.childNodes).toEqual([element]);
  expect(element.parentNode).not.toBeNull();
  source.value = 2;
  expect(observed).toEqual([1]);
  expect(runtimeProbe.snapshot().unsubscribed).toBe(1);
  projection.dispose(true);
  // Second dispose is a no-op. `false` does not upgrade to `true`: the range
  // cleanup was released with the plain disposal, so the region cannot be
  // removed through this handle afterwards, and no second cleanup runs.
  expect(parent.childNodes).toEqual([element]);
  expect(cleanups).toEqual(['resource']);
});

test('G2(c): detach mode disposes the complete scope AND removes the owned region', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const order: string[] = [];

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Detach.tsx',
    mount(scope) {
      const element = doc.createElement('span');
      const text = doc.createTextNode('owned');
      element.appendChild(text);
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => order.push('resource'));
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  projection.dispose(true);
  expect(order).toEqual(['resource']);
  expect(parent.childNodes).toEqual([]);
  expect((projection.nodes[0] as unknown as TestElement).parentNode).toBeNull();
  projection.dispose(true);
  expect(order).toEqual(['resource']);
});

test('G2(c): parent disposal cascades to every projection with the parents mode', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const cleanups: string[] = [];
  let mounts = 0;

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Cascade.tsx',
    mount(scope) {
      mounts += 1;
      const id = mounts;
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => cleanups.push(`resource-${id}`));
      return [asNode(element)];
    },
  });

  insertRecipe(host, recipe, asNode(parent), null);
  insertRecipe(host, recipe, asNode(parent), null);
  expect(parent.childNodes).toHaveLength(2);

  // Plain parent disposal: resources released in child insertion order, DOM kept.
  host.dispose();
  expect(cleanups).toEqual(['resource-1', 'resource-2']);
  expect(parent.childNodes).toHaveLength(2);

  // Detach-mode parent disposal: the same full disposal plus the ranges.
  const secondParent = doc.createElement('div');
  const secondHost = new LifetimeScope();
  const secondCleanups: string[] = [];
  let secondMounts = 0;
  const secondRecipe = createRecipe({
    definitionOwner: secondHost,
    source: 'fixtures/CascadeDetach.tsx',
    mount(scope) {
      secondMounts += 1;
      const id = secondMounts;
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => secondCleanups.push(`resource-${id}`));
      return [asNode(element)];
    },
  });
  insertRecipe(secondHost, secondRecipe, asNode(secondParent), null);
  insertRecipe(secondHost, secondRecipe, asNode(secondParent), null);
  secondHost.dispose(true);
  expect(secondCleanups).toEqual(['resource-1', 'resource-2']);
  expect(secondParent.childNodes).toEqual([]);
});

test('G2(c): parent dispose(true) cascades only to still-live children, not one already disposed false', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const cleanups: string[] = [];
  let mounts = 0;

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/CascadeLive.tsx',
    mount(scope) {
      mounts += 1;
      const id = mounts;
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => cleanups.push(`resource-${id}`));
      return [asNode(element)];
    },
  });

  const suspended = insertRecipe(host, recipe, asNode(parent), null);
  const live = insertRecipe(host, recipe, asNode(parent), null);
  const kept = suspended.nodes[0] as unknown as TestElement;
  suspended.dispose(false);
  expect(cleanups).toEqual(['resource-1']);
  expect(parent.childNodes).toEqual([kept, live.nodes[0]]);

  host.dispose(true);
  expect(cleanups).toEqual(['resource-1', 'resource-2']);
  expect(parent.childNodes).toEqual([kept]);
  expect(kept.parentNode).not.toBeNull();
  expect((live.nodes[0] as unknown as TestElement).parentNode).toBeNull();

  suspended.dispose(true);
  expect(parent.childNodes).toEqual([kept]);
  expect(cleanups).toEqual(['resource-1', 'resource-2']);
});

test('G2(c): a throwing cleanup does not stop the remaining ones and the first error surfaces', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const ran: string[] = [];

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/ThrowingCleanup.tsx',
    mount(scope) {
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      // Registration order is A then B; disposal is LIFO, so B runs first and
      // the throwing A is the last cleanup attempted.
      scope.add(() => {
        ran.push('a');
        throw new Error('cleanup a failed');
      });
      scope.add(() => ran.push('b'));
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  assertThrowsIncludes(() => projection.dispose(true), Error, 'cleanup a failed');
  expect(ran).toEqual(['b', 'a']);
  // The region still came out: the insert-owned range cleanup runs first (LIFO).
  expect(parent.childNodes).toEqual([]);
});

test('G2(c) failure matrix: setup before the first node rolls back with no orphan region', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/ThrowsEarly.tsx',
    mount(): Node[] {
      throw new Error('setup failed before any node');
    },
  });

  assertThrowsIncludes(() => insertRecipe(host, recipe, asNode(parent)), Error, 'setup failed');
  expect(parent.childNodes).toEqual([]);
  expect(runtimeProbe.snapshot().owners).toBe(1);
  expect(runtimeProbe.snapshot().projections).toBe(0);
});

test('G2(c) failure matrix: partial DOM and subscriptions are released on a setup throw', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const source = signal(0);
  const observed: number[] = [];
  let detached: TestElement | undefined;
  let listenerRemovals = 0;

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/ThrowsLate.tsx',
    mount(scope): Node[] {
      detached = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(detached!)]));
      bindSignalWrites(scope, source, 'value', (value) => observed.push(Number(value)));
      const listener = (): void => observed.push(-1);
      detached.addEventListener('click', listener);
      scope.add(() => {
        listenerRemovals += 1;
        detached!.removeEventListener('click', listener);
      });
      throw new Error('partial setup failed');
    },
  });

  assertThrowsIncludes(() => insertRecipe(host, recipe, asNode(parent)), Error, 'partial setup');
  expect(detached?.parentNode).toBeNull();
  expect(parent.childNodes).toEqual([]);
  // The subscription and the listener were released: a later write and a later
  // dispatch reach nothing (no writes to a dead region).
  source.value = 1;
  detached?.dispatch('click');
  expect(observed).toEqual([]);
  expect(listenerRemovals).toBe(1);
  expect(runtimeProbe.snapshot().projections).toBe(0);
  expect(runtimeProbe.snapshot().unsubscribed).toBe(1);
});

test('G2(c) failure matrix: a throw during insertion into the parent removes the partial range', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const originalInsertBefore = parent.insertBefore.bind(parent);
  let insertCalls = 0;
  parent.insertBefore = ((node: never, reference: never) => {
    insertCalls += 1;
    // The first node lands, the second insertion fails: the parent ends up with
    // a partial region that the rollback must remove.
    if (insertCalls === 2) throw new Error('parent insertion failed');
    return originalInsertBefore(node, reference);
  }) as typeof parent.insertBefore;

  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/InsertFails.tsx',
    mount() {
      return [asNode(doc.createElement('i')), asNode(doc.createElement('b'))];
    },
  });

  assertThrowsIncludes(
    () => insertRecipe(host, recipe, asNode(parent), null),
    Error,
    'parent insertion failed',
  );
  expect(parent.childNodes).toEqual([]);
  expect(runtimeProbe.snapshot().projections).toBe(0);
});

test('G2(c) failure matrix: a nested setup failure rolls the inner scope back first', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const innerRuns: string[] = [];
  const outerRuns: string[] = [];

  const innerRecipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Inner.tsx',
    mount(scope) {
      const element = doc.createElement('em');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(() => innerRuns.push('inner'));
      throw new Error('nested setup failed');
    },
  });

  const outerRecipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Outer.tsx',
    mount(scope) {
      const container = doc.createElement('div');
      scope.addRangeCleanup(() => removeNodes([asNode(container)]));
      scope.add(() => outerRuns.push('outer'));
      // A nested insertion site inside the mount: its own owner, rolled back
      // before the outer projection when it throws.
      insertRecipe(scope, innerRecipe, asNode(container), null);
      return [asNode(container)];
    },
  });

  assertThrowsIncludes(
    () => insertRecipe(host, outerRecipe, asNode(parent)),
    Error,
    'nested setup',
  );
  expect(parent.childNodes).toEqual([]);
  // Inner rollback ran before the outer one.
  expect(innerRuns).toEqual(['inner']);
  expect(outerRuns).toEqual(['outer']);
});

test('G2(c) failure matrix: a throwing cleanup during rollback is suppressed, the setup error survives', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const ran: string[] = [];
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/ThrowsAndFails.tsx',
    mount(scope): Node[] {
      scope.add(() => {
        ran.push('throwing-cleanup');
        throw new Error('cleanup during rollback failed');
      });
      scope.add(() => ran.push('remaining-cleanup'));
      throw new Error('the real setup error');
    },
  });

  assertThrowsIncludes(
    () => insertRecipe(host, recipe, asNode(parent)),
    Error,
    'the real setup error',
  );
  expect(ran).toEqual(['remaining-cleanup', 'throwing-cleanup']);
  expect(parent.childNodes).toEqual([]);
});
