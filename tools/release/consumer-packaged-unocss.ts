/**
 * Packed-artifact UnoCSS consumer walkthrough (alpha15 Stage 4).
 *
 * WHY THIS LEG EXISTS. The UnoCSS port's whole claim is that a PACKED consumer
 * — an application outside this repository, resolving the framework and the
 * engine from tarballs and the registry — gets a working style pipeline with no
 * framework-side utility grammar. Every probe for that lived in the workspace:
 * the router's dev-server fixture is a workspace member, and a workspace probe
 * resolves the peer through the repository's own node_modules. Neither can show
 * that the peer loads from the APPLICATION's resolution tree, which is the one
 * thing "thin adapter over a real engine" means at the install boundary.
 *
 * What it qualifies, from the tarballs the release toolchain produced:
 *
 *   install    the six pack:dry-run tarballs plus `unocss` and `open-props` in a
 *              scratch app OUTSIDE the repository, installed with pnpm
 *   typecheck  the application's own `typecheck` script (tsc) against the
 *              packed declarations — the same surface the starter template
 *              ships, including the `*.css` import type the element package
 *              publishes as `@openelement/element/css-modules`
 *   build      a real SSG build: the DOCUMENT sheet (token source + engine
 *              preflights) and the COMPONENT sheet (shadow-root utilities) are
 *              emitted as content-addressed assets, and the page carries the DSD
 *              link for the component sheet
 *   dev        real dev consumption through the packed router plugin: live SSR
 *              of the whole tree, the island upgrading in a browser, BOTH
 *              stylesheet channels observable over the wire (the head-linked
 *              versioned document sheet and the DSD-declared component sheet),
 *              a `uno.config.ts` edit moving the compiled rules without a
 *              restart, a broken configuration keeping the server alive and
 *              recovering on restore, and a broken source edit surfacing as a
 *              500 (never stale success) and recovering after the revert
 *   start      the packed `oe` bin serves the built output
 *   engines    chromium, firefox and webkit measure the COMPUTED values the
 *              emitted sheets must produce: a light-DOM utility, a shadow-root
 *              utility, a SHADOW LAYOUT whose light-root page lives inside an
 *              enclosing shadow tree (its unique utility must reach that tree),
 *              the declared token roles reaching both, and the absence
 *              of a document reset the application did not ask for
 *
 * The shadow layout is the scenario the two-sheet division exists for: a
 * `shadow-open` layout renders a `light`-root page INSIDE its shadow tree, and
 * a document-head stylesheet can never match an element there. The nested
 * page's utility (`p-9` → 36px) appears in no other app source — the probe's
 * token-uniqueness guard enforces that at staging time — so a green measurement
 * can only come from a rule delivered into the enclosing shadow, never from a
 * rule the parent happened to carry.
 *
 * The dark half is measured too: `--no-config` is not a flag the engine has, so
 * the leg's own app always declares `uno.config.ts`. What it does NOT declare is
 * a Tailwind configuration — the application selects UnoCSS and nothing else,
 * which is the "no framework grammar, one engine" claim in its installable form.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertPackedTarballsFresh, runProcess } from './consumer-packaged-shared.ts';
import { RETAINED_PACKAGE_NAMES } from '../repo/project-constants.ts';
import { consumerPnpmOverridesYaml } from './consumer-packaged-shared.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { readPackages } from '../lib/package-graph.ts';

const repoRoot = resolve(import.meta.dirname!, '../..');
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;
const BROWSER_TIMEOUT_MS = 3 * 60_000;
const DEV_BOOT_TIMEOUT_MS = 3 * 60_000;
const DEV_FEEDBACK_TIMEOUT_MS = 90_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<{ success: boolean; output: string }> {
  return runProcess(command, args, cwd, { timeoutMs });
}

function reservePort(): Promise<number> {
  return new Promise((resolveProbe, reject) => {
    const probe = createServer();
    probe.once('listening', () => {
      const address = probe.address() as { port: number };
      probe.close(() => resolveProbe(address.port));
    });
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1' });
  });
}

/** The application's `uno.config.ts`: ordinary UnoCSS configuration. */
const UNO_CONFIG = `import { defineConfig, presetWind4 } from 'unocss';

export default defineConfig({
  presets: [presetWind4()],
  theme: {
    colors: {
      ink: 'var(--probe-ink)',
      paper: 'var(--probe-paper)',
      brand: 'var(--probe-brand)',
    },
  },
  shortcuts: [['probe-card', 'rounded-lg p-3']],
});
`;

/**
 * The token source: plain CSS the adapter includes verbatim, plus one bare-import
 * composition, so the packed leg exercises the resolution step too.
 */
const TOKENS = `@import 'open-props/style';

:root {
  --probe-ink: var(--gray-12);
  --probe-paper: var(--gray-0);
  --probe-brand: var(--violet-7);
}
`;

const APP_CONFIG = `import { defineConfig } from '@openelement/router';

export default defineConfig({
  unocss: {
    theme: ['app/styles/tokens.css'],
  },
  // The packed UI package's islands are admitted the way any consumer admits
  // them; nothing here reaches into the package's source.
  packageIslands: ['@openelement/ui'],
  head: {
    title: 'Packed UnoCSS consumer',
    description: 'The out-of-repo UnoCSS qualification app.',
  },
});
`;

const VITE_CONFIG = `import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
  plugins: [openElement()],
});
`;

/**
 * The page: a light-DOM utility the engine must compile, a declared shortcut,
 * and a shadow-root component whose utilities belong to the COMPONENT sheet.
 */
const PAGE = `import { definePage } from '@openelement/router';
import Lab from '../components/lab.tsx';

export default definePage(Lab, { head: { title: 'Packed UnoCSS consumer' } });
`;

// One compiled element class per module (OEC9001), so the shadow component and
// the page component are two modules.
const CARD = `import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import cardStyles from './probe-card.css';

// An island, so the build emits the client chunk that defines it: a component
// the browser never upgrades can be styled and still unmeasurable.
export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('probe-card', { root: 'shadow-open' })
export default class ProbeCard extends OpenElement {
  // The current contract for a component's own sheet: bind the .css import and
  // array it (OEC9029 refuses the side-effect form).
  static override styles = [cardStyles];

  render() {
    return (
      <div class='probe-card gap-2'>
        <span class='probe-shadow-utility p-4'>shadow utilities</span>
      </div>
    );
  }
}
`;

const LAB = `import { element, OpenElement } from '@openelement/element';
// Same registration path: the shadow layout is an intrinsic JSX tag here.
import './probe-shadow-layout.tsx';

@element('packed-lab', { root: 'light' })
export default class PackedLab extends OpenElement {
  render() {
    return (
      <div class='packed-lab p-6 bg-paper text-ink'>
        <h1 class='text-2xl font-semibold'>Packed UnoCSS consumer</h1>
        <p class='probe-document-utility mt-3'>document utilities</p>
        <probe-card></probe-card>
        <probe-shadow-layout></probe-shadow-layout>
        <open-button variant='primary'>packed button</open-button>
      </div>
    );
  }
}
`;

/**
 * The shadow layout: a `shadow-open` component that renders a light-root page
 * INSIDE its own shadow tree (no slot — the child is part of this component's
 * template, so the child's DOM lands in the enclosing shadow). Its shell
 * utility (`p-5` → 20px) must reach this shadow tree, and its DSD template is
 * the delivery that carries the sheets the nested light page consumes.
 */
const SHADOW_LAYOUT = `import { element, OpenElement } from '@openelement/element';
// The nested page's module must load for its @element registration to exist
// (the JSX tag is intrinsic; the import is the registration path).
import './probe-nested-page.tsx';

@element('probe-shadow-layout', { root: 'shadow-open' })
export default class ProbeShadowLayout extends OpenElement {
  render() {
    return (
      <div class='probe-layout-shell p-5'>
        <probe-nested-page></probe-nested-page>
      </div>
    );
  }
}
`;

/**
 * The light-root page the shadow layout contains. Its utility (`p-9` → 36px)
 * and its probe class appear in NO other app source (enforced by
 * {@linkcode assertProbeTokenUniqueness}), so a computed 36px inside the
 * enclosing shadow can only come from a rule delivered there — never from a
 * rule the parent component happened to carry.
 */
const NESTED_PAGE = `import { element, OpenElement } from '@openelement/element';

@element('probe-nested-page', { root: 'light' })
export default class ProbeNestedPage extends OpenElement {
  render() {
    return (
      <div class='probe-nested-utility p-9 bg-paper'>nested light page</div>
    );
  }
}
`;

const CARD_CSS = `/* Authored CSS rides the app's own import path: this sheet is bound to
   probe-card's shadow root, so its rule reaches that tree and nothing else. */
.probe-card {
  outline: 1px solid transparent;
}
`;

/**
 * The engine probe: computed values, read in the engine's own three builds.
 * Every expectation is a value an emitted sheet MUST produce — a text assertion
 * would pass on a sheet that arrived unparsed.
 */
const PROBE = `import { chromium, firefox, webkit } from '@playwright/test';

const [baseUrl, browserName] = process.argv.slice(2);
const browserType = { chromium, firefox, webkit }[browserName];
if (!baseUrl || !browserType) throw new Error('usage: probe.mjs <baseUrl> <engine>');

const DEEP = \`(function () {
  const find = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      const found = find(element.shadowRoot, selector);
      if (found) return found;
    }
    return null;
  };
  globalThis.__deepFind = (selector) => find(document, selector);
})()\`;

const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push('page error: ' + error.message));
  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  await page.evaluate(DEEP);
  await page.waitForFunction(() => customElements.get('probe-card') !== undefined);

  const measured = await page.evaluate(() => {
    const lab = globalThis.__deepFind('packed-lab');
    const documentUtility = globalThis.__deepFind('.probe-document-utility');
    const card = globalThis.__deepFind('probe-card');
    const shadowUtility = card?.shadowRoot?.querySelector('.probe-shadow-utility') ?? null;
    const cardWrapper = card?.shadowRoot?.querySelector('.probe-card') ?? null;
    // The SHADOW LAYOUT: a light-root page whose host lives inside an
    // enclosing shadow tree. A document-head stylesheet can never match an
    // element there, so the nested page's unique utility is deliverable only
    // through the sheets the layout's own DSD declares.
    const layout = globalThis.__deepFind('probe-shadow-layout');
    const layoutRoot = layout?.shadowRoot ?? null;
    const nestedPage = layoutRoot?.querySelector('probe-nested-page') ?? null;
    const nestedUtility = nestedPage?.querySelector('.probe-nested-utility') ?? null;
    const layoutShell = layoutRoot?.querySelector('.probe-layout-shell') ?? null;
    const read = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        marginTop: style.marginTop,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        gap: style.gap,
        color: style.color,
        backgroundColor: style.backgroundColor,
        display: style.display,
      };
    };
    return {
      // The host element carries no utilities of its own: the compiled root is
      // the div it renders.
      labRoot: read(lab?.shadowRoot?.querySelector('div') ?? lab?.querySelector('div') ?? lab),
      documentUtility: read(documentUtility),
      shadowUtility: read(shadowUtility),
      cardWrapper: read(cardWrapper),
      layoutShell: read(layoutShell),
      nestedUtility: read(nestedUtility),
      // The theme source's role, computed where it is DECLARED (the document
      // root) and where it is CONSUMED inside the enclosing shadow (custom
      // properties inherit across the shadow boundary).
      documentToken: getComputedStyle(document.documentElement).getPropertyValue('--probe-paper').trim(),
      nestedToken: nestedUtility
        ? getComputedStyle(nestedUtility).getPropertyValue('--probe-paper').trim()
        : '',
      // The document reset the application never asked for must be absent: a
      // runtime-created heading outside every shadow tree keeps the UA's own
      // margins and sizes when no preflight reset is in force.
      resetProbe: (() => {
        const heading = document.createElement('h1');
        const list = document.createElement('ul');
        list.appendChild(document.createElement('li'));
        document.body.append(heading, list);
        return {
          h1MarginTop: getComputedStyle(heading).marginTop,
          listStyleType: getComputedStyle(list).listStyleType,
        };
      })(),
      // The token source reached the document: the role the utility names
      // resolves to a real colour rather than to nothing.
      brand: getComputedStyle(document.documentElement).getPropertyValue('--probe-brand').trim(),
      stylesheetHrefs: [...document.querySelectorAll('link[rel=stylesheet]')].map((link) => link.getAttribute('href')),
      cardSheetHref: card?.shadowRoot?.querySelector('link[data-oe-static-styles]')?.getAttribute('href') ?? null,
      // The probe-card's own authored sheet (bound through static styles) is a
      // separate delivery from the compiled component sheet.
      cardOwnSheet: card?.shadowRoot?.querySelectorAll('link[rel=stylesheet]').length ?? 0,
      cardSheetUrls: [...(card?.shadowRoot?.querySelectorAll('link[rel=stylesheet]') ?? [])].map(
        (link) => link.getAttribute('href'),
      ),
      // The sheets the SHADOW LAYOUT's DSD declares — the shadow delivery
      // channel its nested light page depends on.
      layoutSheetUrls: [...(layoutRoot?.querySelectorAll('link[rel=stylesheet]') ?? [])].map(
        (link) => link.getAttribute('href'),
      ),
      shadowUtilityCarriers: [],
      shadowUtilitySheet: null,
      nestedUtilityCarriers: [],
      nestedUtilitySheet: null,
      componentSheetCss: null,
    };
  });

  // The component sheet's own bytes, fetched from the URL the DSD declares.
  const componentCss = measured.cardSheetHref
    ? await fetch(baseUrl + measured.cardSheetHref).then((response) => response.text())
    : '';
  measured.componentSheetCssLength = componentCss.length;
  measured.componentSheetHasReset = /box-sizing:\\s*border-box/.test(componentCss);

  // Every sheet the page delivers, from BOTH channels: the document's own links
  // and every link each shadow root declares. Which compile carries the shadow
  // root's utility is the ENGINE's division to make (this adapter hands the
  // document compile the light candidates AND the tokens the engine's
  // extractors find in the walked module texts), so the row proves the utility
  // is DELIVERED — by whichever sheet carries its rule — rather than naming a
  // channel the engine is free to choose.
  const sheetUrls = [
    ...(measured.stylesheetHrefs ?? []),
    ...(measured.cardSheetUrls ?? []),
    ...(measured.layoutSheetUrls ?? []),
  ].filter((href, index, all) => typeof href === 'string' && all.indexOf(href) === index);
  const sheetBodies = new Map();
  for (const href of sheetUrls) {
    sheetBodies.set(href, await fetch(baseUrl + href).then((response) => response.text()));
  }
  // The utility the shadow span carries: the class p-4 compiles to the padding
  // shorthand the row below measures.
  const carriers = [...sheetBodies.entries()]
    .filter(([, css]) => /\.p-4\s*\{/.test(css))
    .map(([href]) => href);
  measured.shadowUtilityCarriers = carriers;
  measured.shadowUtilitySheet = carriers.length > 0 ? 'delivered' : 'absent';
  if (measured.shadowUtilitySheet === 'absent') {
    failures.push(
      'no delivered sheet carries the shadow utility rule (sheets: ' + sheetUrls.join(', ') + ')',
    );
  }
  // The NESTED light page's unique utility, as delivered INSIDE the enclosing
  // shadow: only sheets the layout's own DSD declares can style that tree — a
  // document-head sheet is unreachable from shadow DOM by definition.
  const nestedCarriers = (measured.layoutSheetUrls ?? []).filter((href) =>
    /\\.p-9\\s*\\{/.test(sheetBodies.get(href) ?? ''),
  );
  measured.nestedUtilityCarriers = nestedCarriers;
  measured.nestedUtilitySheet = nestedCarriers.length > 0 ? 'delivered' : 'absent';

  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      failures.push(label + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(wanted) + ')');
    }
  };

  // The light root's own utility: p-6 in a build whose default preset is
  // presetWind4.
  expect('light root p-6 padding', measured.labRoot?.paddingTop, '24px');
  // A utility on a plain child of that root.
  expect('document utility mt-3 margin', measured.documentUtility?.marginTop, '12px');
  // The SHADOW root's utility (the component channel's reason to exist).
  expect('shadow utility p-4 padding', measured.shadowUtility?.paddingTop, '16px');
  // The declared shortcut from uno.config.ts, compiled by the engine.
  expect('declared shortcut rounded-lg padding', measured.cardWrapper?.paddingTop, '12px');
  expect('declared shortcut gap', measured.cardWrapper?.gap, '8px');
  // The SHADOW LAYOUT: the shell's own utility inside its shadow, and the
  // nested light page's UNIQUE utility. The class p-9 compiles to 36px and
  // appears in no other app source (the staging-time uniqueness guard
  // enforces that), so no rule the parent carries can be mistaken for the
  // delivery.
  expect('shadow layout shell p-5 padding', measured.layoutShell?.paddingTop, '20px');
  expect(
    'nested light page p-9 padding inside the enclosing shadow',
    measured.nestedUtility?.paddingTop,
    '36px',
  );
  // The theme source resolves inside the enclosing shadow too: bg-paper rides
  // the token chain to the Open Props gray-0 value. The utility compiles to a
  // color-mix at 100% opacity, which every engine serializes as an opaque
  // sRGB colour — spelled rgb()/rgba() by older engines and color(srgb …) by
  // CSS Color 4 serializers; the comparison normalizes all three to the sRGB
  // triple and tolerates nothing else.
  const toSrgbTriple = (value) => {
    const raw = String(value ?? '').trim();
    let match = /^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)/.exec(raw);
    if (match) return match.slice(1, 4).map(Number).map(Math.round).join(',');
    match = /^color\\(srgb\\s+([\\d.e+-]+)\\s+([\\d.e+-]+)\\s+([\\d.e+-]+)/.exec(raw);
    if (match) return match.slice(1, 4).map(Number).map((c) => Math.round(c * 255)).join(',');
    return null;
  };
  const nestedPaper = toSrgbTriple(measured.nestedUtility?.backgroundColor);
  if (nestedPaper !== '248,249,250') {
    failures.push(
      'nested light page bg-paper = ' +
        JSON.stringify(measured.nestedUtility?.backgroundColor) +
        ' (expected the Open Props gray-0 colour through the inherited token chain)',
    );
  }
  // Tokens: the declared source resolves to the substituted value at the
  // document root, and the same computed value inherits across the shadow
  // boundary into the tree that consumes it.
  if (measured.documentToken !== '#f8f9fa') {
    failures.push(
      '--probe-paper at the document root = ' +
        JSON.stringify(measured.documentToken) +
        ' (expected the substituted Open Props gray-0 value)',
    );
  }
  if (measured.nestedToken === '') {
    failures.push('the token source did not reach the enclosing shadow');
  }
  if (measured.nestedToken !== measured.documentToken) {
    failures.push(
      'the token did not inherit into the enclosing shadow: ' +
        JSON.stringify(measured.nestedToken) +
        ' (document root: ' + JSON.stringify(measured.documentToken) + ')',
    );
  }
  // The shadow delivery channel, observed: the layout's DSD must declare the
  // sheets its tree consumes, and one of them must carry the nested utility.
  if (!Array.isArray(measured.layoutSheetUrls) || measured.layoutSheetUrls.length === 0) {
    failures.push('the shadow layout DSD declares no stylesheet link');
  }
  if (measured.nestedUtilitySheet === 'absent') {
    failures.push(
      'no sheet declared inside the enclosing shadow carries the nested light page utility ' +
        '(links: ' + (measured.layoutSheetUrls ?? []).join(', ') + ')',
    );
  }
  // The token source's role reaches the document: a bare-import composition
  // inlined and the role resolved to a real colour.
  if (measured.brand === '') failures.push('the declared token source did not reach the document');
  // The document sheet is the one the head links, and the component sheet is
  // the one the DSD declares: two deliveries, both present, both fetched.
  if (!Array.isArray(measured.stylesheetHrefs) || measured.stylesheetHrefs.length === 0) {
    failures.push('the built document links no stylesheet');
  }
  if (!measured.cardSheetHref) {
    failures.push('the DSD declared no component sheet link');
  }
  if (measured.componentSheetCssLength === 0) {
    failures.push('the DSD declared a component sheet URL that serves nothing');
  }
  // Which sheet carries the shadow utility is the ENGINE's division to make
  // (this adapter hands the document compile the admitted light candidates AND
  // the tokens the engine's extractors find in the walked module texts, so a
  // shadow utility can legitimately land there). What must hold is that it is
  // delivered and that the COMPONENT sheet carries no document reset.
  expect('component sheet carries no reset', measured.componentSheetHasReset, false);
  // This application DECLARES the engine, so it owns the document and the
  // reset is the application's to have (ADR-0167 §5): preflight rewrites the
  // runtime-created heading and list, which is the positive form of the same
  // probe the packaged UI appliance asserts in its reduced-entry form.
  expect('document reset present (h1 margin collapsed)', measured.resetProbe.h1MarginTop, '0px');
  expect('document reset present (list marker stripped)', measured.resetProbe.listStyleType, 'none');

  if (failures.length > 0) {
    throw new Error('[' + browserName + '] ' + failures.join(' | ') + ' :: ' + JSON.stringify(measured));
  }
  console.log('PASS packed UnoCSS consumer / ' + browserName);
} finally {
  await browser.close();
}
`;

/**
 * The DEV upgrade probe (chromium): the dev leg's browser half. Dev serving is
 * qualified over the wire for the whole matrix of facts; this probe adds the
 * one thing HTTP cannot see — the packed island actually UPGRADES on a dev
 * page — plus the same shadow-layout computation in a live dev tree. One
 * engine: the three-engine matrix is a property of the BUILT output and runs
 * against `oe start`; dev adds the upgrade fact, not a second matrix.
 */
const PW_DEV_PROBE = `import { chromium } from '@playwright/test';

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error('usage: pw-dev-probe.mjs <baseUrl>');

const DEEP = \`(function () {
  const find = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      const found = find(element.shadowRoot, selector);
      if (found) return found;
    }
    return null;
  };
  globalThis.__deepFind = (selector) => find(document, selector);
})()\`;

const browser = await chromium.launch({ headless: true });
try {
  // A cold dev server dep-optimizes the island graph on the first browser
  // visit and forces exactly one full reload; that one-time behavior must not
  // be attributed to the island lifecycle, so each attempt uses a FRESH page
  // (its own error channel, no cross-attempt accumulation) and the probe
  // retries across the reload. The failure list is re-seeded per attempt for
  // the same reason, but LIVES outside the loop: the post-loop assertions
  // push into it once a measurement survived.
  let measured = null;
  let failures = [];
  for (let attempt = 0; attempt < 3 && measured === null; attempt += 1) {
    const page = await browser.newPage();
    failures = [];
    page.on('pageerror', (error) => failures.push('page error: ' + error.message));
    try {
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.evaluate(DEEP);
      await page.waitForFunction(() => customElements.get('probe-card') !== undefined, undefined, { timeout: 60000 });
      measured = await page.evaluate(() => {
        const card = globalThis.__deepFind('probe-card');
        const shadowUtility = card?.shadowRoot?.querySelector('.probe-shadow-utility') ?? null;
        const layout = globalThis.__deepFind('probe-shadow-layout');
        const nestedUtility = layout?.shadowRoot?.querySelector('.probe-nested-utility') ?? null;
        return {
          // The island UPGRADED: the SSR DSD was claimed by the packed runtime.
          upgraded: card !== null && card.shadowRoot !== null,
          shadowPadding: shadowUtility ? getComputedStyle(shadowUtility).paddingTop : null,
          nestedPadding: nestedUtility ? getComputedStyle(nestedUtility).paddingTop : null,
          nestedToken: nestedUtility
            ? getComputedStyle(nestedUtility).getPropertyValue('--probe-paper').trim()
            : '',
          documentSheetLinked: [...document.querySelectorAll('link[rel=stylesheet]')].some((link) =>
            (link.getAttribute('href') ?? '').includes('unocss-document'),
          ),
          layoutSheetLinks: layout?.shadowRoot
            ? [...layout.shadowRoot.querySelectorAll('link[rel=stylesheet]')].length
            : 0,
        };
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
    }
  }
  if (measured.upgraded !== true) failures.push('the probe-card island never upgraded in dev');
  if (measured.shadowPadding !== '16px') {
    failures.push('dev shadow utility p-4 = ' + JSON.stringify(measured.shadowPadding) + ' (expected 16px)');
  }
  if (measured.nestedPadding !== '36px') {
    failures.push('dev nested light page p-9 = ' + JSON.stringify(measured.nestedPadding) + ' (expected 36px)');
  }
  if (measured.nestedToken !== '#f8f9fa') {
    failures.push('dev nested token --probe-paper = ' + JSON.stringify(measured.nestedToken) + ' (expected the substituted Open Props value)');
  }
  if (measured.documentSheetLinked !== true) failures.push('the dev head links no document sheet');
  if (measured.layoutSheetLinks === 0) failures.push('the dev shadow layout DSD declares no stylesheet link');
  if (failures.length > 0) throw new Error(failures.join(' | ') + ' :: ' + JSON.stringify(measured));
  console.log('DEV-UPGRADE-OK chromium');
} finally {
  await browser.close();
}
`;

async function assertNoRepositoryResolution(nodeModules: string): Promise<void> {
  const candidates: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const nested of readdirSync(path, { withFileTypes: true })) {
        candidates.push(join(path, nested.name));
      }
    } else {
      candidates.push(path);
    }
  }
  for (const path of candidates) {
    const resolved = await realpath(path).catch(() => path);
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
      throw new Error(`The packed consumer resolved a dependency into the repository: ${path}`);
    }
  }
}

/**
 * The probe tokens whose EXCLUSIVITY the shadow-layout assertions rely on:
 * each must appear in exactly one staged app source, or a rule carried by the
 * enclosing layout could satisfy the nested-page measurement without any
 * shadow delivery (the false pass the leg exists to rule out).
 */
function assertProbeTokenUniqueness(files: Record<string, string>): void {
  const exclusives: ReadonlyArray<readonly [token: string, owner: string]> = [
    ['p-9', 'app/components/probe-nested-page.tsx'],
    ['probe-nested-utility', 'app/components/probe-nested-page.tsx'],
    ['p-5', 'app/components/probe-shadow-layout.tsx'],
    ['probe-layout-shell', 'app/components/probe-shadow-layout.tsx'],
  ];
  for (const [token, owner] of exclusives) {
    for (const [path, text] of Object.entries(files)) {
      if (path === owner) continue;
      if (text.includes(token)) {
        throw new Error(
          `probe token "${token}" must be unique to ${owner}, but ${path} also carries it — ` +
            'a shared rule could satisfy the shadow-layout probe without a shadow delivery',
        );
      }
    }
  }
}

/** One fetched page: status plus body text. */
interface FetchedPage {
  readonly status: number;
  readonly text: string;
}

async function fetchPage(baseUrl: string, path: string): Promise<FetchedPage> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, text: await response.text() };
}

/**
 * Poll one URL until `accept` holds. A timed-out poll throws — an edit that
 * never reaches the served output is a FAIL, never a silent PASS.
 */
async function pollPage(
  baseUrl: string,
  path: string,
  label: string,
  accept: (page: FetchedPage) => boolean,
  describe: (page: FetchedPage) => string,
  timeoutMs = DEV_FEEDBACK_TIMEOUT_MS,
): Promise<FetchedPage> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const page = await fetchPage(baseUrl, path);
      if (accept(page)) return page;
      last = describe(page);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`${label}: state not reached within ${timeoutMs}ms (last: ${last})`);
}

/** The document sheet URL the dev head links (`…unocss-document.<version>.css`). */
function documentSheetUrl(html: string): string | undefined {
  return /<link rel="stylesheet" href="([^"]*unocss-document\.[^"]+\.css)"/.exec(html)?.[1];
}

/** The component sheet URL a dev DSD declares (`…unocss-components.current.css`). */
function componentSheetUrl(html: string): string | undefined {
  return /href="([^"]*unocss-components\.[^"]+\.css)"/.exec(html)?.[1];
}

/**
 * The real dev consumption leg: the packed router plugin under `vite` — the
 * same dev face the starter template ships — qualified over the wire and in
 * one browser:
 *
 *   1. live SSR of the whole tree (shadow layout and its nested light page
 *      included) with the DSD templates rendered;
 *   2. BOTH stylesheet channels observable: the head-linked versioned document
 *      sheet (tokens + light utilities + the application's reset) and the
 *      DSD-declared component sheet (shadow utilities, no reset);
 *   3. a `uno.config.ts` edit moves the compiled rules without a restart (the
 *      document sheet re-points at a new versioned URL, the component sheet
 *      recompiles at its stable dev URL);
 *   4. a BROKEN configuration must not take the server down (the served sheets
 *      keep the previously loaded configuration — the engine's documented
 *      behavior), and restoring the configuration recovers without a restart;
 *   5. a broken source edit surfaces as a 500 — never stale success — and the
 *      server recovers after the revert;
 *   6. the packed island UPGRADES on the dev page (chromium — the upgrade fact
 *      HTTP cannot see; the three-engine matrix stays a property of the built
 *      output and runs against `oe start`).
 *
 * Every mutated file is restored byte-identically in the `finally`, before any
 * build-derived cell could read the tree.
 */
async function devConsumptionSession(app: string): Promise<string> {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dev = spawn(
    'pnpm',
    ['run', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: app,
      env: { ...process.env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: the stop below must reach pnpm's node/sh
      // grandchildren (the vite server) too, or they keep the stdio pipes open
      // and this process never exits (same teardown contract as `oe start`).
      detached: true,
    },
  );
  let exited = false;
  dev.addListener('exit', () => {
    exited = true;
  });
  const chunks: Uint8Array[] = [];
  void (async () => {
    for await (const chunk of dev.stdout!) chunks.push(chunk as Uint8Array);
  })();
  void (async () => {
    for await (const chunk of dev.stderr!) chunks.push(chunk as Uint8Array);
  })();
  const devOutput = () =>
    new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));

  const configPath = join(app, 'uno.config.ts');
  const labPath = join(app, 'app', 'components', 'lab.tsx');
  const configOriginal = await readFile(configPath, 'utf8');
  const labOriginal = await readFile(labPath, 'utf8');
  try {
    // 1. Live SSR: the whole tree renders, DSD templates included.
    const ssrMarkers = ['packed-lab', 'probe-card', 'probe-shadow-layout', 'probe-nested-page'];
    const ssr = await pollPage(
      baseUrl,
      '/',
      'dev SSR',
      (page) =>
        page.status === 200 &&
        page.text.includes('<template shadowrootmode="open"') &&
        ssrMarkers.every((marker) => page.text.includes(marker)),
      (page) =>
        `status=${page.status}, missing=[${ssrMarkers
          .filter((marker) => !page.text.includes(marker))
          .join(', ')}], dsd=${page.text.includes('<template shadowrootmode="open"')}`,
      DEV_BOOT_TIMEOUT_MS,
    );

    // 2. Both stylesheet channels, observable over the wire.
    const docHref = documentSheetUrl(ssr.text);
    if (docHref === undefined) {
      throw new Error(`the dev head links no document sheet:\n${ssr.text.slice(0, 1200)}`);
    }
    const docCss = await fetchPage(baseUrl, docHref);
    if (docCss.status !== 200) {
      throw new Error(`the dev document sheet answered ${docCss.status}`);
    }
    if (!docCss.text.includes('--probe-paper')) {
      throw new Error(
        'the dev document sheet carries no token source (the declared theme did not compile)',
      );
    }
    if (!/\.p-6\s*\{/.test(docCss.text)) {
      throw new Error('the dev document sheet carries no compiled light utility');
    }
    // The application DECLARES the engine, so the dev document owns the reset.
    if (!docCss.text.includes('box-sizing: border-box')) {
      throw new Error(
        'the dev document sheet carries no reset (the application declared the entry)',
      );
    }
    const cardDsdStart = ssr.text.indexOf('<probe-card');
    const cardDsdEnd = ssr.text.indexOf('</probe-card>');
    if (cardDsdStart === -1 || cardDsdEnd === -1) {
      throw new Error('the dev SSR rendered no probe-card DSD');
    }
    const compHref = componentSheetUrl(ssr.text.slice(cardDsdStart, cardDsdEnd));
    if (compHref === undefined) {
      throw new Error('the dev DSD declares no component sheet link');
    }
    const compBefore = await fetchPage(baseUrl, compHref);
    if (compBefore.status !== 200) {
      throw new Error(`the dev component sheet answered ${compBefore.status}`);
    }
    if (!/\.p-4\s*\{/.test(compBefore.text)) {
      throw new Error('the dev component sheet carries no compiled shadow utility');
    }
    if (compBefore.text.includes('box-sizing: border-box')) {
      throw new Error('the dev component sheet carries a reset (it must not)');
    }

    // 3. An uno.config.ts edit must move the compiled rules without a restart.
    const versionBefore = documentSheetUrl((await fetchPage(baseUrl, '/')).text);
    if (versionBefore === undefined) throw new Error('the dev head lost its document sheet link');
    if (!/\.probe-card\s*\{[^}]*var\(--spacing\)\s*\*\s*3/.test(compBefore.text)) {
      throw new Error('the component sheet did not carry the pre-edit shortcut rule (p-3)');
    }
    const configEdited = configOriginal.replace("'rounded-lg p-3'", "'rounded-lg p-6'");
    if (configEdited === configOriginal) {
      throw new Error('dev feedback edit: uno.config.ts does not contain the expected shortcut');
    }
    await writeFile(configPath, configEdited, 'utf8');
    // The generated path's documented dev contract: the rebuilt generator
    // re-points the head link at a NEW versioned URL, and the component sheet
    // recompiles per request at its stable dev URL.
    await pollPage(
      baseUrl,
      '/',
      'dev feedback: the uno.config.ts edit re-points the document sheet',
      (page) => {
        const href = documentSheetUrl(page.text);
        return page.status === 200 && href !== undefined && href !== versionBefore;
      },
      (page) => `status=${page.status}, document sheet=${documentSheetUrl(page.text) ?? 'none'}`,
    );
    const compEdited = await fetchPage(baseUrl, compHref);
    if (compEdited.status !== 200) {
      throw new Error(`the edited component sheet answered ${compEdited.status}`);
    }
    if (!/\.probe-card\s*\{[^}]*var\(--spacing\)\s*\*\s*6/.test(compEdited.text)) {
      throw new Error('the edited shortcut (p-6) never reached the served component sheet');
    }
    if (/\.probe-card\s*\{[^}]*var\(--spacing\)\s*\*\s*3/.test(compEdited.text)) {
      throw new Error('the served component sheet still carries the pre-edit shortcut rule (p-3)');
    }

    // 5. A broken configuration must not take the dev server down, and the fix
    //    must recover without a restart.
    const versionEdited = documentSheetUrl((await fetchPage(baseUrl, '/')).text);
    if (versionEdited === undefined) throw new Error('the dev head lost its document sheet link');
    await writeFile(configPath, 'export default { presets: [presetWind4(] });\n', 'utf8');
    for (let tick = 0; tick < 8; tick += 1) {
      const page = await fetchPage(baseUrl, '/');
      if (page.status !== 200) {
        throw new Error(
          `the dev server answered ${page.status} while the configuration was broken — ` +
            'it must keep serving (the engine keeps the previously loaded configuration), never die',
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    await writeFile(configPath, configOriginal, 'utf8');
    await pollPage(
      baseUrl,
      '/',
      'dev recovery: the restored uno.config.ts re-points the document sheet',
      (page) => {
        const href = documentSheetUrl(page.text);
        return page.status === 200 && href !== undefined && href !== versionEdited;
      },
      (page) => `status=${page.status}, document sheet=${documentSheetUrl(page.text) ?? 'none'}`,
    );
    const compRecovered = await fetchPage(baseUrl, compHref);
    if (!/\.probe-card\s*\{[^}]*var\(--spacing\)\s*\*\s*3/.test(compRecovered.text)) {
      throw new Error(
        'the restored configuration did not recover the original shortcut rule (p-3)',
      );
    }

    // 6. A broken source edit surfaces as a 500 — never stale success — and
    //    the server recovers after the revert.
    await writeFile(labPath, `${labOriginal}\nexport const __devBroken = ;\n`, 'utf8');
    await pollPage(
      baseUrl,
      '/',
      'dev error visibility: the broken component edit',
      (page) => page.status === 500,
      (page) => `status=${page.status} (a stale 200 would hide the break)`,
    );
    await writeFile(labPath, labOriginal, 'utf8');
    await pollPage(
      baseUrl,
      '/',
      'dev recovery after the source revert',
      (page) => page.status === 200 && page.text.includes('packed-lab'),
      (page) => `status=${page.status}`,
    );

    // 6. The packed island UPGRADES on the dev page — the one dev fact HTTP
    //     cannot see, so it runs last, after every wire-level fact above.
    const upgrade = await run('node', ['pw-dev-probe.mjs', baseUrl], app, BROWSER_TIMEOUT_MS);
    if (!upgrade.success || !upgrade.output.includes('DEV-UPGRADE-OK chromium')) {
      throw new Error(`the dev upgrade probe failed:\n${upgrade.output.slice(0, 4000)}`);
    }

    return (
      'dev: SSR + island upgrade green, both sheet channels observable, the uno.config edit ' +
      'moved the rules, a broken configuration kept serving and recovered, a broken source edit ' +
      'answered 500 and recovered after the revert'
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`the dev consumption session failed: ${detail}\n${devOutput().slice(-4000)}`, {
      cause: error,
    });
  } finally {
    await writeFile(configPath, configOriginal, 'utf8');
    await writeFile(labPath, labOriginal, 'utf8');
    if (!exited) {
      try {
        process.kill(-dev.pid!, 'SIGTERM');
      } catch {
        dev.kill('SIGTERM');
      }
    }
    await new Promise((resolveStop) => setTimeout(resolveStop, 500));
  }
}

async function main(): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'openelement-packed-unocss-'));
  try {
    const workspacePackages = await readPackages();
    const tarballFor = (name: string): string => {
      const pkg = workspacePackages.find((candidate) => candidate.name === name);
      if (!pkg) throw new Error(`Retained package missing from workspace graph: ${name}`);
      return join(repoRoot, tarballPath(pkg));
    };
    const tarballs = RETAINED_PACKAGE_NAMES.map(tarballFor);
    for (const tarball of tarballs) {
      if (!existsSync(tarball)) {
        throw new Error(
          `Missing packed release artifact: ${tarball} (run \`pnpm --dir tools/release run pack:dry-run\` first)`,
        );
      }
    }
    await assertPackedTarballsFresh(tarballs);

    const app = join(scratch, 'app');
    await mkdir(join(app, 'app', 'components'), { recursive: true });
    await mkdir(join(app, 'app', 'routes'), { recursive: true });
    await mkdir(join(app, 'app', 'styles'), { recursive: true });

    const tarballOf = new Map(
      RETAINED_PACKAGE_NAMES.map((name, index) => [name, tarballs[index]!] as const),
    );
    const fileRef = (name: string): string => `file:${tarballOf.get(name)!}`;

    await writeFile(
      join(app, 'package.json'),
      `${JSON.stringify(
        {
          name: 'packed-unocss-consumer',
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'oe build',
            start: 'oe start',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {
            '@openelement/element': fileRef('@openelement/element'),
            '@openelement/router': fileRef('@openelement/router'),
            '@openelement/ui': fileRef('@openelement/ui'),
            '@openelement/protocol': fileRef('@openelement/protocol'),
            // The engine resolves from THIS application's tree — the claim the
            // leg exists to test.
            unocss: '66.10.0',
            'open-props': '1.7.23',
            vite: '8.0.16',
            typescript: '6.0.3',
          },
          devDependencies: {
            '@playwright/test': '1.59.1',
            // The dev leg's peer: @hono/vite-dev-server is an OPTIONAL peer of
            // the packed router that only `vite dev` loads (build and start
            // never touch it), so the dev-exercising consumer pins it
            // explicitly — the same contract the app harnesses and the create
            // starter declare.
            '@hono/vite-dev-server': '^0.25.3',
            hono: '4.12.0',
          },
          engines: { node: '>=24.2' },
          packageManager: 'pnpm@12.8.1',
          pnpm: {
            overrides: Object.fromEntries(
              RETAINED_PACKAGE_NAMES.map((name) => [name, fileRef(name)]),
            ),
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await writeFile(
      join(app, 'pnpm-workspace.yaml'),
      consumerPnpmOverridesYaml(
        RETAINED_PACKAGE_NAMES.map((name) => ({ name, path: tarballOf.get(name)! })),
      ),
      'utf8',
    );
    await writeFile(join(app, 'uno.config.ts'), UNO_CONFIG, 'utf8');
    await writeFile(join(app, 'openelement.config.ts'), APP_CONFIG, 'utf8');
    await writeFile(join(app, 'vite.config.ts'), VITE_CONFIG, 'utf8');
    await writeFile(
      join(app, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            // The starter template's documented typecheck surface
            // (packages/create/templates/tsconfig.json.tmpl): `*.css` imports
            // type through the element package's published
            // `@openelement/element/css-modules` declaration, and JSX
            // type-checks against the packed element types.
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            jsx: 'react-jsx',
            jsxImportSource: '@openelement/element',
            types: ['@openelement/element/css-modules'],
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            allowImportingTsExtensions: true,
          },
          include: ['app', 'vite.config.ts', 'openelement.config.ts', 'uno.config.ts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(join(app, 'app', 'styles', 'tokens.css'), TOKENS, 'utf8');
    await writeFile(join(app, 'app', 'routes', 'index.tsx'), PAGE, 'utf8');
    await mkdir(join(app, 'app', 'islands'), { recursive: true });
    await writeFile(join(app, 'app', 'components', 'lab.tsx'), LAB, 'utf8');
    await writeFile(
      join(app, 'app', 'components', 'probe-shadow-layout.tsx'),
      SHADOW_LAYOUT,
      'utf8',
    );
    await writeFile(join(app, 'app', 'components', 'probe-nested-page.tsx'), NESTED_PAGE, 'utf8');
    await writeFile(join(app, 'app', 'islands', 'probe-card.tsx'), CARD, 'utf8');
    await writeFile(join(app, 'app', 'islands', 'probe-card.css'), CARD_CSS, 'utf8');
    await writeFile(join(app, 'pw-probe.mjs'), PROBE, 'utf8');
    await writeFile(join(app, 'pw-dev-probe.mjs'), PW_DEV_PROBE, 'utf8');

    // The shadow-layout probes are only honest when the probe tokens are
    // unique: a utility or probe class the layout shares with the nested page
    // could be satisfied by a rule the PARENT delivered, and the measurement
    // would pass without any shadow delivery. Enforce the exclusivity the
    // assertions rely on, at staging time.
    assertProbeTokenUniqueness({
      'app/uno.config.ts': UNO_CONFIG,
      'app/openelement.config.ts': APP_CONFIG,
      'app/vite.config.ts': VITE_CONFIG,
      'app/styles/tokens.css': TOKENS,
      'app/routes/index.tsx': PAGE,
      'app/components/lab.tsx': LAB,
      'app/components/probe-shadow-layout.tsx': SHADOW_LAYOUT,
      'app/components/probe-nested-page.tsx': NESTED_PAGE,
      'app/islands/probe-card.tsx': CARD,
      'app/islands/probe-card.css': CARD_CSS,
    });

    const install = await run('pnpm', ['install', '--no-frozen-lockfile'], app, INSTALL_TIMEOUT_MS);
    if (!install.success) throw new Error(`pnpm install failed:\n${install.output}`);
    await assertNoRepositoryResolution(join(app, 'node_modules'));

    // ── Phase A: the first-party UI package under UnoCSS ────────────────────
    // `@openelement/ui` declares its role table as a Tailwind `@theme` source
    // (generated-manifest.json -> ./src/theme.css). An application that selects
    // UnoCSS and admits that package reaches the adapter's refusal, and the
    // refusal must be a CODE rather than a half-styled build — the claim the
    // repository's own fixture asserts in-process, here on a packed install.
    const refused = await run('pnpm', ['exec', 'oe', 'build'], app, BUILD_TIMEOUT_MS);
    if (refused.success) {
      throw new Error(
        'the packed build admitted @openelement/ui under UnoCSS: its Tailwind `@theme` ' +
          'source must be refused by code, never shipped half-styled',
      );
    }
    // The CLI prints the coded diagnostic's message; the code itself is on the
    // error object. Assert the message the code owns (its identity) rather than
    // a stack trace.
    const refusal = "carries Tailwind's";
    if (!refused.output.includes(refusal) || !refused.output.includes('silently absent')) {
      throw new Error(
        `the packed build failed for the wrong reason:\n${refused.output.slice(0, 3000)}`,
      );
    }
    console.log(
      'Phase A: @openelement/ui under UnoCSS is refused by the theme-source diagnostic ' +
        '(OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE), never shipped half-styled.',
    );

    // ── Phase B: the port itself ────────────────────────────────────────────
    // Same application, one edit: the incompatible package leaves the island
    // set. The port proof is the app's OWN light-root page and shadow-root
    // island, its own `uno.config.ts`, and its own plain-CSS token source.
    await writeFile(
      join(app, 'openelement.config.ts'),
      APP_CONFIG.replace("  packageIslands: ['@openelement/ui'],\n", ''),
      'utf8',
    );
    // The page rendered the package component by tag; with the package gone the
    // tag would be an unknown element, so the page drops it too.
    await writeFile(
      join(app, 'app', 'components', 'lab.tsx'),
      LAB.replace("        <open-button variant='primary'>packed button</open-button>\n", ''),
      'utf8',
    );

    // ── Phase T: the typecheck the manifest declares ─────────────────────────
    // The app defines `typecheck: tsc --noEmit` — the starter template's
    // documented surface — and a packed consumer that cannot typecheck its own
    // app against the packed declarations is broken however well it builds.
    const typecheck = await run('pnpm', ['run', 'typecheck'], app, INSTALL_TIMEOUT_MS);
    if (!typecheck.success) {
      throw new Error(`the packed consumer's typecheck failed:\n${typecheck.output}`);
    }
    console.log(
      'Phase T: the packed consumer typechecks (pnpm run typecheck) against the packed declarations.',
    );

    const build = await run('pnpm', ['exec', 'oe', 'build'], app, BUILD_TIMEOUT_MS);
    if (!build.success) throw new Error(`packed build failed:\n${build.output}`);

    const html = await readFile(join(app, 'dist', 'index.html'), 'utf8');
    if (!html.includes('probe-card')) throw new Error('the built page carries no probe-card');
    if (!html.includes('data-oe-static-styles')) {
      throw new Error('the built DSD declares no component sheet link');
    }
    // The shadow layout, statically: the light-root page's markup must sit
    // INSIDE the layout's DSD template — the enclosing-shadow fact the engine
    // probe measures. A page rendered as a light child of the document would
    // make every shadow-layout assertion below vacuous.
    const layoutStart = html.indexOf('<probe-shadow-layout');
    if (layoutStart === -1) throw new Error('the built page carries no probe-shadow-layout');
    const layoutEnd = html.indexOf('</probe-shadow-layout>', layoutStart);
    const layoutHtml =
      layoutEnd === -1
        ? html.slice(layoutStart, layoutStart + 8000)
        : html.slice(layoutStart, layoutEnd);
    if (!layoutHtml.includes('<template shadowrootmode="open"')) {
      throw new Error('the shadow layout rendered no DSD template');
    }
    if (!layoutHtml.includes('probe-nested-page') || !layoutHtml.includes('probe-nested-utility')) {
      throw new Error('the light-root page did not render inside the enclosing shadow template');
    }

    // The engine probes run against the packed `oe start`, on every engine.
    const installBrowsers = await run(
      'pnpm',
      ['exec', 'playwright', 'install', '--with-deps', 'chromium', 'firefox', 'webkit'],
      app,
      INSTALL_TIMEOUT_MS,
    );
    if (!installBrowsers.success) {
      // A machine that already carries the engines needs no download; only a
      // real absence is a blocker.
      const list = await run('pnpm', ['exec', 'playwright', '--version'], app, 60_000);
      if (!list.success) throw new Error(`playwright unavailable in the consumer:\n${list.output}`);
    }

    // ── Phase D: real dev consumption ────────────────────────────────────────
    // The dev server over the packed router plugin, before `oe start`: the
    // mutative leg runs on the same tree the build read, and restores every
    // file it touches byte-identically (enforced by construction — the
    // originals are written back from memory).
    const devDetail = await devConsumptionSession(app);
    console.log(`Phase D: ${devDetail}.`);

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = spawn('pnpm', ['start'], {
      cwd: app,
      env: { ...process.env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: the stop below must reach pnpm's node/sh
      // grandchildren too, or they keep the stdio pipes open and this process
      // never exits.
      detached: true,
    });
    let exited = false;
    server.addListener('exit', () => {
      exited = true;
    });
    const chunks: Uint8Array[] = [];
    void (async () => {
      for await (const chunk of server.stdout!) chunks.push(chunk as Uint8Array);
    })();
    void (async () => {
      for await (const chunk of server.stderr!) chunks.push(chunk as Uint8Array);
    })();
    const serverOutput = () =>
      new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    try {
      let ready = false;
      const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
      while (Date.now() < deadline && !exited) {
        try {
          const response = await fetch(`${baseUrl}/`);
          await response.text();
          ready = true;
          break;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 150));
        }
      }
      if (!ready) {
        throw new Error(`the packed start server never answered:\n${serverOutput()}`);
      }

      const engineFailures: string[] = [];
      for (const engine of ['chromium', 'firefox', 'webkit']) {
        const probe = await run('node', ['pw-probe.mjs', baseUrl, engine], app, BROWSER_TIMEOUT_MS);
        if (!probe.success) {
          engineFailures.push(`${engine}:\n${probe.output.slice(0, 4000)}`);
        } else {
          for (const line of probe.output.split('\n')) {
            if (line.includes('PASS packed UnoCSS consumer')) console.log(line.trim());
          }
        }
      }
      if (engineFailures.length > 0) {
        throw new Error(
          `the packed UnoCSS engine matrix failed on ${engineFailures.length}/3 engines:\n` +
            engineFailures.join('\n'),
        );
      }
    } finally {
      if (!exited) {
        try {
          process.kill(-server.pid!, 'SIGTERM');
        } catch {
          server.kill('SIGTERM');
        }
      }
      await new Promise((resolveStop) => setTimeout(resolveStop, 500));
    }
    console.log(
      'Packed UnoCSS consumer: install, typecheck, build, dev consumption, start and the ' +
        'three-engine matrix (with the shadow layout) passed.',
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
