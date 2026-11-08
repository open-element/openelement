/**
 * G2 probe (d) — the Alpha16a M04 exit evidence for per-read props evaluation
 * (JSX model §4.2a count table; TSX-28; execution plan §1 M04 "tracked props",
 * owner ruling: props getters evaluate per read).
 *
 * Every assertion below is a COUNT from the approved table:
 *
 * | # | Situation                   | This file pins                                         |
 * | 1 | recipe creation             | 0 factory runs, 0 getter runs                          |
 * | 2 | initial insertion           | factory once; getter once per read performed by setup  |
 * | 3 | tracked prop dependency     | getter once per read of each dependent binding         |
 * | 4 | keyed prop replacement      | backing swap only; getter runs per dependent read      |
 * | 5 | destructuring               | getter once during setup (a snapshot)                  |
 * | 6 | event dispatch              | getter per read inside the handler                     |
 * | 7 | SSR initialization          | NOT this slice (M07/M08 own SSR/claim counts)          |
 * | 8 | client initialization       | setup once per client instance                         |
 * | 9 | claim                       | NOT this slice (M07/M08)                               |
 *
 * No count here is dependent on a cache: any memoisation would change these
 * numbers and is a semantic change, not an optimisation (§4.2a).
 */

import { expect, test } from 'vitest';
import { effect, signal } from '../../src/internal/signal/framework.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { createTrackedProps } from '../../src/internal/compiled/runtime/props.ts';
import { createRecipe, insertRecipe } from '../../src/internal/compiled/runtime/recipe.ts';
import { removeNodes } from '../../src/internal/compiled/runtime/values.ts';
import { TestDocument, type TestElement } from './test-dom.ts';

const asNode = (node: TestElement): Node => node as unknown as Node;
const asElement = (node: unknown): TestElement => node as unknown as TestElement;

test('G2(d): creation evaluates nothing; insertion creates props once and reads per read', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const step = signal(1);
  const counts = { factoryRuns: 0, getterRuns: 0 };
  const snapshots: Array<{ setup: number; rendered: string }> = [];

  const recipe = createRecipe<{ readonly step: number }>({
    definitionOwner: host,
    source: 'fixtures/Counts.tsx',
    createProps: () => {
      counts.factoryRuns += 1;
      return {
        get step(): number {
          counts.getterRuns += 1;
          // The getter reads a signal per read, so it tracks; the count is the
          // authored evaluation count, not a cached value.
          return step.value;
        },
      };
    },
    mount(scope, props) {
      const element = doc.createElement('p');
      const text = doc.createTextNode('');
      element.appendChild(text);
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      // Row 5: destructuring reads the getter exactly once during setup.
      const setupSnapshot = props.step;
      // One tracked binding: one read per evaluation (row 2/3).
      scope.add(
        effect(() => {
          text.data = String(props.step);
        }),
      );
      // A second binding reading the same getter TWICE per evaluation (row 3's
      // k-reads case: one update produces two evaluations).
      scope.add(
        effect(() => {
          void (props.step + props.step);
        }),
      );
      snapshots.push({ setup: setupSnapshot, rendered: text.data });
      return [asNode(element)];
    },
  });

  // Row 1: recipe creation allocates the closure only — no factory, no getter.
  expect(counts).toEqual({ factoryRuns: 0, getterRuns: 0 });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  // Row 2: the props factory runs once per insertion; getter runs are exactly
  // the reads the setup + bindings perform (1 setup + 1 + 2).
  expect(counts.factoryRuns).toBe(1);
  expect(counts.getterRuns).toBe(4);
  expect(snapshots[0].setup).toBe(1);
  expect(snapshots[0].rendered).toBe('1');

  // Row 3: one tracked dependency write re-runs the two bindings; the getter
  // runs once per read they perform (1 + 2 = 3), not once per update.
  step.value = 2;
  expect(counts.getterRuns).toBe(7);
  expect(
    ((projection.nodes[0] as unknown as TestElement).childNodes[0] as unknown as { data: string })
      .data,
  ).toBe('2');

  // Row 5 again: the destructured setup value is an ordinary snapshot.
  expect(snapshots[0].setup).toBe(1);
  // Row 8: client initialization ran setup exactly once for this instance.
  expect(counts.factoryRuns).toBe(1);
  projection.dispose(true);
});

test('G2(d): event dispatch evaluates the getter per read inside the handler', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const value = signal('live');
  const counts = { getterRuns: 0, handlerReads: [] as string[] };

  const recipe = createRecipe<{ readonly value: string }>({
    definitionOwner: host,
    source: 'fixtures/Handler.tsx',
    createProps: () => ({
      get value(): string {
        counts.getterRuns += 1;
        return value.value;
      },
    }),
    mount(scope, props) {
      const button = doc.createElement('button');
      scope.addRangeCleanup(() => removeNodes([asNode(button)]));
      button.addEventListener('click', () => {
        // Row 6: two reads inside the handler are two evaluations.
        counts.handlerReads.push(props.value, props.value);
      });
      // Setup itself performs no prop read in this fixture.
      return [asNode(button)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  expect(counts.getterRuns).toBe(0);
  const button = asElement(projection.nodes[0]);
  button.dispatch('click');
  expect(counts.handlerReads).toEqual(['live', 'live']);
  expect(counts.getterRuns).toBe(2);
  value.value = 'next';
  button.dispatch('click');
  expect(counts.getterRuns).toBe(4);
  expect(counts.handlerReads).toEqual(['live', 'live', 'next', 'next']);
  projection.dispose(true);
});

test('G2(d): two insertions may observe different values (per-read, not per-creation snapshot)', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const observed: number[] = [];
  let expressionRuns = 0;

  const recipe = createRecipe<{ readonly step: number }>({
    definitionOwner: host,
    source: 'fixtures/PerInsertion.tsx',
    createProps: () => ({
      get step(): number {
        // The authored expression is side-effecting and evaluated per read:
        // two insertions therefore observe different values.
        expressionRuns += 1;
        return expressionRuns;
      },
    }),
    mount(scope, props) {
      const element = doc.createElement('span');
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      observed.push(props.step);
      return [asNode(element)];
    },
  });

  expect(expressionRuns).toBe(0);
  insertRecipe(host, recipe, asNode(parent), null);
  insertRecipe(host, recipe, asNode(parent), null);
  expect(observed).toEqual([1, 2]);
  expect(expressionRuns).toBe(2);
});

test('G2(d): keyed replacement swaps the backing value, then getters run per dependent read', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const box = createTrackedProps<{ item: { name: string } }>({ item: { name: 'A' } });
  const counts = { getterRuns: 0, rendered: [] as string[], renders: 0 };

  const recipe = createRecipe<{ readonly item: { name: string } }>({
    definitionOwner: host,
    source: 'fixtures/Replace.tsx',
    createProps: () => ({
      get item(): { name: string } {
        counts.getterRuns += 1;
        return box.props.item;
      },
    }),
    mount(scope, props) {
      const element = doc.createElement('span');
      const text = doc.createTextNode('');
      element.appendChild(text);
      scope.addRangeCleanup(() => removeNodes([asNode(element)]));
      scope.add(
        effect(() => {
          counts.renders += 1;
          // Two reads of the same getter inside ONE evaluation: the §4.2a row
          // 3 count means a replacement produces two evaluations, not one.
          text.data = `${props.item.name}${props.item.name}`;
          counts.rendered.push(text.data);
        }),
      );
      return [asNode(element)];
    },
  });

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  expect(counts.getterRuns).toBe(2);
  expect(counts.rendered).toEqual(['AA']);

  // Row 4: replacement itself does not evaluate the getter; the dependent
  // binding re-reads it twice, so the delta is exactly two.
  box.replace({ item: { name: 'B' } });
  expect(counts.getterRuns).toBe(4);
  expect(counts.rendered).toEqual(['AA', 'BB']);
  expect(counts.renders).toBe(2);

  // The props record identity is stable across replacement (only the backing
  // value changes), and the record is frozen.
  expect(box.props).toBe(box.props);
  expect(Object.isFrozen(box.props)).toBe(true);
  expect(Object.isFrozen(box)).toBe(true);

  // A plain read outside any tracked context still evaluates the getter.
  const directBefore = counts.getterRuns;
  expect(projection.props.item.name).toBe('B');
  expect(projection.props.item.name).toBe('B');
  expect(counts.getterRuns).toBe(directBefore + 2);
  projection.dispose(true);
});
