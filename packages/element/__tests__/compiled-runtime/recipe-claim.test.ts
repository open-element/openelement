/**
 * M07a — claimRecipe adopts an existing region.
 *
 * These probes are the runtime half of the first leaf-claim slice. They do
 * not execute generated code, do not cover SSR, and do not qualify TSX-18/30.
 */

import { beforeEach, expect, test } from 'vitest';
import { OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
import { signal } from '../../src/internal/signal/framework.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { bindSignalWrites } from '../../src/internal/compiled/runtime/bindings.ts';
import { claimRecipe, createRecipe } from '../../src/internal/compiled/runtime/recipe.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import { TestDocument, type TestElement, type TestText } from './test-dom.ts';

const asNode = (node: TestElement | TestText): Node => node as unknown as Node;

function capture(run: () => unknown): OpenElementError {
  try {
    run();
  } catch (error) {
    if (error instanceof OpenElementError) return error;
    throw error;
  }
  throw new Error('expected the claim to be rejected');
}

beforeEach(() => {
  runtimeProbe.reset();
});

function paragraph(
  doc: TestDocument,
  text: string,
): { parent: TestElement; element: TestElement; text: TestText } {
  const parent = doc.createElement('div');
  const element = doc.createElement('p');
  const node = doc.createTextNode(text);
  element.appendChild(node);
  parent.appendChild(element);
  return { parent, element, text: node };
}

test('claim adopts the existing node, subscribes once, and dispose(true) removes only that region', () => {
  const doc = new TestDocument();
  const { parent, element, text } = paragraph(doc, 'before');
  const host = new LifetimeScope();
  const count = signal(1);
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Leaf.tsx',
    claim(scope, _props, claimedParent) {
      const adopted = claimedParent.childNodes[0] as unknown as TestElement;
      const slot = adopted.childNodes[0] as unknown as TestText;
      slot.data = String(count.value);
      bindSignalWrites(scope, count, 'count', (value) => {
        slot.data = String(value);
      });
      return [asNode(adopted)];
    },
    mount() {
      throw new Error('mount must not run during claim');
    },
  });

  const before = runtimeProbe.snapshot();
  const projection = claimRecipe(host, recipe, asNode(parent));
  const after = runtimeProbe.snapshot();

  expect(projection.nodes).toEqual([asNode(element)]);
  expect(parent.childNodes).toEqual([element]);
  expect(text.data).toBe('1');
  expect(after.subscriptions - before.subscriptions).toBe(1);
  expect(after.projections - before.projections).toBe(1);
  expect(after.owners - before.owners).toBe(1);

  count.value = 4;
  expect(text.data).toBe('4');
  expect(runtimeProbe.snapshot().subscriptions - before.subscriptions).toBe(1);

  projection.dispose(false);
  expect(parent.childNodes).toEqual([element]);
  expect(runtimeProbe.snapshot().unsubscribed - before.unsubscribed).toBe(1);
  count.value = 9;
  expect(text.data).toBe('4');

  const again = paragraph(doc, 'kept');
  const second = claimRecipe(host, recipe, asNode(again.parent));
  second.dispose(true);
  expect(again.parent.childNodes).toEqual([]);
});

test('a claim that throws before subscribe leaves the DOM and adds no subscription', () => {
  const doc = new TestDocument();
  const { parent, element, text } = paragraph(doc, 'server');
  const host = new LifetimeScope();
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Leaf.tsx',
    claim() {
      throw new Error('OEIR_LEAF_CLAIM_MISMATCH: expected <p> at /0');
    },
    mount() {
      throw new Error('mount must not run');
    },
  });

  const before = runtimeProbe.snapshot();
  expect(() => claimRecipe(host, recipe, asNode(parent))).toThrow(/OEIR_LEAF_CLAIM_MISMATCH/);
  const after = runtimeProbe.snapshot();
  expect(parent.childNodes).toEqual([element]);
  expect(text.data).toBe('server');
  expect(after.subscriptions - before.subscriptions).toBe(0);
  expect(after.projections - before.projections).toBe(0);
  expect(after.unsubscribed - before.unsubscribed).toBe(0);
});

test('a claim that subscribes and then throws rolls the subscription back and keeps the DOM', () => {
  const doc = new TestDocument();
  const { parent, element, text } = paragraph(doc, 'server');
  const host = new LifetimeScope();
  const count = signal(1);
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Leaf.tsx',
    claim(scope) {
      bindSignalWrites(scope, count, 'count', () => {
        text.data = 'written';
      });
      throw new Error('OEIR_LEAF_CLAIM_MISMATCH: late');
    },
    mount() {
      throw new Error('mount must not run');
    },
  });

  const before = runtimeProbe.snapshot();
  expect(() => claimRecipe(host, recipe, asNode(parent))).toThrow(/late/);
  const after = runtimeProbe.snapshot();
  expect(after.subscriptions - before.subscriptions).toBe(1);
  expect(after.unsubscribed - before.unsubscribed).toBe(1);
  expect(parent.childNodes).toEqual([element]);
  expect(text.data).toBe('server');
  count.value = 3;
  expect(text.data).toBe('server');
});

test('lineage rejection happens before an owner is created and does not touch the DOM', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const child = doc.createTextNode('kept');
  parent.appendChild(child);
  const definition = new LifetimeScope();
  const recipe = createRecipe({
    definitionOwner: definition,
    source: 'fixtures/Leaf.tsx',
    claim() {
      throw new Error('claim must not run');
    },
    mount() {
      throw new Error('mount must not run');
    },
  });
  definition.dispose();
  const before = runtimeProbe.snapshot();
  const disposed = capture(() => claimRecipe(definition, recipe, asNode(parent)));
  expect(disposed.code).toBe('OE_KERNEL_DISPOSED');
  const foreign = new LifetimeScope();
  const stillDisposed = capture(() => claimRecipe(foreign, recipe, asNode(parent)));
  expect(stillDisposed.code).toBe('OE_KERNEL_DISPOSED');
  const live = new LifetimeScope();
  const other = new LifetimeScope();
  const cross = createRecipe({
    definitionOwner: live,
    source: 'fixtures/Leaf.tsx',
    claim() {
      return [];
    },
    mount() {
      return [];
    },
  });
  const rejected = capture(() => claimRecipe(other, cross, asNode(parent)));
  expect(rejected.code).toBe('OE_KERNEL_ROOT_NOT_OWNED');
  const after = runtimeProbe.snapshot();
  expect(after.owners - before.owners).toBe(0);
  expect(after.subscriptions - before.subscriptions).toBe(0);
  expect(after.lineageRejected - before.lineageRejected).toBe(3);
  expect(parent.childNodes).toEqual([child]);
});

test('validation failure writes nothing; activation failure may keep an earlier dynamic write', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const element = doc.createElement('p');
  element.setAttribute('data-n', 'server');
  parent.appendChild(element);
  const host = new LifetimeScope();

  const validate = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Leaf.tsx',
    claim() {
      throw new Error('OEIR_LEAF_CLAIM_MISMATCH: structure');
    },
    mount() {
      throw new Error('mount must not run');
    },
  });
  const beforeValidate = runtimeProbe.snapshot();
  expect(() => claimRecipe(host, validate, asNode(parent))).toThrow(/OEIR_LEAF_CLAIM_MISMATCH/);
  const afterValidate = runtimeProbe.snapshot();
  expect(element.getAttribute('data-n')).toBe('server');
  expect(parent.childNodes).toEqual([element]);
  expect(afterValidate.subscriptions - beforeValidate.subscriptions).toBe(0);
  expect(afterValidate.unsubscribed - beforeValidate.unsubscribed).toBe(0);

  const count = signal(4);
  const seen: number[] = [];
  const activate = createRecipe({
    definitionOwner: host,
    source: 'fixtures/Leaf.tsx',
    claim(scope) {
      element.setAttribute('data-n', String(count.value));
      bindSignalWrites(scope, count, 'count', (value) => {
        seen.push(Number(value));
        element.setAttribute('data-n', String(value));
      });
      throw new Error('OEIR_LEAF_CLAIM_MISMATCH: after write');
    },
    mount() {
      throw new Error('mount must not run');
    },
  });
  const beforeActivate = runtimeProbe.snapshot();
  expect(() => claimRecipe(host, activate, asNode(parent))).toThrow(/after write/);
  const afterActivate = runtimeProbe.snapshot();
  expect(element.getAttribute('data-n')).toBe('4');
  expect(parent.childNodes).toEqual([element]);
  expect(afterActivate.subscriptions - beforeActivate.subscriptions).toBe(1);
  expect(afterActivate.unsubscribed - beforeActivate.unsubscribed).toBe(1);
  count.value = 9;
  expect(seen).toEqual([]);
  expect(element.getAttribute('data-n')).toBe('4');
});

test('a recipe without claim fails before an owner is created', () => {
  const doc = new TestDocument();
  const parent = doc.createElement('div');
  const host = new LifetimeScope();
  const recipe = createRecipe({
    definitionOwner: host,
    source: 'fixtures/List.tsx',
    mount() {
      return [];
    },
  });
  const before = runtimeProbe.snapshot();
  const unavailable = capture(() => claimRecipe(host, recipe, asNode(parent)));
  expect(unavailable).toBeInstanceOf(OpenElementError);
  expect(unavailable.code).toBe(RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE);
  expect(unavailable.message).toContain('fixtures/List.tsx');
  const after = runtimeProbe.snapshot();
  expect(after.owners - before.owners).toBe(0);
  expect(after.lineageAccepted - before.lineageAccepted).toBe(1);
  expect(parent.childNodes).toEqual([]);
});
