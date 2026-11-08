/**
 * G2 probes (a) and (b) — the Alpha16a M04 exit evidence for the generated-code
 * insertion primitive (execution plan §1 M04; JSX model §4/§4.1a/§4.2).
 *
 * (a) one recipe inserted twice creates two isolated owners, regions, private
 *     state and cleanups, and disposing one projection leaves the other live;
 * (b) keyed replacement reuses the DOM and the instance while the backing prop
 *     value is replaced: the instance is not re-created, a rendered binding
 *     re-runs, an event handler reads the replaced item at dispatch time, and a
 *     captured (stale) value stays provably stale.
 *
 * The G2 record cites these tests; they are runtime-primitive evidence only —
 * no generated code, claim/hydration or browser qualification is claimed.
 */

import { beforeEach, expect, test } from 'vitest';
import { effect, signal } from '../../src/internal/signal/framework.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { bindSignalWrites } from '../../src/internal/compiled/runtime/bindings.ts';
import { createTrackedProps } from '../../src/internal/compiled/runtime/props.ts';
import { createRecipe, insertRecipe } from '../../src/internal/compiled/runtime/recipe.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import { removeNodes } from '../../src/internal/compiled/runtime/values.ts';
import type { WritableSignal } from '../../src/internal/signal/types.ts';
import { TestDocument, type TestElement } from './test-dom.ts';

const asNode = (node: TestElement): Node => node as unknown as Node;
const asElement = (node: unknown): TestElement => node as unknown as TestElement;

beforeEach(() => {
  runtimeProbe.reset();
});

test('G2(a): one recipe inserted twice → two owners, regions, instances and cleanup sets', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const mounts: Array<{ privateSignal: WritableSignal<number>; element: TestElement }> = [];
  const cleanupRuns: string[] = [];
  let mountCount = 0;

  const recipe = createRecipe<{ label: string }>({
    definitionOwner: host,
    source: 'fixtures/Double.tsx',
    createProps: () => ({ label: 'instance' }),
    mount(scope, props) {
      mountCount += 1;
      const element = doc.createElement('span');
      const text = doc.createTextNode(props.label);
      element.appendChild(text);
      // A private signal per instance: the two instances must not share state.
      const privateSignal = signal(0);
      mounts.push({ privateSignal, element });
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      const cleanupId = `cleanup-${mountCount}`;
      scope.add(() => cleanupRuns.push(cleanupId));
      bindSignalWrites(scope, privateSignal, 'value', (value) => {
        text.data = String(value);
      });
      return [asNode(element)];
    },
  });

  const first = insertRecipe(host, recipe, asNode(parent), null);
  const second = insertRecipe(host, recipe, asNode(parent), null);

  expect(mountCount, 'one mount per insertion').toBe(2);
  expect(first.owner).not.toBe(second.owner);
  expect(first.owner.disposed).toBe(false);
  expect(second.owner.disposed).toBe(false);
  expect(first.region).not.toBe(second.region);
  expect(first.props).not.toBe(second.props);
  expect(first.nodes).toHaveLength(1);
  expect(second.nodes).toHaveLength(1);
  expect(parent.childNodes).toEqual([mounts[0].element, mounts[1].element]);
  expect(mounts[0].privateSignal).not.toBe(mounts[1].privateSignal);

  // A write to one instance's private signal updates only that instance.
  mounts[0].privateSignal.value = 7;
  expect((mounts[0].element.childNodes[0] as unknown as { data: string }).data).toBe('7');
  expect((mounts[1].element.childNodes[0] as unknown as { data: string }).data).toBe('instance');

  // Disposing one projection removes exactly its region and runs exactly its
  // cleanups; the sibling projection keeps its DOM, owner and subscriptions.
  first.dispose(true);
  expect(parent.childNodes).toEqual([mounts[1].element]);
  expect(cleanupRuns).toEqual(['cleanup-1']);
  expect(second.owner.disposed).toBe(false);
  mounts[1].privateSignal.value = 9;
  expect((mounts[1].element.childNodes[0] as unknown as { data: string }).data).toBe('9');

  second.dispose(true);
  expect(cleanupRuns).toEqual(['cleanup-1', 'cleanup-2']);
  expect(parent.childNodes).toEqual([]);

  const probe = runtimeProbe.snapshot();
  expect(probe.projections).toBe(2);
  expect(probe.regions).toBe(2);
  expect(probe.owners).toBe(2);
  expect(probe.nodes).toBe(2);
  expect(probe.rangeCleanups).toBe(2);
  expect(probe.disposed).toBe(2);
  // Each mount opened one write subscription on its own instance; both released.
  expect(probe.subscriptions).toBe(2);
  expect(probe.unsubscribed).toBe(2);
});

test('G2(a): an empty-output recipe still owns an empty region and disposes cleanly', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Empty.tsx',
    mount() {
      return [];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  expect(projection.nodes).toEqual([]);
  expect(parent.childNodes).toEqual([]);
  projection.dispose(true);
  expect(projection.owner.disposed).toBe(true);
  expect(runtimeProbe.snapshot().nodes).toBe(0);
});

test('G2(a): insertion honours the projection site position (before reference)', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const tail = doc.createElement('footer');
  parent.appendChild(tail);
  const host = new LifetimeScope();
  const made: TestElement[] = [];
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Position.tsx',
    mount() {
      const element = doc.createElement('span');
      made.push(element);
      return [asNode(element)];
    },
  });

  insertRecipe(host, recipe, asNode(parent), asNode(tail));
  insertRecipe(host, recipe, asNode(parent), asNode(tail));
  // Both regions land before the reference, in insertion-call order.
  expect(parent.childNodes).toEqual([made[0], made[1], tail]);
});

test('G2(a): a recipe is a frozen, non-traversable insertion description', () => {
  const host = new LifetimeScope();
  const call = createRecipe<{ label: string }>({
    definitionOwner: host,
    source: 'fixtures/RecipeShape.tsx',
    createProps: () => ({ label: 'x' }),
    mount() {
      return [];
    },
  });
  expect(Object.isFrozen(call)).toBe(true);
  expect(call.definitionOwner).toBe(host);
  expect(call.source).toBe('fixtures/RecipeShape.tsx');
  // No children list / node kind: the only way in is insertRecipe.
  expect(Object.keys(call).sort()).toEqual(['createProps', 'definitionOwner', 'mount', 'source']);
});

test('G2(b): keyed replacement keeps DOM + instance identity and the handler reads the new item', () => {
  interface Row {
    readonly id: string;
    readonly name: string;
  }

  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const box = createTrackedProps<{ item: Row }>({ item: { id: 'a', name: 'A' } });
  const counts = { mounts: 0, renders: 0 };
  const dispatched: Row[] = [];
  let staleCapture: Row | undefined;

  const recipe = createRecipe<{ readonly item: Row }>({
    definitionOwner: host,
    source: 'fixtures/Row.tsx',
    createProps: () => box.props,
    mount(scope, props) {
      counts.mounts += 1;
      // A deliberately stale capture (the failure mode TSX-04 names): a
      // handler closing over the value instead of reading the live prop.
      staleCapture = props.item;
      const element = doc.createElement('li');
      const text = doc.createTextNode('');
      element.appendChild(text);
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      // A tracked binding: re-evaluates when the read prop is replaced.
      scope.add(
        effect(() => {
          counts.renders += 1;
          text.data = props.item.name;
        }),
      );
      const button = doc.createElement('button');
      button.addEventListener('click', () => dispatched.push(props.item));
      element.appendChild(button);
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  const element = projection.nodes[0] as unknown as TestElement;
  const textNode = element.childNodes[0] as unknown as { data: string };
  const button = asElement(element.childNodes[1]);

  expect(counts.mounts).toBe(1);
  expect(textNode.data).toBe('A');
  button.dispatch('click');

  box.replace({ item: { id: 'a', name: 'B' } });

  // DOM identity preserved: same region node, same text node, updated in place.
  expect(projection.nodes[0]).toBe(asNode(element));
  expect(projection.nodes).toHaveLength(1);
  expect(element.childNodes[0]).toBe(textNode);
  expect(textNode.data).toBe('B');
  // Instance identity preserved: setup ran exactly once.
  expect(counts.mounts).toBe(1);
  // The rendered binding re-ran once for the replacement (one read per run).
  expect(counts.renders).toBe(2);
  button.dispatch('click');

  // The live-getter invariant: the handler sees the replaced item, while the
  // captured snapshot is provably stale (the negative this probe pins).
  expect(dispatched.map((row) => row.name)).toEqual(['A', 'B']);
  expect(staleCapture?.name).toBe('A');

  // No region/owner churn: keyed replacement is a backing-value swap.
  expect(projection.region).toBeGreaterThan(0);
  expect(projection.owner.disposed).toBe(false);
  projection.dispose(true);
  expect(parent.childNodes).toEqual([]);
});

test('G2(b): keyed replacement refreshes per-dispatch handlers without re-attaching listeners', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const box = createTrackedProps<{ item: number }>({ item: 1 });
  let listenerAdds = 0;
  const seen: number[] = [];

  const recipe = createRecipe<{ readonly item: number }>({
    definitionOwner: host,
    source: 'fixtures/Click.tsx',
    createProps: () => box.props,
    mount(scope, props) {
      const button = doc.createElement('button');
      const originalAdd = button.addEventListener.bind(button);
      button.addEventListener = (type, listener, options) => {
        listenerAdds += 1;
        originalAdd(type, listener, options);
      };
      button.addEventListener('click', () => seen.push(props.item));
      scope.addRangeCleanup(() => removeNodes([asNode(button)]));
      return [asNode(button)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  const button = projection.nodes[0] as unknown as TestElement;
  expect(listenerAdds).toBe(1);

  box.replace({ item: 2 });
  box.replace({ item: 3 });
  button.dispatch('click');

  expect(seen).toEqual([3]);
  expect(listenerAdds, 'replacement must not re-attach listeners').toBe(1);
  projection.dispose(true);
});

test('G2(b): a replacement does not re-run setup or touch unrelated private state', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const box = createTrackedProps<{ item: string }>({ item: 'first' });
  const privateState: Array<WritableSignal<number>> = [];
  let mounts = 0;

  const recipe = createRecipe<{ readonly item: string }>({
    definitionOwner: host,
    source: 'fixtures/Draft.tsx',
    createProps: () => box.props,
    mount(scope, props) {
      mounts += 1;
      const draft = signal(0);
      privateState.push(draft);
      const element = doc.createElement('p');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(
        effect(() => {
          element.setAttribute('data-item', props.item);
        }),
      );
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  privateState[0].value = 41;
  box.replace({ item: 'second' });

  expect(mounts).toBe(1);
  expect(privateState).toHaveLength(1);
  expect(privateState[0].value).toBe(41);
  expect((projection.nodes[0] as unknown as TestElement).getAttribute('data-item')).toBe('second');
  projection.dispose(true);
});
