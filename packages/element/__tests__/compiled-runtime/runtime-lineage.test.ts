/**
 * G2 probe (e) — the Alpha16a M04 exit evidence for the projection-lineage
 * check (JSX model §4.1c; TSX-25/TSX-26; execution plan §1 M04 "lineage check").
 *
 * Pinned here:
 *
 * - a projection at the definition owner itself and at a live descendant of it
 *   is accepted (the legal Alpha16 shapes);
 * - a projection from a sibling owner, another root/tree, or into a disposed
 *   owner fails closed with a CODED, source-located failure and no DOM write;
 * - a deferred insertion after the definition owner was disposed fails closed
 *   the same way (the captured signals must not write to dead scopes);
 * - a rejected projection creates no owner and no region (no orphan).
 */

import { beforeEach, expect, test } from 'vitest';
import { KernelErrorCode, OpenElementError } from '@openelement/protocol/errors';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import { createRecipe, insertRecipe } from '../../src/internal/compiled/runtime/recipe.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import { TestDocument, type TestElement } from './test-dom.ts';

const asNode = (node: TestElement): Node => node as unknown as Node;

beforeEach(() => {
  runtimeProbe.reset();
});

/** Run `run` and return the thrown OpenElementError (fails the test otherwise). */
function capture(run: () => unknown): OpenElementError {
  try {
    run();
  } catch (error) {
    if (error instanceof OpenElementError) return error;
    throw error;
  }
  throw new Error('expected the projection to be rejected');
}

function leafyRecipe(definitionOwner: LifetimeScope, source: string) {
  const doc = new TestDocument();
  const mounts = { count: 0 };
  const recipe = createRecipe({
    definitionOwner,
    source,
    mount() {
      mounts.count += 1;
      return [asNode(doc.createElement('span'))];
    },
  });
  return { recipe, mounts, doc };
}

test('G2(e): a projection at the definition owner itself is accepted', () => {
  const host = new LifetimeScope();
  const { recipe, mounts, doc } = leafyRecipe(host, 'fixtures/Self.tsx');
  const parent = doc.createElement('div');

  const projection = insertRecipe(host, recipe, asNode(parent), null);
  expect(mounts.count).toBe(1);
  expect(parent.childNodes).toHaveLength(1);
  expect(runtimeProbe.snapshot().lineageAccepted).toBe(1);
  projection.dispose(true);
});

test('G2(e): a projection at a live descendant of the definition owner is accepted', () => {
  const host = new LifetimeScope();
  // The definition site: a component instance owner, itself a child of the host.
  const definitionOwner = host.child();
  const { recipe, mounts, doc } = leafyRecipe(definitionOwner, 'fixtures/Descendant.tsx');
  // The projection site: a region owner inside the defining component's subtree.
  const projectionSite = definitionOwner.child();
  const parent = doc.createElement('div');

  const projection = insertRecipe(projectionSite, recipe, asNode(parent), null);
  expect(mounts.count).toBe(1);
  expect(parent.childNodes).toHaveLength(1);
  expect(runtimeProbe.snapshot().lineageAccepted).toBe(1);
  projection.dispose(true);
});

test('G2(e): a sibling-owner projection fails closed with OE_KERNEL_ROOT_NOT_OWNED', () => {
  const root = new LifetimeScope();
  const definitionOwner = root.child();
  const siblingOwner = root.child();
  const { recipe, mounts, doc } = leafyRecipe(definitionOwner, 'fixtures/CrossOwner.tsx');
  const parent = doc.createElement('div');

  const error = capture(() => insertRecipe(siblingOwner, recipe, asNode(parent), null));
  expect(error.code).toBe(KernelErrorCode.ROOT_NOT_OWNED);
  expect(error.message).toContain('fixtures/CrossOwner.tsx');
  expect(error.message).toContain('cross-owner projection is not supported');
  expect(mounts.count, 'a rejected projection never mounts').toBe(0);
  expect(parent.childNodes).toEqual([]);
  // Rejected before any owner/region exists: no orphan scope, no cleanup work.
  expect(runtimeProbe.snapshot().owners).toBe(0);
  expect(runtimeProbe.snapshot().regions).toBe(0);
  expect(runtimeProbe.snapshot().lineageRejected).toBe(1);
});

test('G2(e): a projection into another owner tree fails closed', () => {
  const definitionRoot = new LifetimeScope();
  const otherRoot = new LifetimeScope();
  const { recipe, mounts, doc } = leafyRecipe(definitionRoot, 'fixtures/OtherTree.tsx');
  const parent = doc.createElement('div');

  const error = capture(() => insertRecipe(otherRoot, recipe, asNode(parent), null));
  expect(error.code).toBe(KernelErrorCode.ROOT_NOT_OWNED);
  expect(mounts.count).toBe(0);
  expect(parent.childNodes).toEqual([]);
});

test('G2(e): a projection of a recipe whose definition owner was disposed fails closed', () => {
  const root = new LifetimeScope();
  const definitionOwner = root.child();
  const { recipe, mounts, doc } = leafyRecipe(definitionOwner, 'fixtures/DeadDefinition.tsx');
  const parent = doc.createElement('div');
  definitionOwner.dispose();

  const error = capture(() => insertRecipe(root, recipe, asNode(parent), null));
  expect(error.code).toBe(KernelErrorCode.DISPOSED);
  expect(error.message).toContain('definition owner was disposed');
  expect(error.message).toContain('fixtures/DeadDefinition.tsx');
  expect(mounts.count).toBe(0);
  expect(parent.childNodes).toEqual([]);
});

test('G2(e): a projection into a disposed owner fails closed', () => {
  const host = new LifetimeScope();
  const { recipe, mounts, doc } = leafyRecipe(host, 'fixtures/DeadSite.tsx');
  const parent = doc.createElement('div');
  const projectionSite = host.child();
  projectionSite.dispose();

  const error = capture(() => insertRecipe(projectionSite, recipe, asNode(parent), null));
  expect(error.code).toBe(KernelErrorCode.DISPOSED);
  expect(error.message).toContain('disposed owner');
  expect(mounts.count).toBe(0);
  expect(parent.childNodes).toEqual([]);
});

test('G2(e): deferred insertion after definition disposal fails closed and writes no DOM', () => {
  const root = new LifetimeScope();
  const definitionOwner = root.child();
  const { recipe, mounts, doc } = leafyRecipe(definitionOwner, 'fixtures/Deferred.tsx');
  const parent = doc.createElement('div');

  // A recipe is created while the definition owner is alive, then inserted
  // later — the deferred-insertion case (TSX-25). Disposal in between must not
  // produce an instance that outlives the state its getters read.
  const before = runtimeProbe.snapshot();
  expect(before.lineageAccepted).toBe(0);
  definitionOwner.dispose();
  const error = capture(() => insertRecipe(root, recipe, asNode(parent), null));
  expect(error.code).toBe(KernelErrorCode.DISPOSED);
  expect(mounts.count).toBe(0);
  expect(parent.childNodes).toEqual([]);
  // No write to the parent, no region, no owner: the deferred insertion is
  // rejected before it can create anything.
  expect(runtimeProbe.snapshot().regions).toBe(0);
  expect(runtimeProbe.snapshot().owners).toBe(0);
});
