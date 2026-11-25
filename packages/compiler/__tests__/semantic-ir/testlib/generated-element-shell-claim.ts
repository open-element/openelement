import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { DEFINE_PROFILE, type ProbeSnapshot } from './generated-element-shell-fixture.ts';

const DEFINE_CONDITIONAL = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-conditional',
    properties: [{ name: 'ok', attribute: 'ok', type: 'boolean' }],
    createRecipe: mod.createConditionalRecipe,
  });
`;

const DEFINE_NO_CLAIM = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-no-claim',
    properties: [
      { name: 'ok', attribute: 'ok', type: 'boolean' },
      { name: 'inner', attribute: 'inner', type: 'boolean' },
    ],
    createRecipe: mod.createNoClaimRecipe,
  });
`;

interface ClaimResult {
  html: string;
  errors: Array<{ message: string; code: string | null }>;
  claimed: {
    sameNode: boolean;
    childCount: number;
    text: string;
    title: string | null;
    dataCount: string | null;
    hidden: boolean;
  };
  claimMutations: number;
  before: ProbeSnapshot;
  after: ProbeSnapshot;
  afterUpdate: {
    text: string;
    title: string | null;
    dataCount: string | null;
    countAttr: string | null;
  };
  retained: { sameNode: boolean; text: string; attached: boolean };
  afterDisconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
  reconnected: { sameNode: boolean; text: string; attached: boolean };
  afterReconnectUpdate: { text: string; dataCount: string | null };
}

interface MismatchResult {
  errors: Array<{ message: string; code: string | null; name: string | null }>;
  before: ProbeSnapshot;
  after: ProbeSnapshot;
  retained: {
    sameNode: boolean;
    childCount: number;
    text: string;
    id: string | null;
    attached: boolean;
  };
}

interface ConditionalReconnectResult {
  html: string;
  errors: Array<{ message: string; code: string | null }>;
  before: ProbeSnapshot;
  afterClaim: ProbeSnapshot;
  claimed: {
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    sameBranch: boolean;
    text: string;
    childCount: number;
  };
  afterToggle: { branchTag: string | null; sameAnchor: boolean; sameEnd: boolean; text: string };
  beforeDisconnect: ProbeSnapshot;
  retained: {
    attached: boolean;
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    branchTag: string | null;
    text: string;
  };
  afterDisconnect: ProbeSnapshot;
  beforeReconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
  reconnected: {
    attached: boolean;
    sameDiv: boolean;
    sameAnchor: boolean;
    sameEnd: boolean;
    branchTag: string | null;
    text: string;
    childCount: number;
  };
  afterUpdate: { branchTag: string | null; sameAnchor: boolean; sameEnd: boolean; text: string };
}

interface NoClaimResult {
  errors: Array<{ message: string; code: string | null }>;
  /** Retained-DOM snapshot plus how many window errors had arrived by then. */
  seededAfterFirst: { sameNode: boolean; text: string; childCount: number; errors: number };
  seededAfterRetry: { sameNode: boolean; text: string; childCount: number; errors: number };
  mounted: { text: string; childCount: number };
  retainedAfterReconnect: { sameNode: boolean; text: string; childCount: number; errors: number };
  beforeReconnect: ProbeSnapshot;
  afterReconnect: ProbeSnapshot;
}

export function describeClaim(openPage: () => Promise<Page>): void {
  describe('claiming server and retained DOM', () => {
    test('server __ssr bytes are claimed in place with zero claim mutations, then stay live', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          ${DEFINE_PROFILE}
          document.body.innerHTML = '';
          const html = mod.Profile__ssr(
            { label: 'server', count: 2, enabled: true },
            { bindings: {}, props: {}, propsChanged: { value: 0 } },
          );
          const el = document.createElement('oe-m09-profile');
          el.setAttribute('label', 'server');
          el.setAttribute('count', '2');
          el.setAttribute('enabled', '');
          el.innerHTML = html;
          const p = el.firstElementChild;
          const before = mod.runtimeProbe.snapshot();
          const errors = [];
          const onError = (event) => errors.push({
            message: event.error?.message ?? event.message,
            code: event.error?.code ?? null,
          });
          window.addEventListener('error', onError);
          const mutations = [];
          const observer = new MutationObserver((records) => {
            for (const record of records) mutations.push(record.type);
          });
          observer.observe(el, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          document.body.append(el);
          await new Promise((resolve) => setTimeout(resolve, 0));
          window.removeEventListener('error', onError);
          for (const record of observer.takeRecords()) mutations.push(record.type);
          observer.disconnect();
          const after = mod.runtimeProbe.snapshot();
          const claimed = {
            sameNode: el.firstElementChild === p,
            childCount: el.childNodes.length,
            text: el.textContent,
            title: p?.getAttribute('title') ?? null,
            dataCount: p?.getAttribute('data-count') ?? null,
            hidden: p?.hasAttribute('hidden') ?? false,
          };
          el.count = 5;
          el.label = 'next';
          const afterUpdate = {
            text: el.textContent,
            title: p?.getAttribute('title') ?? null,
            dataCount: p?.getAttribute('data-count') ?? null,
            countAttr: el.getAttribute('count'),
          };
          el.remove();
          const afterDisconnect = mod.runtimeProbe.snapshot();
          const retained = {
            sameNode: el.firstElementChild === p,
            text: el.textContent,
            attached: el.isConnected,
          };
          document.body.append(el);
          const afterReconnect = mod.runtimeProbe.snapshot();
          const reconnected = {
            sameNode: el.firstElementChild === p,
            text: el.textContent,
            attached: el.isConnected,
          };
          el.count = 6;
          const afterReconnectUpdate = {
            text: el.textContent,
            dataCount: p?.getAttribute('data-count') ?? null,
          };
          return {
            html,
            errors,
            claimed,
            claimMutations: mutations.length,
            before,
            after,
            afterUpdate,
            retained,
            afterDisconnect,
            afterReconnect,
            reconnected,
            afterReconnectUpdate,
          };
        })()`)) as ClaimResult;

        expect(result.html).toContain('<p id="profile"');
        expect(result.errors, result.html).toEqual([]);
        expect(result.claimMutations).toBe(0);
        expect(result.claimed).toMatchObject({
          sameNode: true,
          childCount: 1,
          text: 'server',
          title: 'server',
          dataCount: '2',
          hidden: true,
        });
        expect(result.after.projections - result.before.projections).toBe(1);
        expect(result.after.subscriptions).toBeGreaterThan(result.before.subscriptions);
        expect(result.afterUpdate).toMatchObject({
          text: 'next',
          title: 'next',
          dataCount: '5',
          countAttr: '5',
        });

        // The claimed DOM goes through the same retained-DOM path as a mount
        // disconnect: release the owner, keep the nodes, re-adopt with a fresh
        // owner and no duplicate/lost subscriptions.
        expect(result.retained).toMatchObject({ sameNode: true, text: 'next', attached: false });
        expect(result.afterDisconnect.disposed - result.after.disposed).toBe(1);
        expect(result.reconnected).toMatchObject({ sameNode: true, text: 'next', attached: true });
        expect(result.afterReconnect.owners - result.after.owners).toBe(1);
        expect(result.afterReconnect.projections - result.after.projections).toBe(1);
        expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
          result.after.subscriptions - result.after.unsubscribed,
        );
        expect(result.afterReconnectUpdate).toMatchObject({ text: 'next', dataCount: '6' });
      } finally {
        await page.close();
      }
    });

    test('claim mismatch fails closed: DOM retained, no projection, no subscription', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          ${DEFINE_PROFILE}
          document.body.innerHTML = '';
          const el = document.createElement('oe-m09-profile');
          el.setAttribute('label', 'server');
          el.setAttribute('count', '2');
          el.setAttribute('enabled', '');
          el.innerHTML = '<p id="wrong">server</p>';
          const p = el.firstElementChild;
          const before = mod.runtimeProbe.snapshot();
          const errors = [];
          const onError = (event) => errors.push({
            message: event.error?.message ?? event.message,
            code: event.error?.code ?? null,
            name: event.error?.name ?? null,
          });
          window.addEventListener('error', onError);
          try {
            document.body.append(el);
          } catch (error) {
            errors.push({ message: String(error?.message ?? error), code: error?.code ?? null, name: error?.name ?? null });
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
          window.removeEventListener('error', onError);
          const after = mod.runtimeProbe.snapshot();
          return {
            errors,
            before,
            after,
            retained: {
              sameNode: el.firstElementChild === p,
              childCount: el.childNodes.length,
              text: el.textContent,
              id: p?.getAttribute('id') ?? null,
              attached: el.isConnected,
            },
          };
        })()`)) as MismatchResult;

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]!.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
        expect(result.errors[0]!.name).toBe('OpenElementError');
        expect(result.after.projections - result.before.projections).toBe(0);
        expect(result.after.subscriptions - result.before.subscriptions).toBe(0);
        expect(result.retained).toMatchObject({
          sameNode: true,
          childCount: 1,
          text: 'server',
          id: 'wrong',
        });
      } finally {
        await page.close();
      }
    });

    test('condition claim survives branch toggle and disconnect/reconnect with live updates', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          ${DEFINE_CONDITIONAL}
          document.body.innerHTML = '';
          const errors = [];
          const onError = (event) => errors.push({
            message: event.error?.message ?? event.message,
            code: event.error?.code ?? null,
          });
          window.addEventListener('error', onError);

          // Node-produced condition bytes, parsed by the real browser parser. The
          // claim must adopt the parsed anchor/branch/end instead of re-creating
          // the branch; this is SSR -> claim, not a mount tree.
          const html = mod.Conditional__ssr({ ok: true }, { bindings: {} });
          const el = document.createElement('oe-m09-conditional');
          el.setAttribute('ok', '');
          el.innerHTML = html;
          const div = el.firstElementChild;
          const anchor = div.firstChild;
          const end = div.lastChild;
          const branch = div.firstElementChild;
          const before = mod.runtimeProbe.snapshot();
          document.body.append(el);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const afterClaim = mod.runtimeProbe.snapshot();
          const claimed = {
            sameDiv: el.firstElementChild === div,
            sameAnchor: div.firstChild === anchor,
            sameEnd: div.lastChild === end,
            sameBranch: div.firstElementChild === branch,
            text: el.textContent,
            childCount: el.childNodes.length,
          };

          el.ok = false;
          const afterToggle = {
            branchTag: div.firstElementChild?.tagName ?? null,
            sameAnchor: div.firstChild === anchor,
            sameEnd: div.lastChild === end,
            text: el.textContent,
          };

          const beforeDisconnect = mod.runtimeProbe.snapshot();
          el.remove();
          const afterDisconnect = mod.runtimeProbe.snapshot();
          const retained = {
            attached: el.isConnected,
            sameDiv: el.firstElementChild === div,
            sameAnchor: div.firstChild === anchor,
            sameEnd: div.lastChild === end,
            branchTag: div.firstElementChild?.tagName ?? null,
            text: el.textContent,
          };

          const beforeReconnect = mod.runtimeProbe.snapshot();
          document.body.append(el);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const afterReconnect = mod.runtimeProbe.snapshot();
          const reconnected = {
            attached: el.isConnected,
            sameDiv: el.firstElementChild === div,
            sameAnchor: div.firstChild === anchor,
            sameEnd: div.lastChild === end,
            branchTag: div.firstElementChild?.tagName ?? null,
            text: el.textContent,
            childCount: el.childNodes.length,
          };

          el.ok = true;
          const afterUpdate = {
            branchTag: div.firstElementChild?.tagName ?? null,
            sameAnchor: div.firstChild === anchor,
            sameEnd: div.lastChild === end,
            text: el.textContent,
          };
          window.removeEventListener('error', onError);
          return {
            html,
            errors,
            before,
            afterClaim,
            claimed,
            afterToggle,
            beforeDisconnect,
            retained,
            afterDisconnect,
            beforeReconnect,
            afterReconnect,
            reconnected,
            afterUpdate,
          };
        })()`)) as ConditionalReconnectResult;

        expect(result.errors).toEqual([]);
        expect(result.claimed).toMatchObject({
          sameDiv: true,
          sameAnchor: true,
          sameEnd: true,
          sameBranch: true,
          text: 'on',
          childCount: 1,
        });
        expect(result.afterClaim.owners - result.before.owners).toBe(1);
        expect(result.afterClaim.projections - result.before.projections).toBe(1);

        expect(result.afterToggle).toMatchObject({
          branchTag: 'EM',
          sameAnchor: true,
          sameEnd: true,
          text: 'off',
        });

        expect(result.retained).toMatchObject({
          attached: false,
          sameDiv: true,
          sameAnchor: true,
          sameEnd: true,
          branchTag: 'EM',
          text: 'off',
        });
        expect(result.afterDisconnect.disposed - result.before.disposed).toBe(1);
        expect(result.afterDisconnect.subscriptions - result.afterDisconnect.unsubscribed).toBe(0);

        expect(result.reconnected).toMatchObject({
          attached: true,
          sameDiv: true,
          sameAnchor: true,
          sameEnd: true,
          branchTag: 'EM',
          text: 'off',
          childCount: 1,
        });
        // The reconnect claim gets a fresh projection owner; the retained DOM
        // (anchor, branch and end) is adopted in place, never re-mounted.
        expect(result.afterReconnect.owners - result.beforeReconnect.owners).toBe(1);
        expect(result.afterReconnect.projections - result.beforeReconnect.projections).toBe(1);
        // No duplicate and no loss: the live subscription count returns exactly
        // to its pre-disconnect value.
        expect(result.afterReconnect.subscriptions - result.afterReconnect.unsubscribed).toBe(
          result.beforeDisconnect.subscriptions - result.beforeDisconnect.unsubscribed,
        );

        // Updates still work after the reconnect claim, and replacing the branch
        // does not move the anchor/end markers.
        expect(result.afterUpdate).toMatchObject({
          branchTag: 'P',
          sameAnchor: true,
          sameEnd: true,
          text: 'on',
        });
      } finally {
        await page.close();
      }
    });

    test('a generated module without a claim fails closed on existing DOM and on reconnect', async () => {
      const page = await openPage();
      try {
        const result = (await page.evaluate(`(async () => {
          ${DEFINE_NO_CLAIM}
          document.body.innerHTML = '';
          const errors = [];
          const onError = (event) => errors.push({
            message: event.error?.message ?? event.message,
            code: event.error?.code ?? null,
          });
          window.addEventListener('error', onError);
          // Custom-element reaction exceptions are reported to the global error
          // handler as a queued task; two macrotasks make the capture settle.
          const settle = async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
          };
          const snapshotOf = (el, child) => ({
            sameNode: el.firstElementChild === child,
            text: el.textContent,
            childCount: el.childNodes.length,
            errors: errors.length,
          });

          // 1. Existing DOM this mount-only module cannot claim. NoClaim emits no
          //    __ssr, so this seeded shape is an ordinary pre-upgrade tree, not a
          //    server-rendered artifact. The shell takes the claim branch
          //    structurally because the root carries content, claimRecipe finds
          //    no claim and throws before an owner exists, and the borrowed tree is
          //    never touched.
          const seeded = document.createElement('oe-m09-no-claim');
          seeded.setAttribute('ok', '');
          seeded.innerHTML = '<div><p>on</p></div>';
          const seededChild = seeded.firstElementChild;
          document.body.append(seeded);
          await settle();
          const seededAfterFirst = snapshotOf(seeded, seededChild);

          // 2. Reconnect the SAME element after its failed claim. The failed
          //    attempt leaves the region fact 'present', so the next connect
          //    retries the claim instead of switching to mount; the borrowed tree
          //    is still untouched and the second attempt throws again.
          seeded.remove();
          document.body.append(seeded);
          await settle();
          const seededAfterRetry = snapshotOf(seeded, seededChild);

          // 3. Mount succeeds, disconnect retains DOM, reconnect must not silently
          //    leave the element inert. The mount leaves the region fact
          //    'present', so this reconnect takes the claim branch too — a mount
          //    would append a second region.
          const el = document.createElement('oe-m09-no-claim');
          el.setAttribute('ok', '');
          el.setAttribute('inner', '');
          document.body.append(el);
          const mounted = { text: el.textContent, childCount: el.childNodes.length };
          const child = el.firstElementChild;
          el.remove();
          const beforeReconnect = mod.runtimeProbe.snapshot();
          document.body.append(el);
          await settle();
          window.removeEventListener('error', onError);
          const afterReconnect = mod.runtimeProbe.snapshot();
          return {
            errors,
            seededAfterFirst,
            seededAfterRetry,
            mounted,
            retainedAfterReconnect: snapshotOf(el, child),
            beforeReconnect,
            afterReconnect,
          };
        })()`)) as NoClaimResult;

        // Step 1: one throw, and the borrowed tree is byte-identical afterwards.
        expect(result.seededAfterFirst).toMatchObject({
          sameNode: true,
          text: 'on',
          childCount: 1,
          errors: 1,
        });
        // Step 2: the retry threw again (errors 2) rather than mounting a second
        // region into the borrowed tree.
        expect(result.seededAfterRetry).toMatchObject({
          sameNode: true,
          text: 'on',
          childCount: 1,
          errors: 2,
        });
        expect(result.mounted).toMatchObject({ text: 'x', childCount: 1 });
        expect(result.retainedAfterReconnect).toMatchObject({
          sameNode: true,
          text: 'x',
          childCount: 1,
        });
        // Three connects in total (borrowed DOM, its retry, the mounted region's
        // reconnect) and one throw each. claimRecipe throws
        // OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE BEFORE it creates an owner, so this is
        // a real fail-closed guarantee, and the retained node identity above is
        // the proof none of the retries fell through to a mount.
        expect(result.errors).toHaveLength(3);
        for (const error of result.errors) {
          expect(error.code).toBe('OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE');
          expect(error.message).toContain('no generated claim');
        }
        // Failed claims register no projection and no subscription.
        expect(result.afterReconnect.projections).toBe(result.beforeReconnect.projections);
        expect(result.afterReconnect.subscriptions).toBe(result.beforeReconnect.subscriptions);
      } finally {
        await page.close();
      }
    });
  });
}
