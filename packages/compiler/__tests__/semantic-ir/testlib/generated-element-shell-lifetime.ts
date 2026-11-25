import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { DEFINE_PROFILE, type ProbeSnapshot } from './generated-element-shell-fixture.ts';

interface ReconnectResult {
  before: ProbeSnapshot;
  afterDisconnect: ProbeSnapshot;
  retained: { attached: boolean; sameNode: boolean; childCount: number; text: string };
  afterReconnect: ProbeSnapshot;
  reconnected: { attached: boolean; sameNode: boolean; childCount: number; text: string };
  afterUpdate: { text: string; dataCount: string | null; countAttr: string | null };
}

interface RetentionResult {
  bindingCalls: number;
  hosts: number;
  sameBindings: boolean;
  samePropsChanged: boolean;
  propsChangedDuringDisconnect: boolean;
  mountedText: string | null;
  reconnectedText: string | null;
  sameNode: boolean;
  childCount: number;
  rootCleanupsAfterFirstDisconnect: number;
  rootCleanupsAfterFinalDisconnect: number;
  freshRoots: boolean;
}

/**
 * LC-0 retained-instance row: the element-lifetime instance scope/setup record
 * must survive a disconnect, while the per-connection scope resources are
 * released and re-armed exactly once. `dispose` then destroys the instance, and
 * a later connect re-runs setup on a NEW instance.
 */
interface InstanceRetentionResult {
  afterMount: {
    setupCalls: number;
    setupCleanups: number;
    connectionCleanups: number;
    recipeCalls: number;
    text: string | null;
  };
  afterFirstDisconnect: {
    setupCalls: number;
    setupCleanups: number;
    connectionCleanups: number;
    retained: { sameNode: boolean; childCount: number; text: string | null };
  };
  afterReconnect: {
    setupCalls: number;
    setupCleanups: number;
    connectionCleanups: number;
    recipeCalls: number;
    sameBindings: boolean;
    samePropsChanged: boolean;
    sameNode: boolean;
    text: string | null;
  };
  afterFinalDisconnect: {
    setupCalls: number;
    setupCleanups: number;
    connectionCleanups: number;
  };
  afterDispose: {
    setupCalls: number;
    setupCleanups: number;
    childCount: number;
  };
  afterRemount: {
    setupCalls: number;
    setupCleanups: number;
    recipeCalls: number;
    freshBindings: boolean;
    text: string | null;
  };
  conflictError: string | null;
}

/**
 * LC-0 failure-rollback rows: a failed first connect rolls the just-created
 * setup back (original error, never a cleanup error); a failed reconnect keeps
 * the retained instance instead of destroying its setup state.
 */
interface InstanceFailureResult {
  errors: string[];
  setupThrow: {
    instanceCalls: number;
    rollbackCleanups: number;
    childCount: number;
    retriedMountedText: string | null;
    instanceCallsAfterRetry: number;
  };
  mountThrow: {
    setupCalls: number;
    setupCleanups: number;
    childCount: number;
    retriedMountedText: string | null;
    setupCallsAfterRetry: number;
  };
  reconnectClaimThrow: {
    setupCalls: number;
    setupCleanups: number;
    connectionCleanups: number;
    childCount: number;
    retainedText: string | null;
    sameNodeAfterRecovery: boolean;
    setupCallsAfterRecovery: number;
  };
}

/**
 * ROOT recipe-body re-invocation CHARACTERIZATION row (NOT a nested-hostless
 * child measurement). Under the LC-0 seam the element-lifetime instance factory
 * is retained (called once), while the ROOT recipe's generated mount/claim
 * bodies are still re-invoked per connection; both counters below wrap those
 * two bodies at the ROOT recipe, so `recipeBodyCalls = 2` is the root body
 * being re-entered by the reconnect claim — it does NOT instantiate or count a
 * nested hostless child.
 *
 * Nested hostless child retention remains OWED (`16b-LC retained-child`) and UNMEASURED;
 * this fixture makes no claim about it and pins no flip expectation for it.
 */
interface RootRecipeBodyReinvokeResult {
  instanceSetupCalls: number;
  recipeBodyCalls: number;
  connectionCleanups: number;
  instanceCleanups: number;
  afterMount: { instanceSetupCalls: number; recipeBodyCalls: number };
  afterDisconnect: {
    instanceSetupCalls: number;
    recipeBodyCalls: number;
    connectionCleanups: number;
  };
  afterReconnect: {
    instanceSetupCalls: number;
    recipeBodyCalls: number;
    connectionCleanups: number;
    sameNode: boolean;
    text: string | null;
  };
}

/**
 * LC-0 C1 row: plain `dispose(false)` destroys the retained instance exactly
 * once but keeps the DOM; a later `dispose(true)` is one-shot for the instance
 * and cannot upgrade the released ownership record into a detach.
 */
interface PlainDisposeOneShotResult {
  afterMount: { setupCalls: number; setupCleanups: number; childCount: number };
  afterPlainDispose: {
    setupCalls: number;
    setupCleanups: number;
    childCount: number;
    sameNode: boolean;
  };
  afterLaterDetach: {
    setupCalls: number;
    setupCleanups: number;
    childCount: number;
    sameNode: boolean;
  };
}

export function describeLifetime(openPage: () => Promise<Page>): void {
  describe('retained instances and reconnect', () => {
    test('disconnect dispose(false) keeps DOM; reconnect claim uses a fresh owner without duplicate subscriptions', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          ${DEFINE_PROFILE}
          document.body.innerHTML = '';
          const el = document.createElement('oe-m09-profile');
          el.setAttribute('label', 'hello');
          el.setAttribute('count', '4');
          el.setAttribute('enabled', '');
          document.body.append(el);
          const p = el.firstElementChild;
          const before = mod.runtimeProbe.snapshot();
          el.remove();
          const afterDisconnect = mod.runtimeProbe.snapshot();
          const retained = {
            attached: el.isConnected,
            sameNode: el.firstElementChild === p,
            childCount: el.childNodes.length,
            text: el.textContent,
          };
          document.body.append(el);
          const afterReconnect = mod.runtimeProbe.snapshot();
          const reconnected = {
            attached: el.isConnected,
            sameNode: el.firstElementChild === p,
            childCount: el.childNodes.length,
            text: el.textContent,
          };
          el.count = 6;
          const afterUpdate = {
            text: el.textContent,
            dataCount: p?.getAttribute('data-count') ?? null,
            countAttr: el.getAttribute('count'),
          };
          return { before, afterDisconnect, retained, afterReconnect, reconnected, afterUpdate };
        })()`)) as ReconnectResult;

        expect(result.retained).toMatchObject({
          attached: false,
          sameNode: true,
          childCount: 1,
          text: 'hello',
        });
        expect(result.afterDisconnect.disposed - result.before.disposed).toBe(1);
        expect(result.afterDisconnect.unsubscribed).toBeGreaterThan(result.before.unsubscribed);
        expect(result.afterDisconnect.subscriptions - result.afterDisconnect.unsubscribed).toBe(0);

        expect(result.reconnected).toMatchObject({
          attached: true,
          sameNode: true,
          childCount: 1,
          text: 'hello',
        });
        // A fresh projection owner per reconnect (the physical root owner is not
        // asserted; the model makes scope identity explicitly non-contractual).
        expect(result.afterReconnect.owners - result.before.owners).toBe(1);
        expect(result.afterReconnect.projections - result.before.projections).toBe(1);
        // No duplicate and no loss: the live subscription count returns to its
        // pre-disconnect value exactly once.
        expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
          result.before.subscriptions - result.before.unsubscribed,
        );

        expect(result.afterUpdate).toMatchObject({
          text: 'hello',
          dataCount: '6',
          countAttr: '6',
        });
      } finally {
        await page.close();
      }
    });

    test('createBindings and propsChanged are retained across disconnect/reconnect', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          const hosts = [];
          const roots = [];
          let rootCleanups = 0;
          let bindingCalls = 0;
          const bindings = { marker: { value: 'kept' } };
          mod.defineGeneratedElement({
            tag: 'oe-m09-retained',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createBindings: () => {
              bindingCalls += 1;
              return bindings;
            },
            createRecipe: (owner, host) => {
              roots.push(owner);
              owner.add(() => {
                rootCleanups += 1;
              });
              hosts.push(host);
              return mod.createProfileRecipe(owner, host);
            },
          });
          const el = document.createElement('oe-m09-retained');
          el.setAttribute('label', 'first');
          document.body.append(el);
          const p = el.firstElementChild;
          const mountedText = el.textContent;
          const propsChanged = hosts[0].propsChanged;
          el.remove();
          const rootCleanupsAfterFirstDisconnect = rootCleanups;
          el.label = 'disconnected';
          const propsChangedDuringDisconnect = propsChanged.value > 0;
          document.body.append(el);
          const reconnectedText = el.textContent;
          const freshRoots = roots.length === 2 && roots[0] !== roots[1];
          el.remove();
          const rootCleanupsAfterFinalDisconnect = rootCleanups;
          return {
            bindingCalls,
            hosts: hosts.length,
            sameBindings:
              hosts.length === 2 &&
              hosts[0].bindings === hosts[1].bindings &&
              hosts[0].bindings === bindings,
            samePropsChanged:
              hosts.length === 2 &&
              hosts[0].propsChanged === hosts[1].propsChanged &&
              hosts[0].propsChanged === propsChanged,
            propsChangedDuringDisconnect,
            mountedText,
            reconnectedText,
            sameNode: el.firstElementChild === p,
            childCount: el.childNodes.length,
            rootCleanupsAfterFirstDisconnect,
            rootCleanupsAfterFinalDisconnect,
            freshRoots,
          };
        })()`)) as RetentionResult;

        expect(result).toMatchObject({
          bindingCalls: 1,
          hosts: 2,
          sameBindings: true,
          samePropsChanged: true,
          propsChangedDuringDisconnect: true,
          mountedText: 'first',
          reconnectedText: 'disconnected',
          sameNode: true,
          childCount: 1,
          rootCleanupsAfterFirstDisconnect: 1,
          rootCleanupsAfterFinalDisconnect: 2,
          freshRoots: true,
        });
        // The shell supports the retained bindings record, the shell-owned
        // invalidation signal, and a prop written during the disconnect window:
        // this generated claim re-reads the current props on reconnect. There is
        // no author onDispose callback to invoke.
      } finally {
        await page.close();
      }
    });

    test('LC-0 createInstance is retained across disconnect/reconnect, connection resources re-arm, dispose destroys the instance', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          let setupCalls = 0;
          let setupCleanups = 0;
          let connectionCleanups = 0;
          let recipeCalls = 0;
          const hosts = [];
          const records = [];
          const recipeHosts = [];
          // The descriptor must name exactly one call-once/retain setup site: a
          // descriptor with BOTH createInstance and createBindings fails closed.
          let conflictError = null;
          try {
            mod.defineGeneratedElement({
              tag: 'oe-lc0-conflict',
              properties: [],
              createInstance: () => ({}),
              createBindings: () => ({}),
              createRecipe: mod.createProfileRecipe,
            });
          } catch (error) {
            conflictError = error && error.message ? error.message : String(error);
          }
          mod.defineGeneratedElement({
            tag: 'oe-lc0-instance',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner, host) => {
              setupCalls += 1;
              hosts.push(host);
              owner.add(() => {
                setupCleanups += 1;
              });
              const record = { marker: { value: setupCalls } };
              records.push(record);
              return record;
            },
            createRecipe: (connection, host) => {
              recipeCalls += 1;
              recipeHosts.push(host);
              connection.add(() => {
                connectionCleanups += 1;
              });
              return mod.createProfileRecipe(connection, host);
            },
          });
          const el = document.createElement('oe-lc0-instance');
          el.setAttribute('label', 'first');
          document.body.append(el);
          const p = el.firstElementChild;
          const bindings0 = records[0];
          const propsChanged0 = hosts[0].propsChanged;
          const afterMount = {
            setupCalls,
            setupCleanups,
            connectionCleanups,
            recipeCalls,
            text: el.textContent,
          };
          el.remove();
          const afterFirstDisconnect = {
            setupCalls,
            setupCleanups,
            connectionCleanups,
            retained: {
              sameNode: el.firstElementChild === p,
              childCount: el.childNodes.length,
              text: el.textContent,
            },
          };
          el.label = 'second';
          document.body.append(el);
          const afterReconnect = {
            setupCalls,
            setupCleanups,
            connectionCleanups,
            recipeCalls,
            sameBindings:
              records.length === 1 &&
              recipeHosts.length === 2 &&
              recipeHosts[0].bindings === bindings0 &&
              recipeHosts[1].bindings === bindings0,
            samePropsChanged:
              recipeHosts.length === 2 &&
              recipeHosts[0].propsChanged === propsChanged0 &&
              recipeHosts[1].propsChanged === propsChanged0,
            sameNode: el.firstElementChild === p,
            text: el.textContent,
          };
          el.remove();
          const afterFinalDisconnect = { setupCalls, setupCleanups, connectionCleanups };
          el.dispose(true);
          const afterDispose = { setupCalls, setupCleanups, childCount: el.childNodes.length };
          document.body.append(el);
          const afterRemount = {
            setupCalls,
            setupCleanups,
            recipeCalls,
            freshBindings: records.length === 2 && records[1] !== bindings0,
            text: el.textContent,
          };
          return {
            afterMount,
            afterFirstDisconnect,
            afterReconnect,
            afterFinalDisconnect,
            afterDispose,
            afterRemount,
            conflictError,
          };
        })()`)) as InstanceRetentionResult;

        // DESCRIPTOR-FIXTURE EVIDENCE: both LC-0 rows below use hand-written
        // descriptor factories, so this proves the shell retention seam only and
        // is NOT generated-path evidence (the compiler's root-instance tests own
        // that); this fixture's behavior is unchanged and does not measure a
        // nested hostless child.
        // Setup ran once and allocated a retained record; no setup cleanup has
        // run and the connection has no cleanup to run yet.
        expect(result.afterMount).toMatchObject({
          setupCalls: 1,
          setupCleanups: 0,
          connectionCleanups: 0,
          recipeCalls: 1,
          text: 'first',
        });
        // Disconnect is NOT disposal: setup state is kept, connection resources
        // are released, DOM is retained.
        expect(result.afterFirstDisconnect).toMatchObject({
          setupCalls: 1,
          setupCleanups: 0,
          connectionCleanups: 1,
        });
        expect(result.afterFirstDisconnect.retained).toMatchObject({
          sameNode: true,
          childCount: 1,
          text: 'first',
        });
        // Reconnect re-arms the connection scope exactly once and does NOT repeat
        // setup: the same retained bindings record + propsChanged signal are seen.
        expect(result.afterReconnect).toMatchObject({
          setupCalls: 1,
          setupCleanups: 0,
          connectionCleanups: 1,
          recipeCalls: 2,
          sameBindings: true,
          samePropsChanged: true,
          sameNode: true,
          text: 'second',
        });
        expect(result.afterFinalDisconnect).toMatchObject({
          setupCalls: 1,
          setupCleanups: 0,
          connectionCleanups: 2,
        });
        // Explicit teardown destroys the instance once, in the requested mode.
        expect(result.afterDispose).toMatchObject({
          setupCalls: 1,
          setupCleanups: 1,
          childCount: 0,
        });
        // dispose is not disconnect: a later connect creates a NEW instance and
        // re-runs setup with a fresh record.
        expect(result.afterRemount).toMatchObject({
          setupCalls: 2,
          setupCleanups: 1,
          recipeCalls: 3,
          freshBindings: true,
          text: 'second',
        });
        expect(result.conflictError).toContain('mutually exclusive');
      } finally {
        await page.close();
      }
    });

    test('LC-0 failure rollback: failed setup/mount retries setup; failed reconnect claim keeps the retained instance', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          const errors = [];
          const onError = (event) => errors.push(event.error?.message ?? event.message);
          window.addEventListener('error', onError);
          const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

          // (a) createInstance throws and its cleanup throws too: the ORIGINAL
          // setup error surfaces, the cleanup was attempted, nothing mounts, and
          // the retry re-runs setup on a fresh instance.
          let instanceCalls = 0;
          let rollbackCleanups = 0;
          mod.defineGeneratedElement({
            tag: 'oe-lc0-setup-throw',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner) => {
              instanceCalls += 1;
              owner.add(() => {
                rollbackCleanups += 1;
                throw new Error('rollback-cleanup');
              });
              if (instanceCalls === 1) throw new Error('instance-origin');
              return {};
            },
            createRecipe: (connection, host) => mod.createProfileRecipe(connection, host),
          });
          const setupThrow = document.createElement('oe-lc0-setup-throw');
          setupThrow.setAttribute('label', 'setup');
          document.body.append(setupThrow);
          await flush();
          const setupThrowFacts = {
            instanceCalls,
            rollbackCleanups,
            childCount: setupThrow.childNodes.length,
          };
          setupThrow.remove();
          document.body.append(setupThrow);
          await flush();
          setupThrowFacts.retriedMountedText = setupThrow.textContent;
          setupThrowFacts.instanceCallsAfterRetry = instanceCalls;
          setupThrow.remove();

          // (b) mount throws AFTER a successful createInstance: the just-created
          // instance is rolled back (detach mode) and the retry re-runs setup.
          let mountSetupCalls = 0;
          let mountSetupCleanups = 0;
          let mountCalls = 0;
          mod.defineGeneratedElement({
            tag: 'oe-lc0-mount-throw',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner) => {
              mountSetupCalls += 1;
              owner.add(() => {
                mountSetupCleanups += 1;
              });
              return {};
            },
            createRecipe: (connection, host) => {
              const base = mod.createProfileRecipe(connection, host);
              return {
                ...base,
                mount: (scope, props) => {
                  mountCalls += 1;
                  if (mountCalls === 1) throw new Error('mount-origin');
                  return base.mount(scope, props);
                },
              };
            },
          });
          const mountThrow = document.createElement('oe-lc0-mount-throw');
          mountThrow.setAttribute('label', 'mount');
          document.body.append(mountThrow);
          await flush();
          const mountThrowFacts = {
            setupCalls: mountSetupCalls,
            setupCleanups: mountSetupCleanups,
            childCount: mountThrow.childNodes.length,
          };
          mountThrow.remove();
          document.body.append(mountThrow);
          await flush();
          mountThrowFacts.retriedMountedText = mountThrow.textContent;
          mountThrowFacts.setupCallsAfterRetry = mountSetupCalls;
          mountThrow.remove();

          // (c) A reconnect CLAIM failure releases only the connection scope; the
          // retained instance keeps its setup state and the next claim succeeds
          // with the SAME setup count.
          let claimSetupCalls = 0;
          let claimSetupCleanups = 0;
          let connectionCleanups = 0;
          let claimAttempts = 0;
          mod.defineGeneratedElement({
            tag: 'oe-lc0-claim-throw',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner) => {
              claimSetupCalls += 1;
              owner.add(() => {
                claimSetupCleanups += 1;
              });
              return {};
            },
            createRecipe: (connection, host) => {
              connection.add(() => {
                connectionCleanups += 1;
              });
              const base = mod.createProfileRecipe(connection, host);
              return {
                ...base,
                claim: (scope, props, parent) => {
                  claimAttempts += 1;
                  if (claimAttempts === 1) throw new Error('claim-origin');
                  return base.claim(scope, props, parent);
                },
              };
            },
          });
          const claimThrow = document.createElement('oe-lc0-claim-throw');
          claimThrow.setAttribute('label', 'claim');
          document.body.append(claimThrow);
          await flush();
          const claimedNode = claimThrow.firstElementChild;
          claimThrow.remove();
          document.body.append(claimThrow);
          await flush();
          const reconnectClaimThrow = {
            setupCalls: claimSetupCalls,
            setupCleanups: claimSetupCleanups,
            connectionCleanups,
            childCount: claimThrow.childNodes.length,
            retainedText: claimThrow.textContent,
          };
          claimThrow.remove();
          document.body.append(claimThrow);
          await flush();
          reconnectClaimThrow.sameNodeAfterRecovery = claimThrow.firstElementChild === claimedNode;
          reconnectClaimThrow.setupCallsAfterRecovery = claimSetupCalls;

          window.removeEventListener('error', onError);
          return { errors, setupThrow: setupThrowFacts, mountThrow: mountThrowFacts, reconnectClaimThrow };
        })()`)) as InstanceFailureResult;

        // Filter by the KNOWN messages instead of slicing by position: an
        // unrelated window error event from the slice bundle must neither
        // masquerade as one of these rows nor hide one behind its position. The
        // original setup error occurred once, then the mount error, then the
        // reconnect claim error; the suppressed rollback cleanup never surfaces.
        const knownErrors = ['instance-origin', 'mount-origin', 'claim-origin'];
        expect(result.errors.filter((message) => knownErrors.includes(message))).toEqual(
          knownErrors,
        );
        expect(result.errors).not.toContain('rollback-cleanup');

        expect(result.setupThrow).toMatchObject({
          instanceCalls: 1,
          rollbackCleanups: 1,
          childCount: 0,
          retriedMountedText: 'setup',
          instanceCallsAfterRetry: 2,
        });
        expect(result.mountThrow).toMatchObject({
          setupCalls: 1,
          setupCleanups: 1,
          childCount: 0,
          retriedMountedText: 'mount',
          setupCallsAfterRetry: 2,
        });
        expect(result.reconnectClaimThrow).toMatchObject({
          setupCalls: 1,
          setupCleanups: 0,
          connectionCleanups: 2,
          childCount: 1,
          retainedText: 'claim',
          sameNodeAfterRecovery: true,
          setupCallsAfterRecovery: 1,
        });
      } finally {
        await page.close();
      }
    });

    test('OWED characterization (not acceptance): ROOT recipe body is re-invoked by mount/claim under the retained instance; nested hostless child is NOT measured', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          let instanceSetupCalls = 0;
          let recipeBodyCalls = 0;
          let connectionCleanups = 0;
          let instanceCleanups = 0;
          mod.defineGeneratedElement({
            tag: 'oe-lc0-root-body-reinvoke',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner) => {
              instanceSetupCalls += 1;
              owner.add(() => {
                instanceCleanups += 1;
              });
              return {};
            },
            createRecipe: (connection, host) => {
              connection.add(() => {
                connectionCleanups += 1;
              });
              const base = mod.createProfileRecipe(connection, host);
              // CHARACTERIZATION of the ROOT recipe's per-connection body
              // invocation ONLY. 'base' is the ROOT component's generated
              // recipe, so wrapping its mount/claim counts the ROOT body being
              // re-entered by the reconnect claim. This does NOT create, mount or
              // count a nested hostless child instance; nested child retention is
              // OWED (16b-LC retained-child) and UNMEASURED here.
              return {
                ...base,
                mount: (scope, props) => {
                  recipeBodyCalls += 1;
                  return base.mount(scope, props);
                },
                claim: (scope, props, parent) => {
                  recipeBodyCalls += 1;
                  return base.claim(scope, props, parent);
                },
              };
            },
          });
          const el = document.createElement('oe-lc0-root-body-reinvoke');
          el.setAttribute('label', 'root-body');
          document.body.append(el);
          const p = el.firstElementChild;
          const afterMount = { instanceSetupCalls, recipeBodyCalls };
          el.remove();
          const afterDisconnect = { instanceSetupCalls, recipeBodyCalls, connectionCleanups };
          document.body.append(el);
          const afterReconnect = {
            instanceSetupCalls,
            recipeBodyCalls,
            connectionCleanups,
            sameNode: el.firstElementChild === p,
            text: el.textContent,
          };
          return {
            instanceSetupCalls,
            recipeBodyCalls,
            connectionCleanups,
            instanceCleanups,
            afterMount,
            afterDisconnect,
            afterReconnect,
          };
        })()`)) as RootRecipeBodyReinvokeResult;

        // Retained-instance row: the fixture instance factory is created once and
        // is NOT re-invoked by the reconnect claim.
        expect(result.afterMount).toEqual({ instanceSetupCalls: 1, recipeBodyCalls: 1 });
        expect(result.afterDisconnect).toEqual({
          instanceSetupCalls: 1,
          recipeBodyCalls: 1,
          connectionCleanups: 1,
        });
        // CHARACTERIZATION — the ROOT recipe body is re-invoked by the reconnect
        // claim (2) while the retained instance factory stays at 1. This is the
        // ROOT body re-entry, NOT a nested hostless child measurement and NOT
        // acceptance: nested child retention remains OWED for 16b-LC retained-child and
        // UNMEASURED, and no flip expectation is encoded here.
        expect(result.afterReconnect).toMatchObject({
          instanceSetupCalls: 1,
          recipeBodyCalls: 2,
          connectionCleanups: 1,
          sameNode: true,
          text: 'root-body',
        });
        // The retained root instance was never disposed by the disconnect.
        expect(result.instanceCleanups).toBe(0);
      } finally {
        await page.close();
      }
    });

    test('LC-0 dispose(false) destroys the instance once, keeps the DOM, and a later dispose(true) cannot upgrade it', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(() => {
          const mod = window.__oeM09;
          document.body.innerHTML = '';
          let setupCalls = 0;
          let setupCleanups = 0;
          mod.defineGeneratedElement({
            tag: 'oe-lc0-plain-dispose',
            properties: [{ name: 'label', attribute: 'label', type: 'string' }],
            createInstance: (owner) => {
              setupCalls += 1;
              owner.add(() => {
                setupCleanups += 1;
              });
              return {};
            },
            createRecipe: (connection, host) => mod.createProfileRecipe(connection, host),
          });
          const el = document.createElement('oe-lc0-plain-dispose');
          el.setAttribute('label', 'plain');
          document.body.append(el);
          const p = el.firstElementChild;
          const afterMount = { setupCalls, setupCleanups, childCount: el.childNodes.length };
          el.dispose(false);
          const afterPlainDispose = {
            setupCalls,
            setupCleanups,
            childCount: el.childNodes.length,
            sameNode: el.firstElementChild === p,
          };
          el.dispose(true);
          const afterLaterDetach = {
            setupCalls,
            setupCleanups,
            childCount: el.childNodes.length,
            sameNode: el.firstElementChild === p,
          };
          return { afterMount, afterPlainDispose, afterLaterDetach };
        })()`)) as PlainDisposeOneShotResult;

        expect(result.afterMount).toEqual({ setupCalls: 1, setupCleanups: 0, childCount: 1 });
        // Plain dispose destroys the retained instance exactly once (its setup
        // cleanup runs) while keeping the mounted DOM.
        expect(result.afterPlainDispose).toEqual({
          setupCalls: 1,
          setupCleanups: 1,
          childCount: 1,
          sameNode: true,
        });
        // A later detach dispose is one-shot for the instance and cannot upgrade
        // the released ownership record into a detach: no second cleanup, DOM
        // retained.
        expect(result.afterLaterDetach).toEqual({
          setupCalls: 1,
          setupCleanups: 1,
          childCount: 1,
          sameNode: true,
        });
      } finally {
        await page.close();
      }
    });
  });
}
