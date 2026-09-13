#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/**
 * Third-party Web Components qualification fixture.
 *
 * Artifact consumption: this fixture consumes workspace SOURCE artifacts. The
 * runner generates a fresh app with packages/create into a temp directory,
 * aliases every workspace package to its in-repo source (file: URLs in the
 * app import map and Vite config), copies the fixture sources from ./app in,
 * and builds with the in-repo Router build CLI. The third-party libraries
 * (Shoelace, Material Web, FAST, Ionic/Stencil, Lit) are consumed as pinned
 * npm packages, exactly as a real application would consume them.
 *
 * The qualification pins, per consumed third-party Web Component kind:
 * - tag presence and authored literal attributes in the SSG HTML,
 * - authored light-DOM children surviving verbatim (v0.44: none — the
 *   compiler grammar admits foreign hosts as empty static shells with literal
 *   attributes only; slotted content is stamped at island activation and is
 *   pinned by the browser probes instead),
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

import { dirname, fromFileUrl, join } from '@std/path';

import type { Page } from 'npm:playwright@1.59.1';
import { formatJson } from '@openelement/element/build-utils';
import { allPackageAliases } from '../../tools/lib/package-graph.ts';
import { serveStatic } from '../../tools/lib/static-server.ts';
import { escapeRegExp } from '../../tools/lib/text.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

const repoRoot = dirname(dirname(dirname(fromFileUrl(import.meta.url))));
const fixtureDir = dirname(fromFileUrl(import.meta.url));
const PROJECT_NAME = 'third-party-web-components-app';

const THIRD_PARTY_IMPORTS = {
  lit: 'npm:lit@3.3.3',
  '@shoelace-style/shoelace': 'npm:@shoelace-style/shoelace@2.20.1',
  '@shoelace-style/shoelace/': 'npm:@shoelace-style/shoelace@2.20.1/',
  '@material/web': 'npm:@material/web@2.4.1',
  '@material/web/': 'npm:@material/web@2.4.1/',
  '@microsoft/fast-element': 'npm:@microsoft/fast-element@3.0.2',
  '@ionic/core': 'npm:@ionic/core@8.8.18',
  '@ionic/core/': 'npm:@ionic/core@8.8.18/',
};

async function run(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> {
  console.log(`$ deno ${args.join(' ')}  # cwd=${cwd}`);
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (output.success) return;

  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
  throw new Error(`Command failed with exit code ${output.code}: deno ${args.join(' ')}`);
}

async function patchDenoJson(appDir: string): Promise<void> {
  const denoJsonPath = join(appDir, 'deno.json');
  const denoJson = await readJson<{
    imports: Record<string, string>;
    tasks: Record<string, string>;
  }>(denoJsonPath);
  const imports = denoJson.imports;

  Object.assign(imports, THIRD_PARTY_IMPORTS);

  for (const [specifier, url] of allPackageAliases(repoRoot)) {
    imports[specifier] = url;
  }

  denoJson.tasks.build = `deno run --unstable-sloppy-imports --config deno.json -A ${
    join(repoRoot, 'packages', 'router', 'src', 'cli', 'build.ts')
  }`;

  await Deno.writeTextFile(denoJsonPath, formatJson(denoJson));
}

async function patchViteConfig(appDir: string): Promise<void> {
  const viteConfigPath = join(appDir, 'vite.config.ts');
  let text = await Deno.readTextFile(viteConfigPath);

  const aliasText = [...allPackageAliases(repoRoot)]
    .map(([find, url]) =>
      `{ find: '${find}', replacement: '${normalizeSlashes(fromFileUrl(url))}' }`
    )
    .join(',\n        ');

  text = text.replace(
    'export default defineConfig({',
    `export default defineConfig({\n  resolve: {\n    alias: [\n        ${aliasText}\n    ],\n  },`,
  );
  text = text.replace(
    "packageIslands: ['@acme/components'],",
    "packageIslands: ['@acme/components'],\n    island: { upgradeStrategy: 'load' },",
  );
  await Deno.writeTextFile(viteConfigPath, text);
}

async function readEventCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    // The definePage route renders the compiled page class directly under the
    // path-derived tag (third-party-wc); the fixture island lives in its
    // shadow root.
    const fixture = document
      .querySelector('app-shell')
      ?.shadowRoot?.querySelector('third-party-wc')
      ?.shadowRoot?.querySelector('wc-fixture') as HTMLElement | null;
    const root = fixture?.shadowRoot;
    const eventText = root?.querySelector('#event-count')?.textContent ?? '';
    return Number(eventText.replace(/\D+/g, ''));
  });
}

async function interactAndVerifyEventCount(page: Page, startCount: number): Promise<void> {
  const expectCount = async (expected: number, label: string): Promise<void> => {
    await page.waitForFunction((target) => {
      // The compiled page class renders under the path-derived tag; the
      // fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('wc-fixture') as HTMLElement | null;
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
  hydrationSafe: boolean;
}

export async function verifyBrowser(
  distDir: string,
): Promise<Record<string, BrowserCapabilityEvidence>> {
  const { chromium } = await import('npm:playwright@1.59.1');
  const server = serveStatic(distDir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await page.goto(`${server.origin}/third-party-wc/`);

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
        `custom-element registration failed; missing=${missing.join(',')}; browserErrors=${
          browserErrors.join(' | ')
        }`,
      );
    }

    const thirdPartyReady = (diagnostic = false) => {
      // The compiled page class renders under the path-derived tag; the
      // fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('wc-fixture') as HTMLElement | null;
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

    const summary = await page.evaluate(() => {
      // The compiled page class renders under the path-derived tag; the
      // fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('wc-fixture') as HTMLElement | null;
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

      return {
        eventCount,
        litSlot: lit.textContent?.includes('Lit slot label') ?? false,
        litHostContainsOpenElement: !!openChild &&
          openChild.shadowRoot?.textContent?.includes('openElement child inside Lit'),
        shoelaceReady: !!root.querySelector('sl-dialog'),
        materialReady: !!root.querySelector('md-filled-button') &&
          !!root.querySelector('md-outlined-text-field') &&
          !!root.querySelector('md-switch'),
        nativeBadgeShadow: !!(root.querySelector('wc-native-badge') as HTMLElement)
          ?.shadowRoot?.querySelector('slot'),
        fastReady: !!(root.querySelector('wc-fast-counter') as HTMLElement)
          ?.shadowRoot?.querySelector('#fast-button'),
        ionicReady: !!(root.querySelector('ion-button') as HTMLElement)?.shadowRoot,
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

    // Interaction event propagation checks for #221.
    await interactAndVerifyEventCount(page, summary.eventCount);
    const evidence = await page.evaluate(() => {
      const root = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('wc-fixture')?.shadowRoot;
      if (!root) throw new Error('fixture root unavailable for capability evidence');
      const eventLog = (window as Window & { __thirdPartyWcEventLog?: string[] })
        .__thirdPartyWcEventLog ?? [];
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
          hydrationSafe: true,
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
      const evidence = {
        'wc-fixture': {
          registered: !!customElements.get('wc-fixture'),
          upgraded: root.host.constructor !== HTMLElement,
          shadowRoot: true,
          slotContent: null,
          attributeProperty: null,
          eventObserved: null,
          hydrationSafe: true,
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
    return evidence;
  } finally {
    await browser.close();
    await server.close();
  }
}

async function verifySsrHtml(appDir: string): Promise<void> {
  const html = await Deno.readTextFile(join(appDir, 'dist', 'third-party-wc', 'index.html'));
  // SSR form: foreign tags serialize as empty static hosts carrying their
  // authored literal attributes (the compiler grammar v1 admits no host
  // children, so the slotted labels/text are stamped client-side by the
  // fixture island's activation seam; the legacy data-eid event-binding
  // marker is gone — the compiled claim attaches method handlers directly).
  for (
    const expected of [
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
    ]
  ) {
    if (!html.includes(expected)) {
      throw new Error(`SSR output missing ${expected}`);
    }
  }
}

/**
 * Create a temp app from packages/create, patch it to consume the third-party
 * WC fixture, copy the fixture sources in, and build it. Returns the app dir.
 */
export async function prepareFixtureApp(tmpRoot: string): Promise<string> {
  await run(
    ['run', '-A', join(repoRoot, 'packages', 'create', 'src', 'cli.ts'), PROJECT_NAME],
    tmpRoot,
  );
  const appDir = join(tmpRoot, PROJECT_NAME);
  await patchDenoJson(appDir);
  await patchViteConfig(appDir);

  for (
    const src of [
      'app/routes/third-party-wc.tsx',
      'app/components/page-third-party-wc.tsx',
      'app/islands/wc-fixture.tsx',
      'app/islands/wc-styles.ts',
      'app/islands/wc-open-child.tsx',
      'app/client/wc-client.ts',
    ]
  ) {
    Deno.mkdirSync(dirname(join(appDir, src)), { recursive: true });
    Deno.copyFileSync(join(fixtureDir, src), join(appDir, src));
  }

  await run(['task', 'build'], appDir);
  return appDir;
}

interface SsrAdmissionDecision {
  tagName: string;
  modulePath: string;
  source: string;
  renderPath: string;
  reason: string;
}

interface SsrAdmissionPlan {
  renderableTags: string[];
  clientOnlyTags: string[];
  rejectedTags: string[];
  reasons: Record<string, string>;
  decisions: SsrAdmissionDecision[];
}

interface CorpusExpectation {
  /** Authored light-DOM children surviving SSR (always empty — stamped at activation). */
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
      lightDomChildren: [],
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
      lightDomChildren: [],
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
      lightDomChildren: [],
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
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Extract the generated `var ssrAdmissionPlan = {...}` object literal. */
export function extractSsrAdmissionPlan(entryJs: string): SsrAdmissionPlan {
  const marker = 'var ssrAdmissionPlan = ';
  const start = entryJs.indexOf(marker);
  if (start === -1) throw new Error('ssrAdmissionPlan not found in server entry');
  let i = start + marker.length;
  if (entryJs[i] !== '{') throw new Error('ssrAdmissionPlan is not an object literal');
  let depth = 0;
  const begin = i;
  for (; i < entryJs.length; i++) {
    if (entryJs[i] === '{') depth++;
    else if (entryJs[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('ssrAdmissionPlan object literal is unbalanced');
  return JSON.parse(entryJs.slice(begin, i + 1)) as SsrAdmissionPlan;
}

interface SsrFormObservation {
  tagPresent: boolean;
  lightDomChildren: string[];
  dsdTemplate: boolean;
  dataEid: boolean;
}

function observeSsrForm(html: string, entry: CorpusEntry): SsrFormObservation {
  const openTag = new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>`);
  const match = openTag.exec(html);
  const tagPresent = match !== null;
  const dsdTemplate = tagPresent &&
    new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>\\s*<template shadowrootmode`).test(html);
  const dataEid = tagPresent && /\bdata-eid=/.test(match![0]);
  const lightDomChildren = entry.expect.lightDomChildren.filter((child) => html.includes(child));
  return { tagPresent, lightDomChildren, dsdTemplate, dataEid };
}

async function main(): Promise<void> {
  const tmpRoot = await Deno.makeTempDir({ prefix: 'openelement-third-party-wc-' });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE') === '1';
  try {
    const appDir = await prepareFixtureApp(tmpRoot);
    await verifySsrHtml(appDir);
    const html = await Deno.readTextFile(join(appDir, 'dist', 'third-party-wc', 'index.html'));
    const entryJs = await Deno.readTextFile(join(appDir, 'dist', 'server', 'entry.js'));
    const plan = extractSsrAdmissionPlan(entryJs);
    const decisionByTag = new Map(plan.decisions.map((d) => [d.tagName, d]));
    const browser = await verifyBrowser(join(appDir, 'dist'));
    const metadataProbes = await Promise.all(METADATA_PROBES.map(async (probe) => ({
      library: probe.library,
      format: probe.format,
      path: probe.path.replace(/^node_modules\//, ''),
      available: await pathExists(join(appDir, probe.path)),
      expected: probe.expected,
    })));

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
          `${entry.tag}: light-DOM children ${JSON.stringify(form.lightDomChildren)} != expected ${
            JSON.stringify(e.lightDomChildren)
          }`,
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
        Object.values(browserCapabilities).some((value) => value === false)
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

    const record = {
      schemaVersion: 2,
      // No timestamp: output stays deterministic and diffable in CI logs.
      source: 'fixtures/third-party-web-components/qualify.ts',
      note:
        'Pins admission, SSR form, metadata availability, and browser interoperability probes; client-only is an explicit supported path, not an SSR claim.',
      metadataProbes,
      entries,
    };
    console.log(JSON.stringify(record, null, 2));
    console.log('third-party Web Components qualification passed');
  } finally {
    if (keep) {
      console.log(`Keeping third-party WC qualification project at ${tmpRoot}`);
    } else {
      await Deno.remove(tmpRoot, { recursive: true });
    }
  }
}

if (import.meta.main) {
  await main();
}
