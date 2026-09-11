#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/**
 * Third-party WC smoke: verify mature third-party Web Components can be
 * consumed directly inside an openElement app.
 */

import { dirname, fromFileUrl, join } from '@std/path';

import type { Page } from 'npm:playwright@1.59.1';
import { formatJson } from '@openelement/element/build-utils';
import { allPackageAliases } from './lib/package-graph.ts';
import { serveStatic } from './lib/static-server.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const PROJECT_NAME = 'third-party-wc-smoke-app';

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
    join(repoRoot, 'packages', 'adapter-vite', 'src', 'cli', 'build.ts')
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
    // v0.44: the definePage route renders the compiled page class directly
    // under the path-derived tag (third-party-wc); the fixture island lives
    // in its shadow root.
    const fixture = document
      .querySelector('app-shell')
      ?.shadowRoot?.querySelector('third-party-wc')
      ?.shadowRoot?.querySelector('alpha3-wc-fixture') as HTMLElement | null;
    const root = fixture?.shadowRoot;
    const eventText = root?.querySelector('#event-count')?.textContent ?? '';
    return Number(eventText.replace(/\D+/g, ''));
  });
}

async function interactAndVerifyEventCount(page: Page, startCount: number): Promise<void> {
  const expectCount = async (expected: number, label: string): Promise<void> => {
    await page.waitForFunction((target) => {
      // v0.44: the compiled page class renders under the path-derived tag;
      // the fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('alpha3-wc-fixture') as HTMLElement | null;
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
  await page.locator('alpha3-lit-counter').locator('#lit-button').click();
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
  await page.locator('alpha3-native-badge#native-badge').click();
  await expectCount(startCount + 6, 'Native badge click');

  await page.locator('alpha3-fast-counter').locator('#fast-button').click();
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
      'alpha3-lit-counter',
      'alpha3-lit-host',
      'alpha3-wc-fixture',
      'alpha3-open-child',
      'alpha3-native-badge',
      'sl-button',
      'sl-switch',
      'md-filled-button',
      'md-outlined-text-field',
      'md-switch',
      'alpha3-fast-counter',
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
      // v0.44: the compiled page class renders under the path-derived tag;
      // the fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('alpha3-wc-fixture') as HTMLElement | null;
      const lit = fixture?.shadowRoot?.querySelector('alpha3-lit-counter') as HTMLElement & {
        shadowRoot?: ShadowRoot;
      };
      const litHost = fixture?.shadowRoot?.querySelector('alpha3-lit-host') as HTMLElement & {
        shadowRoot?: ShadowRoot;
      };
      const readiness = {
        fixture: !!fixture,
        fixtureShadow: !!fixture?.shadowRoot,
        litButton: !!lit?.shadowRoot?.querySelector('#lit-button'),
        litOpenChild: !!litHost?.shadowRoot?.querySelector('alpha3-open-child'),
        fastShadow: !!fixture?.shadowRoot?.querySelector('alpha3-fast-counter')?.shadowRoot,
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
      // v0.44: the compiled page class renders under the path-derived tag;
      // the fixture island lives in its shadow root.
      const fixture = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('third-party-wc')
        ?.shadowRoot?.querySelector('alpha3-wc-fixture') as HTMLElement | null;
      const root = fixture?.shadowRoot;
      if (!fixture || !root) throw new Error('alpha3-wc-fixture shadow root missing');
      const lit = root.querySelector('alpha3-lit-counter') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const litHost = root.querySelector('alpha3-lit-host') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const openChild = litHost.shadowRoot.querySelector('alpha3-open-child') as HTMLElement & {
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
        nativeBadgeShadow: !!(root.querySelector('alpha3-native-badge') as HTMLElement)
          ?.shadowRoot?.querySelector('slot'),
        fastReady: !!(root.querySelector('alpha3-fast-counter') as HTMLElement)
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
        ?.shadowRoot?.querySelector('alpha3-wc-fixture')?.shadowRoot;
      if (!root) throw new Error('fixture root unavailable for capability evidence');
      const eventLog = (window as Window & { __alpha3EventLog?: string[] }).__alpha3EventLog ?? [];
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
      const fast = root.querySelector('alpha3-fast-counter') as HTMLElement & { count?: number };
      const ionic = root.querySelector('ion-button') as HTMLElement & { disabled?: boolean };
      const lit = root.querySelector('alpha3-lit-counter') as HTMLElement & { label?: string };
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
        'alpha3-wc-fixture': {
          registered: !!customElements.get('alpha3-wc-fixture'),
          upgraded: root.host.constructor !== HTMLElement,
          shadowRoot: true,
          slotContent: null,
          attributeProperty: null,
          eventObserved: null,
          hydrationSafe: true,
        },
        'alpha3-lit-counter': probe('alpha3-lit-counter', {
          slot: 'Lit slot label',
          attributeProperty: lit.label === 'Lit counter',
          event: 'lit-count',
        }),
        'alpha3-lit-host': probe('alpha3-lit-host'),
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
          attributeProperty: mdField.value === 'alpha3',
        }),
        'md-switch': probe('md-switch', {
          attributeProperty: typeof mdSwitch.selected === 'boolean',
          event: 'md-switch',
        }),
        'alpha3-native-badge': probe('alpha3-native-badge', {
          slot: 'Native badge light child',
          event: 'native-badge',
        }),
        'alpha3-fast-counter': probe('alpha3-fast-counter', {
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
  // v0.44 SSR form: foreign tags serialize as empty static hosts carrying
  // their authored literal attributes (the compiler grammar v1 admits no host
  // children, so the slotted labels/text are stamped client-side by the
  // fixture island's activation seam; the legacy data-eid event-binding
  // marker is gone — the compiled claim attaches method handlers directly).
  for (
    const expected of [
      '<alpha3-wc-fixture',
      '<alpha3-lit-counter',
      '<sl-button',
      '<sl-switch',
      '<sl-dialog',
      '<md-filled-button',
      '<md-outlined-text-field',
      '<md-switch',
      '<alpha3-native-badge',
      '<alpha3-fast-counter',
      '<ion-button',
      'label="Lit counter"',
      'variant="primary"',
      'label="Shoelace Dialog"',
      'value="alpha3"',
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
 * Shared by the smoke (browser + SSR checks) and the SSR corpus script.
 */
export async function prepareFixtureApp(tmpRoot: string): Promise<string> {
  await run(
    ['run', '-A', join(repoRoot, 'packages', 'create', 'src', 'cli.ts'), PROJECT_NAME],
    tmpRoot,
  );
  const appDir = join(tmpRoot, PROJECT_NAME);
  await patchDenoJson(appDir);
  await patchViteConfig(appDir);

  const fixtureDir = join(dirname(fromFileUrl(import.meta.url)), 'third-party-wc-smoke');
  for (
    const src of [
      'app/routes/third-party-wc.tsx',
      'app/components/page-third-party-wc.tsx',
      'app/islands/alpha3-wc-fixture.tsx',
      'app/islands/alpha3-wc-styles.ts',
      'app/islands/alpha3-open-child.tsx',
      'app/client/alpha3-wc-client.ts',
    ]
  ) {
    Deno.mkdirSync(dirname(join(appDir, src)), { recursive: true });
    Deno.copyFileSync(join(fixtureDir, src), join(appDir, src));
  }

  await run(['task', 'build'], appDir);
  return appDir;
}

async function main(): Promise<void> {
  const tmpRoot = await Deno.makeTempDir({ prefix: 'openelement-third-party-wc-' });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE') === '1';
  try {
    const appDir = await prepareFixtureApp(tmpRoot);
    await verifySsrHtml(appDir);
    await verifyBrowser(join(appDir, 'dist'));
    console.log('third-party Web Components smoke passed');
  } finally {
    if (keep) {
      console.log(`Keeping third-party WC smoke project at ${tmpRoot}`);
    } else {
      await Deno.remove(tmpRoot, { recursive: true });
    }
  }
}

if (import.meta.main) {
  await main();
}
