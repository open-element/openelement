#!/usr/bin/env node
// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the per-component-kind qualification pins (tag presence, DSD, event binding, admission decision, browser capability evidence) are collected across one build-and-probe pipeline that shares the fixture app, so they are one harness; the boundary is its consumption rule: workspace SOURCE for the framework, pinned npm packages (Shoelace, Material Web, FAST, Ionic/Stencil, Lit) for the third-party components, exactly as a real application consumes them.
/**
 * Third-party Web Components qualification fixture.
 *
 * Artifact consumption: this fixture consumes workspace SOURCE artifacts. The
 * runner generates a fresh app with packages/create into a temp directory,
 * aliases every workspace package to its in-repo source (`link:` entries in
 * the app package.json plus a `resolve.alias` block in the Vite config),
 * copies the fixture sources from ./app in,
 * and builds with the in-repo Router build CLI. The third-party libraries
 * (Shoelace, Material Web, FAST, Ionic/Stencil, Lit) are consumed as pinned
 * npm packages, exactly as a real application would consume them.
 *
 * The qualification pins, per consumed third-party Web Component kind:
 * - tag presence and authored literal attributes in the SSG HTML,
 * - authored light-DOM children surviving verbatim for the slot-first
 *   probes; other client-only labels are stamped at island activation,
 * - presence/absence of a DSD `<template shadowrootmode>` per component kind,
 * - the data-eid event-binding attribute (v0.44: never — the legacy
 *   marker-based event binding was replaced by compiled event Parts claimed
 *   in place, and foreign hosts are opaque to the compiler),
 * - the admission decision the build's ssrAdmissionPlan assigned
 *   ('unscanned' when the tag never enters the scan; #979/0.43.0-alpha.2
 *   records consumed foreign tags as explicit source:'foreign' client-only
 *   decisions, so corpus tags now classify as 'client-only'),
 * - browser-level capability evidence (registration, upgrade, shadow root,
 *   slot projection, attribute/property reflection, composed events,
 *   hydration safety) including interaction event propagation,
 * - metadata availability per library (CEM / Stencil collection manifest).
 *
 * The point is pinning each library's observed behavior as a known form, not
 * asserting one specific form is 'correct'.
 *
 * Prints the deterministic record to stdout. CI may retain ordinary job
 * output; generated evidence is not committed to the product repository.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';
import { formatJson } from '@openelement/element/build-utils';
import { escapeRegExp } from '../../../tools/lib/text.ts';
import { runStep } from '../../lib/qualify-harness/command-run.ts';
import { extractSsrAdmissionPlan } from '../../lib/qualify-harness/admission-plan.ts';
import { runRouterBuild } from '../../lib/qualify-harness/build-router.ts';
import {
  launchQualifyBrowser,
  type QualifyBrowserName,
} from '../../lib/qualify-harness/drive-chromium.ts';
import { scaffoldApp } from '../../lib/qualify-harness/scaffold-app.ts';
import {
  applyWorkspaceAliases,
  installAppDependencies,
} from '../../lib/qualify-harness/workspace-alias.ts';

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const PROJECT_NAME = 'third-party-web-components-app';

// Plain package.json ranges for the scaffolded app's dependencies (the
// import-map prefix shapes of the Deno era are gone: the bare package pin
// covers every subpath).
const THIRD_PARTY_IMPORTS = {
  lit: '3.3.3',
  '@shoelace-style/shoelace': '2.20.1',
  '@material/web': '2.4.1',
  '@microsoft/fast-element': '3.0.2',
  '@ionic/core': '8.8.18',
  // The A3 authoring path. Already a direct dependency of @ionic/core at this
  // exact version, so this pins the copy the app already installs rather than
  // adding one: 0 extra bytes, local and in CI.
  '@stencil/core': '4.43.5',
};

async function readEventCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    // The route element composes through the starter's layout shadow root
    // (the alpha.15 starter ships the layout); the probe pierces it.
    const pierce = (sel: string): Element | null => {
      const flat = document.querySelector(sel);
      if (flat) return flat;
      for (const shell of document.querySelectorAll('app-layout')) {
        const hit = (shell.shadowRoot ?? shell).querySelector(sel);
        if (hit) return hit;
      }
      return null;
    };
    const fixture = pierce('third-party-wc')?.shadowRoot?.querySelector(
      'wc-fixture',
    ) as HTMLElement | null;
    const root = fixture?.shadowRoot;
    const eventText = root?.querySelector('#event-count')?.textContent ?? '';
    return Number(eventText.replace(/\D+/g, ''));
  });
}

async function interactAndVerifyEventCount(page: Page, startCount: number): Promise<void> {
  const expectCount = async (expected: number, label: string): Promise<void> => {
    await page.waitForFunction((target) => {
      // The compiled page class renders under the path-derived tag; with the
      // starter's layout the page element composes through the
      // layout's shadow root, so the probe pierces the layout.
      const pierce = (sel: string): Element | null => {
        const flat = document.querySelector(sel);
        if (flat) return flat;
        for (const shell of document.querySelectorAll('app-layout')) {
          const hit = (shell.shadowRoot ?? shell).querySelector(sel);
          if (hit) return hit;
        }
        return null;
      };
      const fixture = pierce('third-party-wc')?.shadowRoot?.querySelector(
        'wc-fixture',
      ) as HTMLElement | null;
      const root = fixture?.shadowRoot;
      const eventText = root?.querySelector('#event-count')?.textContent ?? '';
      return Number(eventText.replace(/\D+/g, '')) >= target;
    }, expected);
    const actual = await readEventCount(page);
    if (actual < expected) {
      throw new Error(`${label}: expected event count >= ${expected}, got ${actual}`);
    }
  };

  // Lit counter click dispatches a composed CustomEvent('lit-count').
  await page.locator('wc-lit-counter').locator('#lit-button').click();
  await expectCount(startCount + 1, 'Lit counter click');

  // Shoelace button click.
  await page.locator('sl-button#sl-button').click();
  await expectCount(startCount + 2, 'Shoelace button click');

  // Shoelace switch change.
  await page.locator('sl-switch#sl-switch').click();
  await expectCount(startCount + 3, 'Shoelace switch change');

  // Material button click.
  await page.locator('md-filled-button#md-button').click();
  await expectCount(startCount + 4, 'Material button click');

  // Material switch change.
  await page.locator('md-switch#md-switch').click();
  await expectCount(startCount + 5, 'Material switch change');

  // Bare-native badge click.
  await page.locator('wc-native-badge#native-badge').click();
  await expectCount(startCount + 6, 'Native badge click');

  await page.locator('wc-fast-counter').locator('#fast-button').click();
  await expectCount(startCount + 7, 'FAST counter event');

  await page.locator('ion-button#ionic-button').click();
  await expectCount(startCount + 8, 'Stencil/Ionic click');
}

export interface BrowserCapabilityEvidence {
  registered: boolean;
  upgraded: boolean;
  shadowRoot: boolean;
  slotContent: boolean | null;
  attributeProperty: boolean | null;
  eventObserved: boolean | null;
  hydrationSafe: boolean | null;
}

interface SlotFirstEvidence {
  contentWithoutJs: boolean;
  undefinedStyle: boolean;
  definedStyle: boolean;
  capturedBeforeUpgrade: boolean;
  hostPreserved: boolean;
  identityPreserved: boolean;
}

export interface LateHostEvidence {
  /** Per-creator: the island tag was found AND had upgraded in place. */
  upgraded: Record<string, boolean>;
  /** The closed-root gap, recorded as an observation (never a pass). */
  closedRoot: { hostPresent: boolean; notRegistered: boolean; notUpgraded: boolean };
  /** A declared island this page never hosts: registered, and fetched how often. */
  unused: { registered: boolean; chunkRequests: number };
  /** What the runtime said it gave up on, and under which budget. */
  hostTimeouts: { pending: string[]; attempts: number; elapsedMs: number }[];
  /** Island chunks this page actually requested — the 0-fetch control's floor. */
  islandChunkRequests: number;
}

export async function verifyBrowser(
  distDir: string,
  browserName: QualifyBrowserName = 'chromium',
): Promise<{
  capabilities: Record<string, BrowserCapabilityEvidence>;
  slotFirst: Record<string, SlotFirstEvidence>;
  browserVersion: string;
  lateHosts: LateHostEvidence;
}> {
  const session = await launchQualifyBrowser({ distDir, browserName });
  try {
    const slotFirst: Record<string, SlotFirstEvidence> = {};
    const slotText = new Map(
      CORPUS.filter((entry) => entry.expect.lightDomChildren.length > 0).map(
        (entry) => [entry.tag, entry.expect.lightDomChildren[0]] as const,
      ),
    );
    const noJs = await session.browser.newContext({ javaScriptEnabled: false });
    try {
      const rawPage = await noJs.newPage();
      await rawPage.goto(`${session.origin}/third-party-wc/`);
      for (const [tag, expected] of slotText) {
        const host = rawPage.locator(tag).first();
        slotFirst[tag] = {
          contentWithoutJs: (await host.textContent())?.includes(expected) === true,
          undefinedStyle:
            (await rawPage.locator(`${tag}:not(:defined)`).count()) > 0 &&
            (await host.evaluate(
              (node) => getComputedStyle(node).outlineColor === 'rgb(0, 120, 80)',
            )),
          definedStyle: false,
          capturedBeforeUpgrade: false,
          hostPreserved: false,
          identityPreserved: false,
        };
      }
    } finally {
      await noJs.close();
    }
    const page = await session.browser.newPage();
    session.watchPageErrors(page);
    const browserErrors = session.pageErrors;
    // The probe's give-up signal: registered before load so nothing is missed,
    // and read back after the readiness poll. It is informational — an app may
    // legitimately declare islands a page never hosts — so the fixture uses it
    // as evidence about WHICH tags the runtime could not reach, not as a
    // failure trigger of its own.
    await page.addInitScript(() => {
      const seen: unknown[] = [];
      (globalThis as typeof globalThis & { __oeHostTimeouts?: unknown[] }).__oeHostTimeouts = seen;
      document.addEventListener('open:island-host-timeout', (event) => {
        seen.push((event as CustomEvent).detail);
      });
    });
    // C4 negative control: which island chunks this page actually fetched. The
    // island that is declared but never hosted must not appear here, and a tag
    // that DID activate must — the second half is the positive control that
    // keeps the naming-based assertion honest.
    const requestedUrls: string[] = [];
    page.on('request', (request) => requestedUrls.push(request.url()));
    await page.addInitScript(() => {
      const captured = new Map<string, { host: Element; child: Node }>();
      const tags = ['wc-lit-counter', 'sl-button', 'md-filled-button'];
      const observed = new Set<Node>();
      const watch = new MutationObserver(() => {
        // The route element is body-level (no layout island, #1530): body is
        // the outermost node the pre-upgrade capture watches.
        const appRoot = document.body;
        const pierce = (sel: string): Element | null => {
          const flat = document.querySelector(sel);
          if (flat) return flat;
          for (const shell of document.querySelectorAll('app-layout')) {
            const hit = (shell.shadowRoot ?? shell).querySelector(sel);
            if (hit) return hit;
          }
          return null;
        };
        const routeRoot = pierce('third-party-wc')?.shadowRoot;
        const root = routeRoot?.querySelector('wc-fixture')?.shadowRoot;
        for (const candidate of [appRoot, routeRoot, root]) {
          if (candidate && !observed.has(candidate)) {
            watch.observe(candidate, { childList: true, subtree: true });
            observed.add(candidate);
          }
        }
        if (!root) return;
        for (const tag of tags) {
          if (captured.has(tag) || customElements.get(tag)) continue;
          const host = root.querySelector(tag);
          // Pure-text light children (sl-button, md-filled-button) have no
          // firstElementChild, so the identity snapshot pins the first child
          // NODE — a text node carries the same host/child identity evidence
          // an element child does.
          if (host && host.firstChild) captured.set(tag, { host, child: host.firstChild });
        }
        if (captured.size === tags.length) watch.disconnect();
      });
      watch.observe(document, { childList: true, subtree: true });
      (
        globalThis as typeof globalThis & {
          __wcBeforeUpgrade?: Map<string, { host: Element; child: Node }>;
        }
      ).__wcBeforeUpgrade = captured;
    });
    await page.goto(`${session.origin}/third-party-wc/`);

    const expectedTags = [
      'wc-lit-counter',
      'wc-lit-host',
      'wc-fixture',
      'wc-open-child',
      'wc-native-badge',
      'sl-button',
      'sl-switch',
      'md-filled-button',
      'md-outlined-text-field',
      'md-switch',
      'wc-fast-counter',
      'ion-button',
      // Late-host corpus (A2/A4/B/C1). Registration is the contract-level
      // assertion: each of these tags has no host at page ready, so it can
      // only appear here if the runtime rediscovered a late host. The two
      // deliberate exceptions are asserted the other way round below.
      'wc-open-fast',
      'wc-open-native',
      'wc-open-light',
      'wc-open-nested',
      'wc-open-stencil',
    ];
    try {
      await page.waitForFunction(
        (tags) => tags.every((tag) => customElements.get(tag)),
        expectedTags,
        { timeout: 10_000 },
      );
    } catch {
      const missing = await page.evaluate(
        (tags) => tags.filter((tag) => !customElements.get(tag)),
        expectedTags,
      );
      throw new Error(
        `custom-element registration failed; missing=${missing.join(',')}; browserErrors=${browserErrors.join(
          ' | ',
        )}`,
      );
    }

    const thirdPartyReady = (diagnostic = false) => {
      // Browser-evaluable end to end: the page element composes through the
      // starter's layout shadow root, so the probe pierces the layout.
      const pierce = (sel: string): Element | null => {
        const flat = document.querySelector(sel);
        if (flat) return flat;
        for (const shell of document.querySelectorAll('app-layout')) {
          const hit = (shell.shadowRoot ?? shell).querySelector(sel);
          if (hit) return hit;
        }
        return null;
      };
      const fixture = pierce('third-party-wc')?.shadowRoot?.querySelector(
        'wc-fixture',
      ) as HTMLElement | null;
      const lit = fixture?.shadowRoot?.querySelector('wc-lit-counter') as HTMLElement & {
        shadowRoot?: ShadowRoot;
      };
      const litHost = fixture?.shadowRoot?.querySelector('wc-lit-host') as HTMLElement & {
        shadowRoot?: ShadowRoot;
      };
      const readiness = {
        fixture: !!fixture,
        fixtureShadow: !!fixture?.shadowRoot,
        litButton: !!lit?.shadowRoot?.querySelector('#lit-button'),
        litOpenChild: !!litHost?.shadowRoot?.querySelector('wc-open-child'),
        fastShadow: !!fixture?.shadowRoot?.querySelector('wc-fast-counter')?.shadowRoot,
        ionicShadow: !!fixture?.shadowRoot?.querySelector('ion-button')?.shadowRoot,
        // Late-host corpus: the host exists only after the dynamically
        // imported module defined its creator, so these clauses can only be
        // true if the runtime found a host that appeared after page ready.
        // Each is read through the creator's OWN open shadow root (or, for the
        // light-DOM case, as a light child of the third-party host).
        fastLateHost: !!fixture?.shadowRoot
          ?.querySelector('wc-fast-host')
          ?.shadowRoot?.querySelector('wc-open-fast'),
        nativeLateHost: !!fixture?.shadowRoot
          ?.querySelector('wc-native-late-host')
          ?.shadowRoot?.querySelector('wc-open-native'),
        stencilLateHost: !!fixture?.shadowRoot
          ?.querySelector('wc-stencil-host')
          ?.shadowRoot?.querySelector('wc-open-stencil'),
        nestedLateHost: !!fixture?.shadowRoot
          ?.querySelector('wc-nested-outer')
          ?.shadowRoot?.querySelector('wc-lit-nested-host')
          ?.shadowRoot?.querySelector('wc-open-nested'),
        lightLateHosts: ['sl-button', 'md-filled-button', 'ion-button'].every(
          (selector) =>
            !!fixture?.shadowRoot?.querySelector(selector)?.querySelector('wc-open-light'),
        ),
      };
      return diagnostic ? readiness : Object.values(readiness).every(Boolean);
    };
    try {
      await page.waitForFunction(thirdPartyReady, false, { timeout: 30_000 });
    } catch {
      const readiness = await page.evaluate(thirdPartyReady, true);
      throw new Error(
        `third-party upgrade readiness timed out: ${JSON.stringify(readiness)}; ` +
          `browserErrors=${browserErrors.join(' | ')}`,
      );
    }

    // Read back the probe's give-up signal now that the page has settled: on
    // this page the closed-root island is expected to appear here (that is the
    // diagnosable substitute for a silent drop), while the unused island's
    // absence from the request log is the negative control on fetching.
    //
    // The wait is real and bounded: the probe spends its whole budget before it
    // gives up, so at readiness time the event has not fired yet. A miss here
    // is not thrown — the assertion below reports it with the event payloads,
    // which is a far better message than a raw poll timeout.
    await page
      .waitForFunction(
        () =>
          (globalThis as typeof globalThis & { __oeHostTimeouts?: unknown[] }).__oeHostTimeouts
            ?.length !== 0,
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    const hostTimeouts = (await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __oeHostTimeouts?: { pending: string[]; attempts: number; elapsedMs: number }[];
          }
        ).__oeHostTimeouts ?? [],
    )) as { pending: string[]; attempts: number; elapsedMs: number }[];
    const strandedTags = new Set(hostTimeouts.flatMap((entry) => entry.pending));
    const fetchedIslandChunks = requestedUrls.filter(
      (url) => url.includes('/islands/') || url.includes('island'),
    );

    const summary = await page.evaluate(() => {
      // The page element composes through the starter's layout shadow root.
      const pierce = (sel: string): Element | null => {
        const flat = document.querySelector(sel);
        if (flat) return flat;
        for (const shell of document.querySelectorAll('app-layout')) {
          const hit = (shell.shadowRoot ?? shell).querySelector(sel);
          if (hit) return hit;
        }
        return null;
      };
      const fixture = pierce('third-party-wc')?.shadowRoot?.querySelector(
        'wc-fixture',
      ) as HTMLElement | null;
      const root = fixture?.shadowRoot;
      if (!fixture || !root) throw new Error('wc-fixture shadow root missing');
      const lit = root.querySelector('wc-lit-counter') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const litHost = root.querySelector('wc-lit-host') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const openChild = litHost.shadowRoot.querySelector('wc-open-child') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const eventText = root.querySelector('#event-count')?.textContent ?? '';
      const eventCount = Number(eventText.replace(/\D+/g, ''));

      // Late-host corpus: the island tag has to be there AND have upgraded —
      // registration alone would prove the chunk loaded, not that it landed on
      // a host that arrived after page ready.
      //
      // Shadow-interior islands are NOT reachable from this root with a plain
      // querySelector: they live inside the creator's own shadow root, which is
      // the entire point of the corpus. Each one is resolved through its
      // creator's chain instead, and `upgraded` is only the last step.
      const upgraded = (el: Element | null | undefined, marker: string): boolean => {
        const host = el as (HTMLElement & { shadowRoot?: ShadowRoot }) | null | undefined;
        return !!host?.shadowRoot?.textContent?.includes(marker);
      };
      /** Descend a chain of shadow hosts, one open root per selector. */
      const pierceRoot = (selectors: readonly string[]): Element | null => {
        let scope: ParentNode | null = root;
        let found: Element | null = null;
        for (const selector of selectors) {
          found = scope?.querySelector(selector) ?? null;
          if (!found) return null;
          scope = (found as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot ?? null;
        }
        return found;
      };

      return {
        eventCount,
        litSlot: lit.textContent?.includes('Lit slot label') ?? false,
        litHostContainsOpenElement:
          !!openChild &&
          openChild.shadowRoot?.textContent?.includes('openElement child inside Lit'),
        shoelaceReady: !!root.querySelector('sl-dialog'),
        materialReady:
          !!root.querySelector('md-filled-button') &&
          !!root.querySelector('md-outlined-text-field') &&
          !!root.querySelector('md-switch'),
        nativeBadgeShadow: !!(
          root.querySelector('wc-native-badge') as HTMLElement
        )?.shadowRoot?.querySelector('slot'),
        fastReady: !!(
          root.querySelector('wc-fast-counter') as HTMLElement
        )?.shadowRoot?.querySelector('#fast-button'),
        ionicReady: !!(root.querySelector('ion-button') as HTMLElement)?.shadowRoot,
        lateFast: upgraded(
          pierceRoot(['wc-fast-host', 'wc-open-fast']),
          'openElement child inside FAST',
        ),
        lateNative: upgraded(
          pierceRoot(['wc-native-late-host', 'wc-open-native']),
          'openElement child inside a native element',
        ),
        lateNested: upgraded(
          pierceRoot(['wc-nested-outer', 'wc-lit-nested-host', 'wc-open-nested']),
          'openElement child inside nested shadow roots',
        ),
        lateStencil: upgraded(
          pierceRoot(['wc-stencil-host', 'wc-open-stencil']),
          'openElement child inside Stencil',
        ),
        lateLight: upgraded(root.querySelector('wc-open-light'), 'openElement child appended late'),
        // The closed-root gap, stated as an observation rather than a failure:
        // `wc-open-closed` is created inside a closed root, so it can never be
        // reached and must NOT be registered. Recorded as a documented gap.
        closedRootProbe: {
          closedHostPresent: !!root.querySelector('wc-closed-host'),
          unreachableNotRegistered: !customElements.get('wc-open-closed'),
          unreachableNotUpgraded: !(
            root.querySelector('wc-closed-host') as HTMLElement & { shadowRoot?: ShadowRoot }
          )?.shadowRoot,
        },
        // The negative control: a declared island this page never hosts.
        unusedNotRegistered: !customElements.get('wc-unused-late'),
      };
    });

    if (!Number.isFinite(summary.eventCount)) throw new Error('Event counter did not render');
    if (!summary.litSlot) throw new Error('Lit slot content did not render');
    if (!summary.litHostContainsOpenElement) {
      throw new Error('Lit host did not contain openElement child');
    }
    if (!summary.shoelaceReady) throw new Error('Shoelace components were not present');
    if (!summary.materialReady) throw new Error('Material Web components were not present');
    if (!summary.nativeBadgeShadow) throw new Error('Native badge shadow root did not render');
    if (!summary.fastReady) throw new Error('FAST fixture did not upgrade');
    if (!summary.ionicReady) throw new Error('Stencil/Ionic fixture did not upgrade');

    // ── Late-host contract (the assertions the probe exists to satisfy) ──
    const lateHostFailures: string[] = [];
    if (!summary.lateFast) lateHostFailures.push('FAST open shadow root late host did not upgrade');
    if (!summary.lateNative) {
      lateHostFailures.push('bare-native open shadow root late host did not upgrade');
    }
    if (!summary.lateNested) {
      lateHostFailures.push('nested open shadow root late host did not upgrade');
    }
    if (!summary.lateStencil) {
      lateHostFailures.push('Stencil open shadow root late host did not upgrade');
    }
    if (!summary.lateLight) {
      lateHostFailures.push('light-DOM appended late host did not upgrade');
    }
    if (!summary.closedRootProbe.closedHostPresent) {
      lateHostFailures.push('closed-root host was not created (fixture wiring broken)');
    }
    if (!summary.closedRootProbe.unreachableNotRegistered) {
      // If this ever fires, something reached into a closed root — a contract
      // violation, not a missing feature.
      lateHostFailures.push('a host inside a CLOSED shadow root was activated');
    }
    if (!summary.unusedNotRegistered) {
      lateHostFailures.push('an island this page never hosts was registered (B2 violation)');
    }
    // C5: the unreachable tag must be NAMED, not silently dropped. The probe's
    // event is informational, so the fixture reads it as evidence that the
    // runtime knew it had given up and said which tag it gave up on.
    if (!strandedTags.has('wc-open-closed')) {
      lateHostFailures.push(
        'the closed-root island was never named by open:island-host-timeout ' +
          `(a silent drop); events=${JSON.stringify(hostTimeouts)}`,
      );
    }
    // C4 negative: an island this page never hosts must cost zero fetches. The
    // positive half keeps the assertion honest — a chunk that DID activate has
    // to show up in the same log, otherwise the check proves nothing.
    const unusedFetched = fetchedIslandChunks.filter((url) => url.includes('wc-unused-late'));
    if (unusedFetched.length > 0) {
      lateHostFailures.push(`unused island chunk was fetched: ${unusedFetched.join(', ')}`);
    }
    if (fetchedIslandChunks.length === 0) {
      lateHostFailures.push(
        'no island chunk URLs were observed at all: the 0-fetch control cannot be trusted',
      );
    }
    if (lateHostFailures.length > 0) {
      throw new Error(
        `late-host contract failed: ${lateHostFailures.join('; ')}; ` +
          `hostTimeouts=${JSON.stringify(hostTimeouts)}`,
      );
    }

    // Interaction event propagation checks for #221.
    await interactAndVerifyEventCount(page, summary.eventCount);
    const evidence = await page.evaluate(() => {
      const pierce = (sel: string): Element | null => {
        const flat = document.querySelector(sel);
        if (flat) return flat;
        for (const shell of document.querySelectorAll('app-layout')) {
          const hit = (shell.shadowRoot ?? shell).querySelector(sel);
          if (hit) return hit;
        }
        return null;
      };
      const root = pierce('third-party-wc')?.shadowRoot?.querySelector('wc-fixture')?.shadowRoot;
      if (!root) throw new Error('fixture root unavailable for capability evidence');
      const eventLog =
        (window as Window & { __thirdPartyWcEventLog?: string[] }).__thirdPartyWcEventLog ?? [];
      const probe = (
        tag: string,
        options: { slot?: string; attributeProperty?: boolean; event?: string } = {},
      ) => {
        const element = root.querySelector(tag) as HTMLElement | null;
        return {
          registered: !!customElements.get(tag.split(/[.#]/)[0]),
          upgraded: !!element && element.constructor !== HTMLElement,
          shadowRoot: !!element?.shadowRoot,
          slotContent: options.slot ? element?.textContent?.includes(options.slot) === true : null,
          attributeProperty: options.attributeProperty ?? null,
          eventObserved: options.event ? eventLog.includes(options.event) : null,
          hydrationSafe: null,
        };
      };
      const fast = root.querySelector('wc-fast-counter') as HTMLElement & { count?: number };
      const ionic = root.querySelector('ion-button') as HTMLElement & { disabled?: boolean };
      const lit = root.querySelector('wc-lit-counter') as HTMLElement & { label?: string };
      const slButton = root.querySelector('sl-button') as HTMLElement & { variant?: string };
      const slSwitch = root.querySelector('sl-switch') as HTMLElement & { checked?: boolean };
      const slDialog = root.querySelector('sl-dialog') as HTMLElement & { label?: string };
      const mdButton = root.querySelector('md-filled-button') as HTMLElement & {
        disabled?: boolean;
      };
      const mdField = root.querySelector('md-outlined-text-field') as HTMLElement & {
        value?: string;
      };
      const mdSwitch = root.querySelector('md-switch') as HTMLElement & { selected?: boolean };
      fast.setAttribute('data-probe', 'fast');
      ionic.disabled = true;
      mdButton.disabled = true;
      const evidence: Record<string, BrowserCapabilityEvidence> = {
        'wc-fixture': {
          registered: !!customElements.get('wc-fixture'),
          upgraded: root.host.constructor !== HTMLElement,
          shadowRoot: true,
          slotContent: null,
          attributeProperty: null,
          eventObserved: null,
          hydrationSafe: null,
        },
        'wc-lit-counter': probe('wc-lit-counter', {
          slot: 'Lit slot label',
          attributeProperty: lit.label === 'Lit counter',
          event: 'lit-count',
        }),
        'wc-lit-host': probe('wc-lit-host'),
        'sl-button': probe('sl-button', {
          slot: 'Shoelace Button',
          attributeProperty: slButton.variant === 'primary',
          event: 'sl-button',
        }),
        'sl-switch': probe('sl-switch', {
          slot: 'Shoelace Switch',
          attributeProperty: typeof slSwitch.checked === 'boolean',
          event: 'sl-switch',
        }),
        'sl-dialog': probe('sl-dialog', {
          slot: 'Dialog content',
          attributeProperty: slDialog.label === 'Shoelace Dialog',
        }),
        'md-filled-button': probe('md-filled-button', {
          slot: 'Material Button',
          attributeProperty: mdButton.disabled === true,
          event: 'md-button',
        }),
        'md-outlined-text-field': probe('md-outlined-text-field', {
          attributeProperty: mdField.value === 'interop',
        }),
        'md-switch': probe('md-switch', {
          attributeProperty: typeof mdSwitch.selected === 'boolean',
          event: 'md-switch',
        }),
        'wc-native-badge': probe('wc-native-badge', {
          slot: 'Native badge light child',
          event: 'native-badge',
        }),
        'wc-fast-counter': probe('wc-fast-counter', {
          slot: 'FAST slot label',
          attributeProperty: fast.getAttribute('data-probe') === 'fast' && fast.count === 1,
          event: 'fast-count',
        }),
        'ion-button': probe('ion-button', {
          slot: 'Ionic Stencil Button',
          attributeProperty: ionic.disabled === true,
          event: 'ionic-button',
        }),
      };
      ionic.disabled = false;
      mdButton.disabled = false;
      return evidence;
    });
    if (browserErrors.length > 0) {
      throw new Error(`browser/hydration errors: ${browserErrors.join(' | ')}`);
    }
    for (const tag of slotText.keys()) {
      const host = page.locator(tag).first();
      slotFirst[tag].definedStyle =
        (await page.locator(`${tag}:defined`).count()) > 0 &&
        (await host.evaluate((node) => getComputedStyle(node).outlineColor === 'rgb(80, 80, 80)'));
      const identity = await page.evaluate((name) => {
        const before = (
          globalThis as typeof globalThis & {
            __wcBeforeUpgrade?: Map<string, { host: Element; child: Node }>;
          }
        ).__wcBeforeUpgrade?.get(name);
        const root = document
          .querySelector('third-party-wc')
          ?.shadowRoot?.querySelector('wc-fixture')?.shadowRoot;
        const current = root?.querySelector(name);
        return {
          capturedBeforeUpgrade: !!before,
          hostPreserved: !!before && current === before.host,
          identityPreserved:
            !!before && current === before.host && current.firstChild === before.child,
        };
      }, tag);
      Object.assign(slotFirst[tag], identity);
      // README contract: hydration safety is null unless pre-upgrade identity
      // was actually captured — a missing capture is a probe gap, never
      // evidence of unsafety.
      evidence[tag].hydrationSafe = identity.capturedBeforeUpgrade
        ? identity.identityPreserved
        : null;
    }
    return {
      capabilities: evidence,
      slotFirst,
      browserVersion: session.browser.version(),
      lateHosts: {
        upgraded: {
          lit: summary.litHostContainsOpenElement,
          fast: summary.lateFast,
          native: summary.lateNative,
          nested: summary.lateNested,
          stencil: summary.lateStencil,
          lightDom: summary.lateLight,
        },
        closedRoot: {
          hostPresent: summary.closedRootProbe.closedHostPresent,
          notRegistered: summary.closedRootProbe.unreachableNotRegistered,
          notUpgraded: summary.closedRootProbe.unreachableNotUpgraded,
        },
        unused: {
          registered: !summary.unusedNotRegistered,
          chunkRequests: requestedUrls.filter((url) => url.includes('wc-unused-late')).length,
        },
        hostTimeouts,
        islandChunkRequests: fetchedIslandChunks.length,
      },
    };
  } finally {
    await session.close();
  }
}

async function verifySsrHtml(appDir: string): Promise<void> {
  const html = await readFile(join(appDir, 'dist', 'third-party-wc', 'index.html'), 'utf8');
  // SSR form: foreign tags remain opaque hosts; three slot-first Lit probes
  // have server-born children, while the other labels are attached by the
  // fixture after activation. The legacy data-eid marker is not emitted.
  for (const expected of [
    '<wc-fixture',
    '<wc-lit-counter',
    '<sl-button',
    '<sl-switch',
    '<sl-dialog',
    '<md-filled-button',
    '<md-outlined-text-field',
    '<md-switch',
    '<wc-native-badge',
    '<wc-fast-counter',
    '<ion-button',
    'label="Lit counter"',
    'variant="primary"',
    'label="Shoelace Dialog"',
    'value="interop"',
  ]) {
    if (!html.includes(expected)) {
      throw new Error(`SSR output missing ${expected}`);
    }
  }
}

const FIXTURE_SOURCE_FILES = [
  'app/routes/third-party-wc.tsx',
  'app/components/page-third-party-wc.tsx',
  'app/components/wc-page.css',
  'app/islands/wc-fixture.tsx',
  'app/islands/wc-fixture.css',
  'app/islands/wc-open-child.tsx',
  'app/client/wc-client.ts',
  // The late-host corpus: each of these islands has no host in the SSR markup,
  // and each wc-*-host that creates one lives in wc-late-hosts.ts.
  'app/islands/wc-open-fast.tsx',
  'app/islands/wc-open-native.tsx',
  'app/islands/wc-open-stencil.tsx',
  'app/islands/wc-open-light.tsx',
  'app/islands/wc-open-nested.tsx',
  'app/islands/wc-open-closed.tsx',
  'app/islands/wc-unused-late.tsx',
  'app/client/wc-late-hosts.ts',
  // A3: the Stencil source and its build config, compiled in the temp app.
  'app/stencil/wc-stencil-host.tsx',
  'app/stencil/tsconfig.json',
  'stencil.config.ts',
] as const;

/**
 * Create a temp app from packages/create, patch it to consume the third-party
 * WC fixture, copy the fixture sources in, and build it. Returns the app dir.
 */
export async function prepareFixtureApp(tmpRoot: string): Promise<string> {
  const appDir = await scaffoldApp({
    workDir: tmpRoot,
    projectName: PROJECT_NAME,
    createCli: join(repoRoot, 'packages', 'create', 'src', 'cli.ts'),
    // --no-install: the scaffold's default install resolves `^<version>`
    // framework ranges against the registry, and the candidate version is
    // unpublished at gate time — that install is the release:check
    // ERR_PNPM_NO_MATCHING_VERSION trap (T3). applyWorkspaceAliases rewrites
    // those deps to workspace `link:` entries and installAppDependencies below
    // runs the real install against them.
    extraArgs: ['--no-install'],
    copySources: { fromRoot: fixtureDir, files: FIXTURE_SOURCE_FILES },
  });
  await applyWorkspaceAliases(appDir, {
    repoRoot,
    extraImports: THIRD_PARTY_IMPORTS,
    // This fixture pins island activation to the load strategy: the slot-first
    // probes capture pre-upgrade DOM only when hydration does not race them.
    transformViteConfig: (text) =>
      text.replace(
        "packageIslands: ['@acme/components'],",
        "packageIslands: ['@acme/components'],\n    island: { upgradeStrategy: 'load' },",
      ),
  });
  // The install materializes the scaffolded app's npm dependencies up front
  // (same mechanism as the web-component-interop qualify harness), so
  // vite.config.ts resolves when the build loads it.
  await installAppDependencies(appDir);
  // A3: compile the fixture's own Stencil host before the router build, which
  // imports its dist-custom-elements output. A nonzero exit fails the fixture
  // loudly — there is no silent fallback to "no Stencil host".
  await runStep(
    join(appDir, 'node_modules', '.bin', 'stencil'),
    ['build', '--config', 'stencil.config.ts'],
    { cwd: appDir },
  );
  await runRouterBuild(appDir);
  return appDir;
}

interface CorpusExpectation {
  /** Authored light-DOM children surviving SSR for slot-first probes. */
  lightDomChildren: string[];
  /** Whether SSR emits a DSD shadow template directly inside the tag. */
  dsdTemplate: boolean;
  /** Whether the tag carries a data-eid event-binding attribute (never). */
  dataEid: boolean;
  /** Expected admission renderPath, or 'unscanned' when not in the plan. */
  admission: string;
}

interface CorpusEntry {
  tag: string;
  library: string;
  metadata: 'openelement-config' | 'cem' | 'stencil-collection' | 'none';
  expect: CorpusExpectation;
}

const CORPUS: CorpusEntry[] = [
  // openElement control: a local island with ssr+dsd — the only fixture tag
  // the admission plan should classify at all.
  {
    tag: 'wc-fixture',
    library: '@openelement/router',
    metadata: 'openelement-config',
    expect: {
      lightDomChildren: [],
      dsdTemplate: true,
      dataEid: false,
      admission: 'ssr+client',
    },
  },
  {
    tag: 'wc-lit-counter',
    library: 'lit',
    metadata: 'none',
    expect: {
      lightDomChildren: ['Lit slot label'],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'wc-lit-host',
    library: 'lit',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-button',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: ['Shoelace Button'],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-switch',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-dialog',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-filled-button',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: ['Material Button'],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-outlined-text-field',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-switch',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'wc-native-badge',
    library: 'bare-native',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'wc-fast-counter',
    library: '@microsoft/fast-element@3.0.2',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'ion-button',
    library: '@ionic/core@8.8.18 (Stencil compiled output)',
    metadata: 'stencil-collection',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
];

const METADATA_PROBES = [
  {
    library: '@shoelace-style/shoelace@2.20.1',
    path: 'node_modules/@shoelace-style/shoelace/dist/custom-elements.json',
    format: 'cem',
    expected: true,
  },
  {
    library: '@ionic/core@8.8.18',
    path: 'node_modules/@ionic/core/dist/collection/collection-manifest.json',
    format: 'stencil-collection',
    expected: true,
  },
  {
    library: '@microsoft/fast-element@3.0.2',
    path: 'node_modules/@microsoft/fast-element/custom-elements.json',
    format: 'cem',
    expected: false,
  },
  {
    library: '@material/web@2.4.1',
    path: 'node_modules/@material/web/custom-elements.json',
    format: 'cem',
    expected: false,
  },
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** The observed SSR form of one corpus tag in the built output. */
interface SsrFormObservation {
  tagPresent: boolean;
  lightDomChildren: string[];
  dsdTemplate: boolean;
  dataEid: boolean;
}

/** True when `char` can follow an element name inside its tag (`<name`+char). */
function endsElementName(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === '>' ||
    char === '/' ||
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r'
  );
}

/**
 * The outer HTML of the FIRST `tag` element, or '' when it is absent or
 * unbalanced. Nested same-tag elements are skipped by depth counting.
 *
 * The light-DOM child pin must be read inside the host it belongs to: a whole
 * document `html.includes(child)` also passes when the same text appears in an
 * unrelated element (another tag's authored child, a heading, the `<noscript>`
 * tail), so the probe would no longer evidence this host's slot-first
 * children. Slicing the balanced host range keeps the pin on the host.
 */
export function hostOuterHtml(html: string, tag: string): string {
  const openPrefix = '<' + tag;
  const closePrefix = '</' + tag;
  let start = -1;
  for (let cursor = 0; start < 0;) {
    const candidate = html.indexOf(openPrefix, cursor);
    // `<tag-other` / `<tags>` share the prefix but are not this host.
    if (candidate < 0) return '';
    if (endsElementName(html[candidate + openPrefix.length])) start = candidate;
    else cursor = candidate + 1;
  }
  let depth = 0;
  for (let cursor = start; cursor < html.length;) {
    const nextOpen = html.indexOf(openPrefix, cursor);
    const nextClose = html.indexOf(closePrefix, cursor);
    if (nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen)) {
      depth--;
      cursor = nextClose + closePrefix.length;
      if (depth === 0) {
        const end = html.indexOf('>', cursor);
        return html.slice(start, end < 0 ? html.length : end + 1);
      }
      continue;
    }
    if (nextOpen < 0) return '';
    if (!endsElementName(html[nextOpen + openPrefix.length])) {
      cursor = nextOpen + 1;
      continue;
    }
    const close = html.indexOf('>', nextOpen + openPrefix.length);
    if (close < 0) return '';
    // `<tag/>` closes itself; anything else opens a nested host.
    if (html[close - 1] !== '/') depth++;
    cursor = close + 1;
  }
  return '';
}

function observeSsrForm(html: string, entry: CorpusEntry): SsrFormObservation {
  const openTag = new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>`);
  const match = openTag.exec(html);
  const tagPresent = match !== null;
  const dsdTemplate =
    tagPresent &&
    new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>\\s*<template shadowrootmode`).test(html);
  const dataEid = tagPresent && /\bdata-eid=/.test(match![0]);
  const lightDomChildren = entry.expect.lightDomChildren.filter((child) =>
    hostOuterHtml(html, entry.tag).includes(child),
  );
  return { tagPresent, lightDomChildren, dsdTemplate, dataEid };
}

/**
 * The engines the contract assertions must pass on (owner ruling, G1-5):
 * registration, upgrade, late-host activation, exactly-once and the unused-tag
 * zero-fetch control are contract-level, so a gap in any of them on any engine
 * fails the run. `OPEN_ELEMENT_WC_ENGINES=chromium` is the fast local override;
 * it narrows coverage and must never be set in CI.
 */
const CONTRACT_ENGINES: readonly QualifyBrowserName[] = ['chromium', 'firefox', 'webkit'];

function resolveEngines(): QualifyBrowserName[] {
  const raw = process.env.OPEN_ELEMENT_WC_ENGINES;
  if (raw === undefined || raw.trim() === '') return [...CONTRACT_ENGINES];
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '') as QualifyBrowserName[];
  for (const name of names) {
    if (!CONTRACT_ENGINES.includes(name)) {
      throw new Error(`OPEN_ELEMENT_WC_ENGINES: unknown engine "${name}"`);
    }
  }
  return names.length > 0 ? names : [...CONTRACT_ENGINES];
}

async function main(): Promise<void> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'openelement-third-party-wc-'));
  const keep = process.env.OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE === '1';
  try {
    const appDir = await prepareFixtureApp(tmpRoot);
    await verifySsrHtml(appDir);
    const html = await readFile(join(appDir, 'dist', 'third-party-wc', 'index.html'), 'utf8');
    const entryJs = await readFile(join(appDir, 'dist', 'server', 'entry.js'), 'utf8');
    const plan = extractSsrAdmissionPlan(entryJs);
    const decisionByTag = new Map(plan.decisions.map((d) => [d.tagName, d]));
    // Build once, then run the same probes on every contract engine. The
    // harness throws inside verifyBrowser when a contract assertion fails, so
    // a gap on ANY engine fails the run; what the record adds is the per-engine
    // detail, so a difference is readable instead of being averaged away.
    const engines = resolveEngines();
    const perEngine: Partial<
      Record<QualifyBrowserName, Awaited<ReturnType<typeof verifyBrowser>>>
    > = {};
    for (const engine of engines) {
      perEngine[engine] = await verifyBrowser(join(appDir, 'dist'), engine);
    }
    // The advisory tier report keeps its historical basis — SSR HTML observed
    // once, plus the reference engine's upgrade probes — so its numbers stay
    // comparable with earlier runs. Per-engine evidence lives beside it.
    const reference = perEngine.chromium ?? perEngine[engines[0]!]!;
    const { capabilities: browser, slotFirst, browserVersion, lateHosts } = reference;
    const metadataProbes = await Promise.all(
      METADATA_PROBES.map(async (probe) => ({
        library: probe.library,
        format: probe.format,
        path: probe.path.replace(/^node_modules\//, ''),
        available: await pathExists(join(appDir, probe.path)),
        expected: probe.expected,
      })),
    );

    const failures: string[] = [];
    for (const probe of metadataProbes) {
      if (probe.available !== probe.expected) {
        failures.push(
          `${probe.library}: ${probe.format} availability=${probe.available}, expected ${probe.expected}`,
        );
      }
    }
    const entries = CORPUS.map((entry) => {
      const form = observeSsrForm(html, entry);
      const decision = decisionByTag.get(entry.tag);
      const admission = decision
        ? { renderPath: decision.renderPath, reason: decision.reason }
        : { renderPath: 'unscanned', reason: 'tag never enters the island scan' };

      const e = entry.expect;
      if (!form.tagPresent) failures.push(`${entry.tag}: tag missing from SSR HTML`);
      if (form.lightDomChildren.length !== e.lightDomChildren.length) {
        failures.push(
          `${entry.tag}: light-DOM children ${JSON.stringify(form.lightDomChildren)} != expected ${JSON.stringify(
            e.lightDomChildren,
          )}`,
        );
      }
      if (form.dsdTemplate !== e.dsdTemplate) {
        failures.push(`${entry.tag}: dsdTemplate=${form.dsdTemplate}, expected ${e.dsdTemplate}`);
      }
      if (form.dataEid !== e.dataEid) {
        failures.push(`${entry.tag}: dataEid=${form.dataEid}, expected ${e.dataEid}`);
      }
      if (admission.renderPath !== e.admission) {
        failures.push(
          `${entry.tag}: admission=${admission.renderPath} (${admission.reason}), expected ${e.admission}`,
        );
      }

      const browserCapabilities = browser[entry.tag];
      if (
        !browserCapabilities ||
        !browserCapabilities.registered ||
        !browserCapabilities.upgraded ||
        !browserCapabilities.shadowRoot ||
        browserCapabilities.slotContent === false ||
        browserCapabilities.attributeProperty === false ||
        browserCapabilities.eventObserved === false
      ) {
        failures.push(`${entry.tag}: one or more browser capability probes failed`);
      }
      return {
        tag: entry.tag,
        library: entry.library,
        metadata: entry.metadata,
        admission,
        ssrForm: form,
        browserCapabilities,
      };
    });

    if (failures.length > 0) {
      throw new Error(`SSR corpus mismatches:\n- ${failures.join('\n- ')}`);
    }

    const hash = async (text: string): Promise<string> =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    const tierReport = {
      schemaVersion: 1,
      basis: 'observed SSR HTML and Chromium upgrade; not an adapter declaration',
      evidenceIdentity: {
        candidateSha: process.env.CANDIDATE_SHA ?? null,
        htmlSha256: await hash(html),
        entrySha256: await hash(entryJs),
        node: process.version,
        chromium: browserVersion,
        engines: Object.fromEntries(
          engines.map((engine) => [engine, perEngine[engine]!.browserVersion]),
        ),
      },
      entries: entries
        .filter((entry) => entry.tag !== 'wc-fixture')
        .map((entry) => {
          const slot = slotFirst[entry.tag];
          const t0Failures = [
            ...(!entry.ssrForm.tagPresent ? ['host missing from SSR'] : []),
            ...(entry.ssrForm.dsdTemplate ? ['unexpected foreign DSD'] : []),
            ...(!slot?.contentWithoutJs ? ['slot-first no-JS content not proved'] : []),
            ...(!slot?.undefinedStyle || !slot?.definedStyle
              ? [':defined styling transition not proved']
              : []),
            ...(!slot?.capturedBeforeUpgrade
              ? ['pre-upgrade identity not captured']
              : !slot.identityPreserved
                ? ['host or child identity lost on upgrade']
                : []),
            // 'browser upgrade not proved' covers the upgrade probes only.
            // Hydration-safety nullness (a capture gap) and a real identity
            // loss are both already reported above — counting them here again
            // would double-charge a single missing probe as a failed upgrade.
            ...(!entry.browserCapabilities.registered || !entry.browserCapabilities.upgraded
              ? ['browser upgrade not proved']
              : []),
          ];
          return {
            tag: entry.tag,
            resolvedLibrary:
              THIRD_PARTY_IMPORTS[entry.library as keyof typeof THIRD_PARTY_IMPORTS] ??
              entry.library,
            highestPassedTier: t0Failures.length === 0 ? 'T0' : null,
            t0Failures,
            observations: {
              ssrForm: entry.ssrForm,
              browser: entry.browserCapabilities,
              slotFirst: slot ?? null,
            },
            higherTiers: { T1: 'not run', T2: 'not run', T3: 'not applicable to foreign tag' },
          };
        }),
    };
    const record = {
      schemaVersion: 2,
      // No timestamp: output stays deterministic and diffable in CI logs.
      source: 'tests/fixtures/third-party-web-components/qualify.ts',
      note: 'Pins admission, SSR form, metadata availability, and browser interoperability probes; client-only is an explicit supported path, not an SSR claim.',
      metadataProbes,
      entries,
      slotFirst,
      // The late-host contract, as durable evidence: which creators' islands
      // upgraded after page ready, what the closed-root gap looks like from the
      // outside, that an unhosted island cost zero fetches while island chunks
      // did load, and exactly what the runtime said it gave up on.
      lateHosts,
      // Which engines actually ran, and the contract-level result on each. The
      // full per-engine probe detail sits in `engines` so a capability that one
      // engine lacks is recorded rather than promoted or hidden.
      contractEngines: engines,
      engines: Object.fromEntries(
        engines.map((engine) => {
          const evidence = perEngine[engine]!;
          return [
            engine,
            {
              browserVersion: evidence.browserVersion,
              lateHost: evidence.lateHosts,
              capabilities: evidence.capabilities,
              slotFirst: evidence.slotFirst,
            },
          ];
        }),
      ),
      tierReport,
    };
    const reportPath = process.env.OPEN_ELEMENT_TIER_REPORT;
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, formatJson(tierReport));
    }
    console.log(JSON.stringify(record, null, 2));
    const t0Proved = tierReport.entries.filter((entry) => entry.highestPassedTier === 'T0').length;
    console.log(
      `third-party Web Components diagnostic completed: ${t0Proved}/${tierReport.entries.length} T0 proved; T1/T2 not run`,
    );
  } finally {
    if (keep) {
      console.log(`Keeping third-party WC qualification project at ${tmpRoot}`);
    } else {
      await rm(tmpRoot, { recursive: true });
    }
  }
}

if (import.meta.main) {
  await main();
}
