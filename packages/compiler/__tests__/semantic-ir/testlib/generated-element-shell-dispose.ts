import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { DEFINE_PROFILE, type ProbeSnapshot } from './generated-element-shell-fixture.ts';

interface DisposeResult {
  before: ProbeSnapshot;
  afterDispose: ProbeSnapshot;
  disposed: { childCount: number; disconnected: boolean };
  afterWrite: { childCount: number; text: string };
  remounted: { childCount: number; text: string; sameNode: boolean };
  afterRemount: ProbeSnapshot;
}

interface OwnershipDisposeResult {
  generatedRemoved: boolean;
  externalKept: boolean;
  mountedChildCount: number;
  neverMountedKept: boolean;
  failedClaimKept: boolean;
  disconnectedOwnedRemoved: boolean;
  disconnectedExternalKept: boolean;
  disconnectedChildCount: number;
  plainDisposeKept: boolean;
  defaultOwnedRemoved: boolean;
  defaultExternalKept: boolean;
  defaultChildCount: number;
  errors: number;
}

interface CleanupErrorResult {
  cleanupOrder: string[];
  errors: string[];
}

export function describeDispose(openPage: () => Promise<Page>): void {
  describe('teardown and ownership', () => {
    test('explicit dispose(true) removes the region; a later connect mounts a fresh one', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          ${DEFINE_PROFILE}
          document.body.innerHTML = '';
          const el = document.createElement('oe-m09-profile');
          el.setAttribute('label', 'hello');
          el.setAttribute('count', '2');
          el.setAttribute('enabled', '');
          document.body.append(el);
          const first = el.firstElementChild;
          const before = mod.runtimeProbe.snapshot();
          el.dispose(true);
          const afterDispose = mod.runtimeProbe.snapshot();
          const disposed = {
            childCount: el.childNodes.length,
            disconnected: el.isConnected,
          };
          el.count = 8;
          const afterWrite = { childCount: el.childNodes.length, text: el.textContent };
          document.body.append(el);
          const remounted = {
            childCount: el.childNodes.length,
            text: el.textContent,
            sameNode: el.firstElementChild === first,
          };
          const afterRemount = mod.runtimeProbe.snapshot();
          return { before, afterDispose, disposed, afterWrite, remounted, afterRemount };
        })()`)) as DisposeResult;

        expect(result.disposed).toMatchObject({ childCount: 0, disconnected: true });
        expect(result.afterDispose.disposed - result.before.disposed).toBe(1);
        expect(result.afterDispose.unsubscribed).toBeGreaterThan(result.before.unsubscribed);
        expect(result.afterWrite).toMatchObject({ childCount: 0, text: '' });
        expect(result.remounted).toMatchObject({
          childCount: 1,
          text: 'hello',
          sameNode: false,
        });
        expect(result.afterRemount.owners).toBeGreaterThan(result.afterDispose.owners);
        expect(result.afterRemount.projections).toBeGreaterThan(result.afterDispose.projections);
      } finally {
        await page.close();
      }
    });

    test('dispose(true) removes only the projection-owned region, never external or borrowed DOM', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          ${DEFINE_PROFILE}
          document.body.innerHTML = '';
          const errors = [];
          window.addEventListener('error', (event) => {
            errors.push(event.error?.message ?? event.message);
          });
          const mountedProfile = () => {
            const el = document.createElement('oe-m09-profile');
            el.setAttribute('label', 'hello');
            el.setAttribute('count', '2');
            el.setAttribute('enabled', '');
            document.body.append(el);
            return el;
          };

          // 1. External sibling appended by the host: not projection-owned.
          const mounted = mountedProfile();
          const owned = mounted.firstElementChild;
          const external = document.createElement('span');
          external.id = 'external';
          external.textContent = 'external';
          mounted.append(external);
          mounted.dispose(true);

          // 2. Never connected: nothing was ever mounted or claimed.
          const neverMounted = document.createElement('oe-m09-profile');
          neverMounted.innerHTML = '<b id="borrowed">borrowed</b>';
          const borrowed = neverMounted.firstElementChild;
          neverMounted.dispose(true);

          // 3. Failed claim: the borrowed server DOM was never adopted.
          const failedClaim = document.createElement('oe-m09-profile');
          failedClaim.setAttribute('label', 'server');
          failedClaim.innerHTML = '<p id="wrong">server</p>';
          const wrong = failedClaim.firstElementChild;
          document.body.append(failedClaim);
          await new Promise((resolve) => setTimeout(resolve, 0));
          failedClaim.dispose(true);

          // 4. Disconnect retained the generated region: teardown still knows
          //    exactly which nodes it owns (not every current child).
          const disconnected = mountedProfile();
          const disconnectedOwned = disconnected.firstElementChild;
          const disconnectedExternal = document.createElement('i');
          disconnectedExternal.id = 'kept';
          disconnected.append(disconnectedExternal);
          disconnected.remove();
          disconnected.dispose(true);

          // 5. A plain dispose released ownership: a later dispose(true) must
          //    not upgrade that released handle into a detach of retained DOM.
          const plain = mountedProfile();
          const plainOwned = plain.firstElementChild;
          plain.dispose(false);
          plain.dispose(true);

          // 6. The default argument is detach mode, still projection-scoped.
          const defaulted = mountedProfile();
          const defaultedOwned = defaulted.firstElementChild;
          const defaultExternal = document.createElement('u');
          defaultExternal.id = 'default-external';
          defaulted.append(defaultExternal);
          defaulted.dispose();

          return {
            generatedRemoved: !mounted.contains(owned),
            externalKept: mounted.contains(external),
            mountedChildCount: mounted.childNodes.length,
            neverMountedKept: neverMounted.contains(borrowed) && neverMounted.childNodes.length === 1,
            failedClaimKept: failedClaim.contains(wrong) && failedClaim.childNodes.length === 1,
            disconnectedOwnedRemoved: !disconnected.contains(disconnectedOwned),
            disconnectedExternalKept: disconnected.contains(disconnectedExternal),
            disconnectedChildCount: disconnected.childNodes.length,
            plainDisposeKept: plain.contains(plainOwned) && plain.childNodes.length === 1,
            defaultOwnedRemoved: !defaulted.contains(defaultedOwned),
            defaultExternalKept: defaulted.contains(defaultExternal),
            defaultChildCount: defaulted.childNodes.length,
            errors: errors.length,
          };
        })()`)) as OwnershipDisposeResult;

        expect(result.generatedRemoved).toBe(true);
        expect(result.externalKept).toBe(true);
        expect(result.mountedChildCount).toBe(1);
        expect(result.neverMountedKept).toBe(true);
        expect(result.failedClaimKept).toBe(true);
        expect(result.disconnectedOwnedRemoved).toBe(true);
        expect(result.disconnectedExternalKept).toBe(true);
        expect(result.disconnectedChildCount).toBe(1);
        expect(result.plainDisposeKept).toBe(true);
        expect(result.defaultOwnedRemoved).toBe(true);
        expect(result.defaultExternalKept).toBe(true);
        expect(result.defaultChildCount).toBe(1);
        // Only the failed claim reports; the dispose paths stay quiet.
        expect(result.errors).toBe(1);
      } finally {
        await page.close();
      }
    });

    test('cleanup exceptions never replace the original teardown/setup error', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          const cleanupOrder = [];
          const errors = [];
          const onError = (event) => errors.push(event.error?.message ?? event.message);
          window.addEventListener('error', onError);

          mod.defineGeneratedElement({
            tag: 'oe-m09-cleanup-throw',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createRecipe: (owner, host) => {
              owner.add(() => {
                cleanupOrder.push('root');
                throw new Error('root-cleanup');
              });
              const base = mod.createProfileRecipe(owner, host);
              return {
                ...base,
                mount: (scope, props) => {
                  scope.add(() => {
                    cleanupOrder.push('projection');
                    throw new Error('projection-cleanup');
                  });
                  return base.mount(scope, props);
                },
              };
            },
          });
          const el = document.createElement('oe-m09-cleanup-throw');
          el.setAttribute('label', 'x');
          document.body.append(el);
          el.remove();
          await new Promise((resolve) => setTimeout(resolve, 0));

          mod.defineGeneratedElement({
            tag: 'oe-m09-connect-throw',
            properties: [],
            createRecipe: (owner) => {
              owner.add(() => {
                cleanupOrder.push('connect-root');
                throw new Error('cleanup-after-origin');
              });
              throw new Error('origin-error');
            },
          });
          const failing = document.createElement('oe-m09-connect-throw');
          document.body.append(failing);
          await new Promise((resolve) => setTimeout(resolve, 0));

          window.removeEventListener('error', onError);
          return { cleanupOrder, errors };
        })()`)) as CleanupErrorResult;

        // Both cleanup chains were attempted, in teardown order.
        expect(result.cleanupOrder).toEqual(['projection', 'root', 'connect-root']);
        // The first teardown error survives; the later root cleanup error does
        // not replace it. Setup rollback still rethrows the setup error.
        expect(result.errors[0]).toBe('projection-cleanup');
        expect(result.errors[1]).toBe('origin-error');
      } finally {
        await page.close();
      }
    });

    /**
     * T6 / `16b-LC retained-child` — owner teardown releases retained children EXPLICITLY.
     *
     * Hand-written descriptor fixture (same evidence class as the LC-0 rows): the
     * recipe retains one real child instance through the SAME private ledger the
     * generated root body consumes. The observed ordering proves the shell's
     * placement contract:
     *
     * - `releaseRetainedChildren(instance)` runs AFTER the pre-existing
     *   projection/connection/range steps and BEFORE `instance.dispose(...)`, so a
     *   retained cleanup observes `instance.disposed === false` (a cascade-only
     *   implementation would observe `true`), and the release error wins over a
     *   later `instance.dispose` error (`captureCleanupFailures` keeps the FIRST
     *   error);
     * - the same ordering holds for `dispose(false)` and for the failed-first-
     *   connect rollback, and the retained entry is gone afterwards (a retain on
     *   the destroyed owner fails closed, an explicit release is a no-op, and no
     *   `OEIR_INSTANCE_LEDGER_*` identity leaks);
     * - this row makes NO GC assertion: the release is explicit and observable.
     */
    test('LC-2 owner teardown releases retained children before instance.dispose (no GC assumption)', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          const mod = window.__oeM09;
          const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
          const grab = (code) => {
            try {
              code();
              return null;
            } catch (error) {
              if (error && error.code) return error.code;
              return error instanceof Error ? error.message : String(error);
            }
          };
          const snapshot = () => {
            const errors = [];
            const onError = (event) => {
              errors.push(event.error && event.error.message ? event.error.message : event.message);
            };
            window.addEventListener('error', onError);
            return { errors, stop: () => window.removeEventListener('error', onError) };
          };

          // ── A) dispose(true): ordering + first-error precedence ──────────────
          const orderA = [];
          let instanceA = null;
          let retainedA = null;
          const ctorA = mod.defineGeneratedElement({
            tag: 'oe-lc2-teardown-detach',
            createInstance: (owner) => {
              instanceA = owner;
              owner.add(() => {
                orderA.push('instance-cleanup');
                throw new Error('instance cleanup boom');
              });
              return {};
            },
            createRecipe: (owner, host) =>
              mod.createRecipe({
                definitionOwner: owner,
                source: 'lc2-teardown',
                mount(scope) {
                  retainedA = mod.retainChildInstance(host.instance, 'lc2:site', scope, (childScope) => {
                    childScope.add(() => {
                      orderA.push('child-cleanup:' + String(instanceA && instanceA.disposed));
                      throw new Error('child cleanup boom');
                    });
                    return { value: 1 };
                  });
                  return [document.createElement('span')];
                },
              }),
          });
          const hostA = document.createElement('oe-lc2-teardown-detach');
          document.body.append(hostA);
          await tick();
          const beforeDisposeA = {
            disposed: retainedA.scope.disposed,
            hasRangeCleanupOwner: hostA.firstChild !== null,
          };
          const teardownA = grab(() => hostA.dispose(true));
          const afterDisposeA = {
            retainedDisposed: retainedA.scope.disposed,
            instanceDisposed: instanceA.disposed,
            domRemoved: hostA.firstChild === null,
            // The owner is gone: a fresh retain fails closed and both release paths
            // are no-ops (the ledger was released, not left to GC).
            retainAfter: grab(() => mod.retainChildInstance(instanceA, 'lc2:site', null, () => ({}))),
            releaseAfter: grab(() => mod.releaseChildInstance(instanceA, 'lc2:site')),
            structuralReleaseAfter: grab(() => mod.releaseUnderStructuralScope(null)),
          };

          // ── B) dispose(false): same release-before-dispose ordering ──────────
          const orderB = [];
          let instanceB = null;
          let retainedB = null;
          const ctorB = mod.defineGeneratedElement({
            tag: 'oe-lc2-teardown-plain',
            createInstance: (owner) => {
              instanceB = owner;
              owner.add(() => orderB.push('instance-cleanup'));
              return {};
            },
            createRecipe: (owner, host) =>
              mod.createRecipe({
                definitionOwner: owner,
                source: 'lc2-teardown-plain',
                mount(scope) {
                  retainedB = mod.retainChildInstance(host.instance, 'lc2:plain', scope, (childScope) => {
                    childScope.add(() => {
                      orderB.push('child-cleanup:' + String(instanceB && instanceB.disposed));
                    });
                    return { value: 2 };
                  });
                  return [document.createElement('em')];
                },
              }),
          });
          const hostB = document.createElement('oe-lc2-teardown-plain');
          document.body.append(hostB);
          await tick();
          hostB.dispose(false);
          const afterPlain = {
            retainedDisposed: retainedB.scope.disposed,
            instanceDisposed: instanceB.disposed,
            domRetained: hostB.firstChild !== null,
          };

          // ── C) failed-first-connect rollback releases the retained entry ─────
          const orderC = [];
          let instanceC = null;
          let retainedC = null;
          let failMount = true;
          const probe = snapshot();
          const ctorC = mod.defineGeneratedElement({
            tag: 'oe-lc2-rollback',
            createInstance: (owner) => {
              instanceC = owner;
              owner.add(() => orderC.push('instance-cleanup'));
              return {};
            },
            createRecipe: (owner, host) =>
              mod.createRecipe({
                definitionOwner: owner,
                source: 'lc2-rollback',
                mount(scope) {
                  retainedC = mod.retainChildInstance(host.instance, 'lc2:rollback', scope, (childScope) => {
                    childScope.add(() => {
                      orderC.push('child-cleanup:' + String(instanceC && instanceC.disposed));
                    });
                    return { value: 3 };
                  });
                  if (failMount) throw new Error('mount boom');
                  return [document.createElement('i')];
                },
              }),
          });
          const hostC = document.createElement('oe-lc2-rollback');
          document.body.append(hostC);
          await tick();
          const failedFirstConnect = {
            childCount: hostC.childNodes.length,
            retainedDisposed: retainedC.scope.disposed,
            instanceDisposed: instanceC.disposed,
            retainAfter: grab(() => mod.retainChildInstance(instanceC, 'lc2:rollback', null, () => ({}))),
          };
          // A later connect creates a NEW instance and mounts successfully.
          failMount = false;
          hostC.remove();
          await tick();
          document.body.append(hostC);
          await tick();
          probe.stop();
          const retried = {
            childCount: hostC.childNodes.length,
            freshInstance: instanceC !== null && instanceC.disposed === false,
          };
          hostC.remove();
          return {
            beforeDisposeA,
            teardownA,
            afterDisposeA,
            orderA,
            afterPlain,
            orderB,
            failedFirstConnect,
            orderC,
            retried,
            errors: probe.errors,
          };
        })()`)) as {
          beforeDisposeA: { disposed: boolean; hasRangeCleanupOwner: boolean };
          teardownA: string;
          afterDisposeA: {
            retainedDisposed: boolean;
            instanceDisposed: boolean;
            domRemoved: boolean;
            retainAfter: string;
            releaseAfter: string | null;
            structuralReleaseAfter: string | null;
          };
          orderA: string[];
          afterPlain: {
            retainedDisposed: boolean;
            instanceDisposed: boolean;
            domRetained: boolean;
          };
          orderB: string[];
          failedFirstConnect: {
            childCount: number;
            retainedDisposed: boolean;
            instanceDisposed: boolean;
            retainAfter: string;
          };
          orderC: string[];
          retried: { childCount: number; freshInstance: boolean };
          errors: string[];
        };

        // A) release runs while the instance is still live, then the instance
        // cleanup runs; the FIRST error (the release) is the one that surfaces.
        expect(result.beforeDisposeA).toEqual({ disposed: false, hasRangeCleanupOwner: true });
        expect(result.orderA).toEqual(['child-cleanup:false', 'instance-cleanup']);
        expect(result.teardownA).toBe('child cleanup boom');
        expect(result.afterDisposeA).toEqual({
          retainedDisposed: true,
          instanceDisposed: true,
          domRemoved: true,
          retainAfter: 'OE_KERNEL_DISPOSED',
          releaseAfter: null,
          structuralReleaseAfter: null,
        });
        // B) the plain mode has the same ordering and keeps the DOM.
        expect(result.orderB).toEqual(['child-cleanup:false', 'instance-cleanup']);
        expect(result.afterPlain).toEqual({
          retainedDisposed: true,
          instanceDisposed: true,
          domRetained: true,
        });
        // C) failed first connect: the retained entry was released while the owner
        // was live, the owner was then destroyed, and the retry mounts a NEW
        // instance. The original mount error is the one that surfaces.
        expect(result.orderC).toEqual(['child-cleanup:false', 'instance-cleanup']);
        expect(result.failedFirstConnect.childCount).toBe(0);
        expect(result.failedFirstConnect.retainedDisposed).toBe(true);
        expect(result.failedFirstConnect.instanceDisposed).toBe(true);
        expect(result.failedFirstConnect.retainAfter).toBe('OE_KERNEL_DISPOSED');
        expect(result.retried).toEqual({ childCount: 1, freshInstance: true });
        expect(result.errors).toEqual(['mount boom']);
        // No ledger identity leaked anywhere (the release is explicit, not GC).
        expect(
          result.errors.filter((message) => message.includes('OEIR_INSTANCE_LEDGER_')),
        ).toEqual([]);
      } finally {
        await page.close();
      }
    });
  });
}
