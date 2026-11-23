/**
 * KR-2 stage isolation and resume contracts for the GENERATED (F16) lane.
 *
 * Procedure: the same navigation the failing spec performs, repeated — each
 * attempt is one `goto` followed by a bounded gate requiring every
 * load-strategy island tag to define, with no retry inside an attempt. The
 * race needs a warm worker: 25 single-navigation runs in fresh browsers were
 * green, while the spec's own nine-navigation sequence fails one to three
 * tests per run.
 *
 * Observation is passive. `customElements.define`, `fetch` and the two failure
 * channels are recorded from an init script; nothing sleeps, nothing is
 * retried, and the loader's read path is untouched, so the race keeps its own
 * scheduling. A failed attempt reports which stage it reached:
 *
 *   module request/loading      a resource entry is missing or its response
 *                               never completed
 *   style asset top-level await  the style asset's response lands after the
 *                               loader's read — the export binds behind it
 *   export lookup               the loader's own rejection names the tag and
 *                               its check (`typeof n != 'function'`)
 *   custom element registration `customElements.get(tag)` after the gate
 *
 * The static half asserts the loader's post-fix shape: no island entry chunk
 * awaits its style asset at module scope.
 *
 * DELIVERY MODEL (re-authored for the generated lane, 2026-11-23): the class
 * lane's style ADAPTER is retired. No island fetches its stylesheet: every
 * sheet is a parser-declared `<link rel="stylesheet" data-oe-static-styles>` —
 * a shadow host's DSD template declares its OWN island plan's link(s) and
 * nothing else (F16; the retired union declared the app-wide set), while a
 * light root's document resource is declared once in the document head by the
 * route's build-time document-style fact. Measured on /combobox with the
 * generated build: zero fetch-type `.css` requests, every `.css` request has
 * resourceType "stylesheet", zero `style[data-open-element-compiled-style]`
 * nodes at any point, zero adopted sheets. The old held-adapter rows therefore
 * assert the replacement property — the link delivery itself (one resource per
 * owning tree, markup never rewritten, no readiness consumer to fool) — and
 * the lifecycle rows assert resume behaviour around that delivery.
 *
 * Two rows stay RED on the generated lane because of pre-existing packages/
 * claim defects, and are kept honest rather than weakened into vacuity (owner
 * decision, F16 closeout):
 *   - Q1-D: the /decoupled resume text and delivery facts hold, but the nested
 *     host carrying a dynamic attribute fails its claim with
 *     `OEIR_LEAF_CLAIM_MISMATCH: static attribute seed count is 1, declared 0
 *     at /0/0`, so the row's no-error contract cannot pass;
 *   - Q1-B/B1: the cleared-root reconnect fails CLOSED with the generated
 *     identity `OEIR_LEAF_CLAIM_MISMATCH: missing node at /0` and the root is
 *     not rebuilt, but every /combobox load also raises GAP-2's page-level
 *     `OE_RUNTIME_STATIC_RANGE_MISMATCH` (a generated page root cannot claim a
 *     nested hydrated LIGHT generated island), so its clean-surface assertion
 *     cannot pass.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every island the /combobox page HOSTS and therefore activates on load —
 * that page's own set (app/components/page-combobox.tsx: two DSD
 * `zag-combobox` hosts plus one light `zag-combobox-light`), not the app's.
 * The gate below is page-scope (#1544/B2): a tag this page carries no host for
 * is never fetched, so an app-wide list would wait forever on the two islands
 * that belong to other routes. Cross-page coverage is not lost, it lives with
 * the pages that own those hosts — `decoupled-view` in this file's
 * /decoupled case, `live-counter` in live.spec.ts (/form, /live, ...).
 */
const ISLAND_TAGS = ['zag-combobox-light', 'zag-combobox'];

/**
 * Bounded gate. The healthy define latency on this fixture is tens of
 * milliseconds; five seconds is two orders of magnitude above it, so a tag that
 * misses the gate never defined on this page.
 */
const GATE_TIMEOUT_MS = 5_000;

/** Navigations per run; the failing spec's own suite performs nine. */
const ATTEMPTS = Number(process.env.KR2_ATTEMPTS ?? 10);

interface Kr2Record {
  defines: Array<{ tag: string; at: number }>;
  rejects: Array<{ message: string; at: number }>;
  errors: Array<{ message: string; at: number }>;
  cssFetches: Array<{ url: string; at: number }>;
}

/**
 * The entry chunks' post-fix static shape: registration is decoupled from the
 * style asset. The generated lane delivers every sheet as a parser-declared
 * `<link>` (no island-side adapter fetch exists at all), so nothing at module
 * scope may `await fetch(...)` a style asset — such a chunk would make the
 * island's definition wait on the network again, exactly the KR-2 failure mode
 * the alpha15 S lane removed and the generated lane keeps out.
 */
function chunkOrderingEvidence(): string[] {
  const dir = join(import.meta.dirname!, '..', 'dist', 'client', 'islands');
  const lines: string[] = [];
  for (const name of readdirSync(dir)
    .filter((entry) => entry.startsWith('island-'))
    .sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    const awaited = text.indexOf('await fetch(');
    const exported = text.indexOf('export{');
    lines.push(
      `${name}: module-scope style fetch await ${
        awaited === -1 ? 'absent' : `at ${awaited}`
      }, export{ at ${exported} — ` +
        (awaited === -1
          ? 'registration is decoupled from style readiness'
          : 'module evaluation still waits for a style fetch'),
    );
  }
  return lines;
}

/** One marked stylesheet delivery link, read from the tree that declares it. */
interface MarkedLinkState {
  href: string | null;
  /** True when the browser applied a stylesheet object (`link.sheet !== null`). */
  loaded: boolean;
  rel: string | null;
}

/**
 * The generated lane's style-delivery state across the trees that matter.
 *
 * Delivery is PARSER MARKUP, not runtime state: a shadow host's DSD template
 * declares its own island plan's marked links, and the nested light island's
 * sheet is a document resource declared by the route's build-time
 * document-style fact (the generated page root's producer has no `styleLinks`
 * channel when the page module declares no styles). Nothing is fetched by an
 * adapter, so there is no readiness record to read — the row's assertions are
 * about which tree declares which resource, how often, and whether the
 * runtime ever writes or adopts a substitute.
 */
interface DeliveryState {
  /** Marked links the DOCUMENT tree declares (head + body; shadow trees excluded). */
  documentLinks: MarkedLinkState[];
  /** Marked links declared in the document HEAD only. */
  headLinks: MarkedLinkState[];
  /**
   * Marked links declared INSIDE the page's shadow tree — the enclosing tree a
   * nested LIGHT island's content lands in. `querySelectorAll` on a ShadowRoot
   * does not cross a nested shadow boundary, so the nested combobox hosts' own
   * template links are absent here.
   */
  pageTemplateLinks: MarkedLinkState[];
  /** The two nested shadow combobox hosts' OWN DSD template links. */
  hostTemplateLinks: { shadowA: MarkedLinkState[]; shadowB: MarkedLinkState[] };
  /** True when the light host's FIRST node is its marked delivery link. */
  lightLeadingLink: boolean;
  /** Runtime-written style nodes anywhere in the document. */
  runtimeNodes: number;
  /** Inline framework style fallbacks (`<style data-oe-static-styles>`). */
  inlineFallbacks: number;
  /** Constructable sheets adopted at runtime, per tree that can own one. */
  adoptedSheets: { document: number; page: number; shadowA: number };
}

/**
 * Read the page's delivery state from the trees that own the sheets. The
 * /combobox light island (`zag-combobox-light`) is a LIGHT-root component
 * nested inside `combobox-page`'s DSD template; the two `zag-combobox` hosts
 * are shadow-root components inside the same template.
 */
function deliveryState(page: Page): Promise<DeliveryState> {
  return page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const shadowA = frame?.querySelector('zag-combobox[machine-id="shadow-a"]');
    const shadowB = frame?.querySelector('zag-combobox[machine-id="shadow-b"]');
    const light = frame?.querySelector('zag-combobox-light');
    const linksOf = (root: ParentNode | null | undefined): MarkedLinkState[] =>
      [...(root?.querySelectorAll?.('link[data-oe-static-styles]') ?? [])].map((link) => ({
        href: link.getAttribute('href'),
        loaded: (link as HTMLLinkElement).sheet !== null,
        rel: link.getAttribute('rel'),
      }));
    const first = light?.firstChild;
    return {
      documentLinks: linksOf(document),
      headLinks: linksOf(document.head),
      pageTemplateLinks: linksOf(frame),
      hostTemplateLinks: {
        shadowA: linksOf(shadowA?.shadowRoot),
        shadowB: linksOf(shadowB?.shadowRoot),
      },
      lightLeadingLink:
        !!first &&
        first.nodeType === 1 &&
        (first as Element).tagName.toLowerCase() === 'link' &&
        (first as Element).hasAttribute('data-oe-static-styles'),
      runtimeNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      inlineFallbacks: document.querySelectorAll('style[data-oe-static-styles]').length,
      adoptedSheets: {
        document: document.adoptedStyleSheets.length,
        page: frame?.adoptedStyleSheets.length ?? 0,
        shadowA: shadowA?.shadowRoot?.adoptedStyleSheets.length ?? 0,
      },
    };
  });
}

/** The declared hrefs of one tree, in document order (cross-tree delivery order). */
function hrefSignature(links: readonly MarkedLinkState[]): string {
  return links.map((link) => link.href).join('|');
}

/** Bounded gate: every load-strategy island tag on the page must define. */
async function defineEveryIsland(page: Page): Promise<void> {
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );
}

/**
 * Wait until a PAGE ROOT has finished its claim.
 *
 * A page root is an idle-strategy generated host: its SSR markup carries the
 * `data-oe-prop-seed` transport attribute and the claim consumes it on connect.
 * A row that MUTATES the page's claimed shadow tree (remove / re-append an
 * island, clear an activated root) must do so on a fully claimed page, otherwise
 * the mutation races the idle claim and the claim then legitimately reports the
 * position it expected (`OEIR_LEAF_CLAIM_MISMATCH: expected element … at
 * /0/2/0`) — a property of mutating server markup before it is adopted, not of
 * the row's subject.
 */
async function waitForPageClaim(page: Page, tag: string): Promise<void> {
  await page.waitForFunction(
    (pageTag: string) => {
      const host = document.querySelector(pageTag);
      return host !== null && !host.hasAttribute('data-oe-prop-seed');
    },
    tag,
    { timeout: GATE_TIMEOUT_MS },
  );
}

/** The init-script record `installRecorder` publishes on the page. */
function readRecorder(page: Page): Promise<Kr2Record> {
  return page.evaluate(() => (globalThis as unknown as { __kr2: Kr2Record }).__kr2);
}

interface CssRequestState {
  url: string;
  resourceType: string;
}

/**
 * Record every `.css` request the page makes, with the request's resource type.
 * The generated lane may only ever present the sheet as a `stylesheet` link
 * load; a `fetch`-typed css request would be the retired adapter channel.
 */
function recordCssRequests(page: Page): CssRequestState[] {
  const requests: CssRequestState[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('.css')) return;
    requests.push({ url: request.url(), resourceType: request.resourceType() });
  });
  return requests;
}

/**
 * The ONE page-level failure every /combobox load raises today, independent of
 * a row's scenario: GAP-2, a generated page root cannot claim a nested
 * hydrated LIGHT generated island. It is a pre-existing packages/ claim defect
 * tracked by the F16 closeout, not a fact any row here drives, so the rows
 * filter exactly this identity and still fail on ANY other diagnostic. The B1
 * row keeps the absolute assertion on purpose: a clean fail-closed surface IS
 * its subject (see its own comment).
 */
const KNOWN_GAP2_PAGE_ERROR = 'OE_RUNTIME_STATIC_RANGE_MISMATCH';

/** Every error line that is NOT the documented pre-existing GAP-2 failure. */
function unexpectedErrors(lines: readonly string[]): string[] {
  return lines.filter((line) => !line.includes(KNOWN_GAP2_PAGE_ERROR));
}

/**
 * Serialized spelling of one marked link, as the build/DSD serializer writes
 * it. Used to prove each live link is SERVER MARKUP (parser-visible delivery)
 * rather than a runtime-injected node.
 */
function serializedMarkedLink(href: string): string {
  return `<link rel="stylesheet" href="${href}" data-oe-static-styles />`;
}

async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record = { defines: [], rejects: [], errors: [], cssFetches: [] } as Kr2Record;
    (globalThis as unknown as { __kr2: Kr2Record }).__kr2 = record;
    const define = customElements.define.bind(customElements);
    customElements.define = ((
      name: string,
      ctor: CustomElementConstructor,
      options?: ElementDefinitionOptions,
    ) => {
      record.defines.push({ tag: name, at: Math.round(performance.now()) });
      return define(name, ctor, options);
    }) as typeof customElements.define;
    addEventListener('unhandledrejection', (event) => {
      const reason = (event as PromiseRejectionEvent).reason as { message?: string } | undefined;
      record.rejects.push({
        message: String(reason?.message ?? reason),
        at: Math.round(performance.now()),
      });
    });
    addEventListener('error', (event) => {
      record.errors.push({
        message: (event as ErrorEvent).message,
        at: Math.round(performance.now()),
      });
    });
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('.css')) record.cssFetches.push({ url, at: Math.round(performance.now()) });
      return originalFetch(input, init);
    }) as typeof fetch;
  });
}

/** Stage evidence for one failed attempt; observation only, after the loss. */
async function gatherFailureEvidence(page: Page): Promise<string> {
  const evidence = await page.evaluate(async (tags: string[]) => {
    const record = (globalThis as unknown as { __kr2: Kr2Record }).__kr2;
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/client/'))
      .map((raw) => {
        const entry = raw as PerformanceResourceTiming;
        return {
          url: entry.name,
          file: entry.name.split('/').pop() as string,
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
        };
      });
    // Post-mortem only: the race is already lost, so re-reading the same module
    // cannot mask anything. It separates "never evaluates" from "read too early".
    const readNamespace = async (url: string | undefined) => {
      if (url === undefined) return 'resource never requested';
      try {
        const namespace = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
        return `resolved, default=${typeof namespace.default}`;
      } catch (error) {
        return `rejected: ${String((error as Error)?.message ?? error)}`;
      }
    };
    const wrapper = resources.find(
      (entry) => entry.file.startsWith('zag-combobox-') && entry.file.endsWith('.js'),
    );
    const islandChunk = resources.find(
      (entry) => entry.file.startsWith('island-zag-combobox-') && entry.file.endsWith('.js'),
    );
    return {
      record,
      resources,
      stillMissing: tags.filter((tag) => customElements.get(tag) === undefined),
      wrapperRead: await readNamespace(wrapper?.url),
      islandChunkRead: await readNamespace(islandChunk?.url),
    };
  }, ISLAND_TAGS);

  const styleAsset = evidence.resources.find((entry) => entry.file.endsWith('.css'));
  const firstReject = evidence.record.rejects[0];
  const firstDefine = evidence.record.defines[0];
  return [
    `never defined: ${evidence.stillMissing.join(', ')}`,
    `first loader rejection: ${
      firstReject ? `${firstReject.message} @${firstReject.at}ms` : '(none recorded)'
    }`,
    `uncaught errors: ${evidence.record.errors.length}`,
    `define calls: ${
      evidence.record.defines.map((entry) => `${entry.tag}@${entry.at}ms`).join(', ') || '(none)'
    }`,
    `style asset fetch: ${
      styleAsset
        ? `start ${styleAsset.start}ms, responseEnd ${styleAsset.end}ms`
        : '(never requested)'
    }`,
    `readBeforeStyleSettled: ${
      firstReject !== undefined && styleAsset !== undefined
        ? `${firstReject.at < styleAsset.end ? 'yes' : 'no'} (reject ${firstReject.at}ms vs style responseEnd ${styleAsset.end}ms)`
        : 'unknown (no rejection or no style request)'
    }`,
    `post-mortem wrapper read: ${evidence.wrapperRead}`,
    `post-mortem island chunk read: ${evidence.islandChunkRead}`,
    `module timeline: ${evidence.resources
      .map((entry) => `${entry.file}[${entry.start}..${entry.end}]`)
      .join(' ')}`,
    `first define before first rejection: ${
      firstDefine !== undefined && firstReject !== undefined
        ? firstDefine.at < firstReject.at
        : 'n/a'
    }`,
  ].join('\n    ');
}

test('KR-2: repeated navigations all define every load-strategy island tag', async ({ page }) => {
  // The loader's own failure is caught by the activation wrapper, so it never
  // reaches unhandledrejection. Record the page's console and page errors too:
  // a swallowed rejection still leaves a trace there.
  const consoleLines: string[] = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

  // The static post-fix precondition: registration is decoupled from style
  // readiness, so no entry chunk awaits its style asset at module scope. A
  // chunk that did would reintroduce the network window KR-2 rode on.
  const ordering = chunkOrderingEvidence();
  expect(
    ordering.every((line) => line.includes('registration is decoupled from style readiness')),
    `entry chunk shape changed; island registration must not await the style asset:\n  ${ordering.join('\n  ')}`,
  ).toBe(true);

  await installRecorder(page);

  const failures: string[] = [];
  let navigations = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    navigations++;
    await page.goto('/combobox', { waitUntil: 'load' });
    let missing: string[] = [];
    try {
      await page.waitForFunction(
        (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
        ISLAND_TAGS,
        { timeout: GATE_TIMEOUT_MS },
      );
    } catch {
      missing = await page.evaluate(
        (tags: string[]) => tags.filter((tag) => customElements.get(tag) === undefined),
        ISLAND_TAGS,
      );
    }
    if (missing.length === 0) continue;
    const swallowed = consoleLines.slice(-6);
    consoleLines.length = 0;
    failures.push(
      `attempt ${attempt}:\n    ${await gatherFailureEvidence(page)}` +
        `\n    console trace: ${swallowed.length > 0 ? `\n      ${swallowed.join('\n      ')}` : '(nothing logged)'}`,
    );
  }

  // The sustained gate is only evidence when every attempt actually ran: a
  // pass must never be vacuous (`failures` is trivially empty if the loop
  // did not execute).
  expect(navigations, 'every KR2_ATTEMPTS navigation must run').toBe(ATTEMPTS);
  expect(
    failures,
    `${failures.length}/${ATTEMPTS} attempts never defined an island tag:\n\n${failures.join('\n\n')}\n\nentry chunk shape:\n  ${ordering.join('\n  ')}`,
  ).toEqual([]);
});

/**
 * Controlled trigger for the same failure mode: every style request of the
 * page is delayed, so the island chunks' style adapters are still in flight
 * (and their parser-declared links still loading) while the loader registers
 * the tags. The delay is test-side and the only perturbation: the product's
 * scheduling, read path and gates are untouched, and the unperturbed procedure
 * above stays the baseline.
 *
 * A correct loader must define every tag regardless of how long the style asset
 * takes — the gate is deliberately above the injected delay. A loader that
 * reads the entry namespace behind the style fetch never defines the tag at
 * all, which is the original failure observed in the field.
 */
test('KR-2 controlled trigger: a held style asset must not cost the island its definition', async ({
  page,
}) => {
  const styleDelayMs = Number(process.env.KR2_STYLE_DELAY_MS ?? 1_500);
  await installRecorder(page);
  await page.route('**/*.css', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, styleDelayMs));
    await route.continue();
  });

  await page.goto('/combobox', { waitUntil: 'load' });
  let missing: string[] = [];
  try {
    await page.waitForFunction(
      (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
      ISLAND_TAGS,
      { timeout: GATE_TIMEOUT_MS },
    );
  } catch {
    missing = await page.evaluate(
      (tags: string[]) => tags.filter((tag) => customElements.get(tag) === undefined),
      ISLAND_TAGS,
    );
  }

  const detail =
    missing.length === 0
      ? 'every tag defined'
      : `held style asset (${styleDelayMs}ms) left tags undefined:\n    ${await gatherFailureEvidence(page)}`;
  expect(missing, detail).toEqual([]);
});

/**
 * KR-2 post-fix delivery contract (generated lane).
 *
 * The class lane held a `fetch`-based style ADAPTER open to prove that island
 * registration did not wait on it (readiness lived on the sheet as
 * `STYLE_SHEET_READY`). The generated lane has no adapter at all: measured on
 * /combobox, there is NO fetch-type `.css` request — every `.css` request is a
 * parser-declared `<link rel="stylesheet" data-oe-static-styles>` load
 * (resourceType "stylesheet") — so the "held adapter" premise is retired
 * rather than re-run, and the row pins the delivery it was standing in for:
 *
 *   - the links are SERVER MARKUP, not runtime writes: every marked link in
 *     the live DOM appears verbatim in the /combobox response HTML;
 *   - one resource, one delivery per owning tree: each nested shadow
 *     `zag-combobox` host's DSD template declares exactly ONE marked link —
 *     its own sheet — and both hosts declare the same resource (the retired
 *     F16 union declared all 7 app-wide sheets in every template);
 *   - the nested light island's sheet is the DOCUMENT resource the route's
 *     build-time fact declares: one marked link in the document head, a
 *     different resource from the shadow islands', declared exactly once;
 *   - a sheet never leaks across owners (no shadow sheet repeated in the page
 *     template, no href duplicated inside one tree), and the runtime writes no
 *     style node and adopts no constructable sheet.
 */
test('KR-2 post-fix: the marked <link> is the only style delivery, so nothing can hold registration behind a fetch', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installRecorder(page);
  const cssRequests = recordCssRequests(page);

  await page.goto('/combobox', { waitUntil: 'load' });
  await defineEveryIsland(page);

  const recorder = await readRecorder(page);
  expect(
    recorder.cssFetches,
    'the retired adapter fetch channel is gone: no `.css` request may be a fetch',
  ).toEqual([]);
  expect(
    recorder.defines
      .map((entry) => entry.tag)
      .filter((tag) => ISLAND_TAGS.includes(tag))
      .sort(),
    `both load-strategy island tags registered (defines: ${recorder.defines
      .map((entry) => entry.tag)
      .join(', ')})`,
  ).toEqual([...ISLAND_TAGS].sort());
  expect(cssRequests.length, 'the page must request the island sheets at all').toBeGreaterThan(0);
  expect(
    [...new Set(cssRequests.map((entry) => entry.resourceType))],
    `every stylesheet request is a link load, never a fetch (${JSON.stringify(cssRequests)})`,
  ).toEqual(['stylesheet']);

  const delivery = await deliveryState(page);
  // The delivery is server markup. Read the same route's bytes through the
  // request context: a link the parser wrote exists in the response, a runtime
  // write would not.
  const response = await request.get('/combobox');
  expect(response.ok(), `the /combobox response must be readable (${response.status()})`).toBe(
    true,
  );
  const markup = await response.text();
  const allLinks = [
    ...delivery.documentLinks,
    ...delivery.pageTemplateLinks,
    ...delivery.hostTemplateLinks.shadowA,
    ...delivery.hostTemplateLinks.shadowB,
  ];
  const runtimeOnlyLinks = allLinks.filter(
    (link) => link.href === null || !markup.includes(serializedMarkedLink(link.href)),
  );
  expect(
    runtimeOnlyLinks,
    `every marked link must be parser-declared markup, not a runtime write (runtime-only: ${JSON.stringify(runtimeOnlyLinks)})`,
  ).toEqual([]);

  // One resource, one delivery per owning tree.
  const shadowAHrefs = delivery.hostTemplateLinks.shadowA.map((link) => link.href);
  const shadowBHrefs = delivery.hostTemplateLinks.shadowB.map((link) => link.href);
  expect(
    shadowAHrefs.length,
    `a shadow host's DSD template declares exactly its OWN sheet; the F16 union declared the app-wide set (measured 7): ${JSON.stringify(
      delivery.hostTemplateLinks.shadowA,
    )}`,
  ).toBe(1);
  expect(shadowBHrefs, 'the second combobox host declares the same one resource').toEqual(
    shadowAHrefs,
  );
  expect(
    delivery.hostTemplateLinks.shadowA.every((link) => link.loaded && link.rel === 'stylesheet'),
    'the shadow host delivery links are applied stylesheets',
  ).toBe(true);
  expect(
    new Set(shadowAHrefs).size,
    'a sheet is one resource: no href repeats inside one tree',
  ).toBe(shadowAHrefs.length);

  const headHrefs = delivery.headLinks.map((link) => link.href);
  expect(
    headHrefs.length,
    `the nested light island's sheet is the route's ONE document resource: ${JSON.stringify(
      delivery.headLinks,
    )}`,
  ).toBe(1);
  expect(
    delivery.headLinks.every((link) => link.loaded),
    'the document delivery loaded',
  ).toBe(true);
  expect(new Set(headHrefs).size, 'the document tree declares no resource twice').toBe(
    headHrefs.length,
  );
  expect(
    shadowAHrefs.filter((href) => headHrefs.includes(href)),
    `the shadow islands' sheet is not the light island's document resource (head=${JSON.stringify(
      headHrefs,
    )}, shadow=${JSON.stringify(shadowAHrefs)})`,
  ).toEqual([]);
  expect(
    delivery.pageTemplateLinks.filter((link) => shadowAHrefs.includes(link.href)),
    "the union defect inverse: a nested shadow host's sheet is not lifted into the page template",
  ).toEqual([]);
  expect(
    delivery.lightLeadingLink,
    'the light host declares no link of its own — its sheet is the document resource above',
  ).toBe(false);

  expect(delivery.runtimeNodes, 'no runtime style node is written').toEqual(0);
  expect(delivery.inlineFallbacks, 'no inline framework style fallback exists').toEqual(0);
  expect(delivery.adoptedSheets, 'no constructable sheet is adopted at runtime').toEqual({
    document: 0,
    page: 0,
    shadowA: 0,
  });

  expect(
    unexpectedErrors(pageErrors),
    `the delivery must add no error (${pageErrors.join(' | ') || '(none)'})`,
  ).toEqual([]);
});

/**
 * Q1-A: a disconnect with no adapter channel leaves no late style write.
 *
 * The class lane held the light island's adapter `fetch` open, removed the
 * island, then released the fetch and proved that no late write touched the
 * document. The generated lane has no such channel: measured, the page makes
 * ZERO fetch-type `.css` requests (every sheet is a parser-declared link) and
 * no island owns a style node or adopted sheet, so there is nothing that can
 * settle after a disconnect and write on behalf of a dropped connection. The
 * row pins the replacement property:
 *
 *   - the disconnect adds/removes no STYLE or LINK node anywhere in the
 *     document or the page's shadow tree;
 *   - the document-level delivery is untouched (it belongs to the route, not
 *     to the instance) and no per-instance style node exists;
 *   - the dropped root stays dropped and surfaces no error.
 */
test('Q1-A: a disconnected light island leaves no late style write', async ({ page }) => {
  await installRecorder(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/combobox', { waitUntil: 'domcontentloaded' });
  await defineEveryIsland(page);
  await waitForPageClaim(page, 'combobox-page');

  const recorder = await readRecorder(page);
  expect(
    recorder.cssFetches,
    'no adapter fetch exists to settle late, so the class-lane held-fetch premise is retired',
  ).toEqual([]);

  const before = await deliveryState(page);
  const observed = await page.evaluate(async () => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light');
    const parent = host?.parentNode ?? null;
    const styleMutations: string[] = [];
    const watch = (root: Node): MutationObserver => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && ['STYLE', 'LINK'].includes((node as Element).tagName)) {
              styleMutations.push(`added ${(node as Element).tagName}`);
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === 1 && ['STYLE', 'LINK'].includes((node as Element).tagName)) {
              styleMutations.push(`removed ${(node as Element).tagName}`);
            }
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      return observer;
    };
    const observers = [watch(document), ...(frame ? [watch(frame)] : [])];
    host?.remove();
    await new Promise((resolve) => setTimeout(resolve, 600));
    observers.forEach((observer) => observer.disconnect());
    return {
      hadHost: host !== undefined && host !== null,
      hadParent: parent !== null,
      styleMutations,
      stillConnected: frame?.querySelector('zag-combobox-light') !== null,
      runtimeNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
    };
  });

  expect(
    { hadHost: observed.hadHost, hadParent: observed.hadParent },
    'the fixture must expose the light island to disconnect it',
  ).toEqual({ hadHost: true, hadParent: true });
  expect(
    observed.styleMutations,
    'the disconnect must add or remove no STYLE/LINK node in either tree',
  ).toEqual([]);
  expect(observed.stillConnected, 'the light island stays disconnected').toBe(false);
  expect(observed.runtimeNodes, 'the disconnected island owns no runtime style node').toEqual(0);

  const after = await deliveryState(page);
  expect(
    hrefSignature(after.documentLinks),
    'the document-level delivery belongs to the route and survives the disconnect',
  ).toEqual(hrefSignature(before.documentLinks));
  expect(
    hrefSignature(after.pageTemplateLinks),
    'the page template declares no delivery for the dropped root',
  ).toEqual(hrefSignature(before.pageTemplateLinks));
  expect(after.runtimeNodes, 'the released disconnect wrote nothing at all').toEqual(0);

  expect(
    unexpectedErrors(pageErrors),
    `no error may surface across the disconnect (${pageErrors.join(' | ') || '(none)'})`,
  ).toEqual([]);
});

/**
 * Q1-B: a moved light island keeps its declared delivery and resumes bindings
 * and dynamic state.
 *
 * The class lane asserted that the sheet resumes with the moved component (the
 * delivery was a marked link the class serializer lifted into the page
 * template). The generated page root's producer has no `styleLinks` channel
 * (its module declares no styles, so the compiler omits it), so the light
 * island's sheet is the route's single DOCUMENT resource — measured before and
 * after the move: one marked head link, no marked link in the page template,
 * no runtime style node in any tree. The row therefore pins the delivery's
 * INVARIANCE across the same-turn move plus the behaviour that must genuinely
 * resume:
 *
 *   - same element instance; declared delivery unchanged (same hrefs, still
 *     loaded); no runtime style node appears;
 *   - the value typed before the move survives;
 *   - the resumed bindings still drive the machine (a second full keyboard
 *     round selects a fruit);
 *   - computed style of the surviving DOM is identical before/after (the
 *     resume neither replaces the DOM nor re-applies a sheet onto it).
 *
 * Measured gap, reported to the F16 closeout and NOT asserted as desirable:
 * because the generated page root drops the lift channel, this nested light
 * island's document-level sheet cannot reach the page's shadow tree, so the
 * fixture's light island renders unstyled today. The assertions below are the
 * delivery/resume facts that hold; they do not claim computed rules.
 */
test('Q1-B: a moved light island keeps its delivery and resumes bindings and state', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/combobox', { waitUntil: 'load' });
  await defineEveryIsland(page);

  // First round of real runtime change: open the list (a dynamic block range
  // moves into the DOM) and let the machine write its state.
  const input = page.locator('zag-combobox-light input[data-part="input"]');
  await input.click();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'combobox:light-fruit:option:apple');
  await input.fill('typed-before-move');

  const before = await deliveryState(page);
  const styleBefore = await page.evaluate(() => {
    const light = document
      .querySelector('combobox-page')
      ?.shadowRoot?.querySelector('zag-combobox-light');
    const root = light?.firstElementChild;
    const liveInput = light?.querySelector('input[data-part="input"]');
    return {
      rootDisplay: root ? getComputedStyle(root).display : null,
      inputPadding: liveInput ? getComputedStyle(liveInput).padding : null,
      inputFont: liveInput ? getComputedStyle(liveInput).fontFamily : null,
    };
  });
  expect(before.runtimeNodes, 'the island carries no runtime style node before the move').toEqual(
    0,
  );
  expect(before.adoptedSheets, 'no runtime sheet adoption before the move').toEqual({
    document: 0,
    page: 0,
    shadowA: 0,
  });
  expect(
    before.documentLinks.length,
    `the route declares one document resource before the move (${JSON.stringify(
      before.documentLinks,
    )})`,
  ).toBe(1);

  const moved = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    if (!frame || !host) return null;
    const parent = host.parentNode as ParentNode;
    (globalThis as { __q1bIdentity?: unknown }).__q1bIdentity = host;
    host.remove();
    parent.appendChild(host);
    return { moved: true };
  });
  expect(moved, 'the fixture must expose the light island').not.toBeNull();

  const state = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    const liveInput = frame?.querySelector(
      'zag-combobox-light input[data-part="input"]',
    ) as HTMLInputElement | null;
    return {
      identity: (globalThis as { __q1bIdentity?: unknown }).__q1bIdentity === host,
      value: liveInput?.value ?? 'missing',
      rootDisplay: host?.firstElementChild
        ? getComputedStyle(host.firstElementChild).display
        : null,
      inputPadding: liveInput ? getComputedStyle(liveInput).padding : null,
      inputFont: liveInput ? getComputedStyle(liveInput).fontFamily : null,
    };
  });
  const after = await deliveryState(page);
  expect(state.identity, 'the reconnected island is the same element instance').toBe(true);
  expect(state.value, 'runtime state survives the move').toEqual('typed-before-move');
  expect(
    hrefSignature(after.documentLinks),
    'the declared delivery is unchanged by the move',
  ).toEqual(hrefSignature(before.documentLinks));
  expect(hrefSignature(after.pageTemplateLinks), 'the move adds no template-side delivery').toEqual(
    hrefSignature(before.pageTemplateLinks),
  );
  expect(
    after.headLinks.every((link) => link.loaded),
    'the delivery is still loaded after the move',
  ).toBe(true);
  expect(after.runtimeNodes, 'the resumed island injects no style node').toEqual(0);
  expect(after.adoptedSheets, 'the resume adopts no constructable sheet').toEqual({
    document: 0,
    page: 0,
    shadowA: 0,
  });
  expect(
    {
      rootDisplay: state.rootDisplay,
      inputPadding: state.inputPadding,
      inputFont: state.inputFont,
    },
    `the resume neither replaces nor re-styles the surviving DOM (before=${JSON.stringify(
      styleBefore,
    )})`,
  ).toEqual(styleBefore);

  // Second round of real runtime change after the resume: the resumed bindings
  // must drive the DOM again.
  await page.keyboard.press('Escape');
  await input.click();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'combobox:light-fruit:option:apple');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Apple');

  expect(
    unexpectedErrors(pageErrors),
    `no error may surface across the resume (${pageErrors.join(' | ') || '(none)'})`,
  ).toEqual([]);
});

/**
 * Q1-C: one light instance disconnecting leaves the shared delivery and the
 * other instance working.
 *
 * The class lane owned ONE static sheet list shared by every instance, so the
 * row could disconnect instances and watch the last-owner cleanup. The
 * generated lane's sharing model is different and deliberately pinned here:
 * the sheet is the route's single DOCUMENT resource (server markup, declared
 * once in the head) and the island owns neither a style node nor an adopted
 * sheet, so instance churn can neither duplicate nor remove the delivery.
 * What the row proves:
 *
 *   - a second, CSR-mounted instance of the same island connects and builds
 *     its own content while the declared delivery stays exactly one resource;
 *   - the first instance's state survives the churn;
 *   - removing the second instance leaves the delivery and the first
 *     instance's machine working (a real keyboard round);
 *   - the last instance leaving removes nothing from the document (the
 *     resource belongs to the route, not to an owner count) and writes no
 *     style node.
 */
test('Q1-C: one light instance disconnecting leaves the shared delivery and the other instance working', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/combobox', { waitUntil: 'load' });
  await defineEveryIsland(page);

  const before = await deliveryState(page);
  expect(
    before.documentLinks.length,
    `the shared delivery is one document resource (${JSON.stringify(before.documentLinks)})`,
  ).toBe(1);
  expect(before.runtimeNodes, 'the island owns no style node before the churn').toEqual(0);

  const input = page.locator('zag-combobox-light input[data-part="input"]');
  await input.fill('shared-value');

  const second = await page.evaluate(async () => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const first = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    if (!frame || !first) return null;
    const instance = document.createElement('zag-combobox-light');
    instance.setAttribute('machine-id', 'second-instance');
    frame.appendChild(instance);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const liveInput = instance.querySelector('input[data-part="input"]');
    const result = {
      children: instance.childNodes.length,
      hasInput: liveInput !== null,
      role: liveInput?.getAttribute('role') ?? null,
      firstValue:
        (first.querySelector('input[data-part="input"]') as HTMLInputElement | null)?.value ?? null,
      firstConnected: first.isConnected,
    };
    instance.remove();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return result;
  });
  expect(second, 'the fixture must expose the light island').not.toBeNull();
  expect(second!.children, 'the second instance mounts its own content').toBeGreaterThan(0);
  expect(
    second!.hasInput,
    'the second instance builds the island DOM (the definition is shared)',
  ).toBe(true);
  expect(second!.role, 'the second instance binds its machine').toBe('combobox');
  expect(
    second!.firstValue,
    'the first instance keeps its state while the second connects',
  ).toEqual('shared-value');
  expect(second!.firstConnected, 'the first instance stays connected').toBe(true);

  const afterSecond = await deliveryState(page);
  expect(
    hrefSignature(afterSecond.documentLinks),
    'the second instance adds no delivery: the sheet is one document resource',
  ).toEqual(hrefSignature(before.documentLinks));
  expect(afterSecond.runtimeNodes, 'the second instance writes no style node').toEqual(0);

  // The surviving instance still works after the other one left.
  await input.fill('');
  await input.click();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'combobox:light-fruit:option:apple');

  const last = await page.evaluate(async () => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    frame?.querySelector('zag-combobox-light')?.remove();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { remaining: frame?.querySelectorAll('zag-combobox-light').length ?? -1 };
  });
  const afterLast = await deliveryState(page);
  expect(last.remaining, 'the last instance really left').toEqual(0);
  expect(
    hrefSignature(afterLast.documentLinks),
    'the last owner leaving removes nothing: the document resource belongs to the route, not to an owner count',
  ).toEqual(hrefSignature(before.documentLinks));
  expect(afterLast.runtimeNodes, 'the last disconnect leaves no style node').toEqual(0);
  expect(
    unexpectedErrors(pageErrors),
    `no error may surface across the churn (${pageErrors.join(' | ') || '(none)'})`,
  ).toEqual([]);
});

/**
 * Q1-D (P0-A, real-engine resume reconciliation): a signal written while the
 * island is disconnected reaches no subscription, so the resume must reconcile
 * the runtime's own DOM to the current value instead of re-verifying it as an
 * SSR artifact and instead of leaving the stale value in place.
 * `<decoupled-view>` renders a text Part bound to its `marker` property, so the
 * text node itself carries the proof.
 *
 * The binding is driven before the move (live update), a value is written
 * while the element is detached, and the reconnected instance must show the
 * current value — then be driven again, so "bindings restored" is not claimed
 * from a static snapshot alone.
 *
 * BLOCKED (kept RED, owner decision): the reconcile/binding assertions below
 * pass on the generated lane — measured on chromium/firefox/webkit, the text is
 * `content element: while-away` after the reconnect and `content element:
 * after` after the next write — but /decoupled ALSO surfaces a pre-existing
 * claim defect on the nested host carrying the dynamic `marker` attribute:
 * `OEIR_LEAF_CLAIM_MISMATCH: static attribute seed count is 1, declared 0 at
 * /0/0 (authored app/components/page-decoupled.tsx:34:7)`. The row's no-error
 * contract therefore cannot pass; it is kept absolute rather than filtered so
 * the defect stays visible.
 */
test('Q1-D: a resumed island reconciles a value written while disconnected', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/decoupled?marker=first', { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      customElements.get('decoupled-view') !== undefined &&
      document.querySelector('decoupled-page')?.shadowRoot?.querySelector('decoupled-view') !==
        null,
    undefined,
    { timeout: GATE_TIMEOUT_MS },
  );
  // The row mutates the page's claimed shadow tree below: wait for the page
  // root's own claim so the mutation cannot race it.
  await waitForPageClaim(page, 'decoupled-page');

  // Driven BEFORE the transition: a live attribute write must reach the DOM
  // (this also proves the island activated before the move). The attribute is
  // the island's canonical input channel: the facade's compiled property is
  // attribute-backed and re-seeds from its attribute at connect.
  await page.evaluate(() => {
    const frame = document.querySelector('decoupled-page')?.shadowRoot;
    const view = frame?.querySelector('decoupled-view');
    if (view) view.setAttribute('marker', 'content element: driven');
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('decoupled-page')
        ?.shadowRoot?.querySelector('decoupled-view')
        ?.querySelector('#decoupled-content')?.textContent === 'content element: driven',
    undefined,
    { timeout: GATE_TIMEOUT_MS },
  );

  const moved = await page.evaluate(() => {
    const frame = document.querySelector('decoupled-page')?.shadowRoot;
    const view = frame?.querySelector('decoupled-view');
    if (!frame || !view) return null;
    (globalThis as { __q1dView?: unknown }).__q1dView = view;
    view.remove();
    // Detached: the write reaches the signal but no subscription, so the
    // runtime's own DOM keeps the disconnect-time render until the resume.
    view.setAttribute('marker', 'content element: while-away');
    return true;
  });
  expect(moved, 'the fixture must expose the decoupled island').toBe(true);

  const reconnected = await page.evaluate(() => {
    const frame = document.querySelector('decoupled-page')?.shadowRoot;
    const view = (globalThis as { __q1dView?: HTMLElement }).__q1dView;
    if (!frame || !view) return null;
    frame.appendChild(view);
    return true;
  });
  expect(reconnected).toBe(true);

  await page.waitForFunction(
    () =>
      document
        .querySelector('decoupled-page')
        ?.shadowRoot?.querySelector('decoupled-view')
        ?.querySelector('#decoupled-content')?.textContent === 'content element: while-away',
    undefined,
    { timeout: GATE_TIMEOUT_MS },
  );

  const state = await page.evaluate(() => {
    const frame = document.querySelector('decoupled-page')?.shadowRoot;
    const view = frame?.querySelector('decoupled-view') as HTMLElement | null;
    return {
      identity: (globalThis as { __q1dView?: unknown }).__q1dView === view,
      text: view?.querySelector('#decoupled-content')?.textContent ?? null,
    };
  });
  expect(state.identity, 'the reconnect resumes the same instance').toBe(true);
  expect(state.text).toBe('content element: while-away');

  // Driven AFTER the transition: the resumed binding must keep working.
  await page.evaluate(() => {
    const frame = document.querySelector('decoupled-page')?.shadowRoot;
    const view = frame?.querySelector('decoupled-view');
    if (view) view.setAttribute('marker', 'content element: after');
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('decoupled-page')
        ?.shadowRoot?.querySelector('decoupled-view')
        ?.querySelector('#decoupled-content')?.textContent === 'content element: after',
    undefined,
    { timeout: GATE_TIMEOUT_MS },
  );

  expect(errors, `no error may surface across the resume (${errors.join(' | ')})`).toEqual([]);
});

/**
 * Q2: a stylesheet that never loads stays a failure — the parser's delivery is
 * never rewritten into a "ready" state and island definition/activation do not
 * depend on the sheet.
 *
 * The class lane reported a failed adapter read as
 * `OE_STYLES_SHEET_LOAD_FAILED` and the row checked that no inline fallback
 * was read as ready. The generated lane has no adapter and no readiness read
 * at all: the delivery is a parser-declared `<link>`, so the only honest
 * signals are (a) the delivery markup is left exactly as the server wrote it,
 * (b) the runtime writes no substitute node and adopts no sheet, and (c) the
 * islands still define and still activate. Measured before re-authoring: with
 * every `.css` request failing, both island tags define, the light island's
 * machine selects a fruit, and zero STYLE/LINK nodes are added or removed.
 */
for (const mode of ['http-500', 'network-abort'] as const) {
  test(`Q2: a ${mode} stylesheet failure is never rewritten as ready`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installRecorder(page);
    const failedResponses: number[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('.css')) failedResponses.push(response.status());
    });
    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => {
      if (!request.url().endsWith('.css')) return;
      failedRequests.push(request.failure()?.errorText ?? 'failed');
    });
    await page.route('**/*.css', async (route) => {
      if (mode === 'http-500') await route.fulfill({ status: 500, body: '' });
      else await route.abort('failed');
    });

    await page.goto('/combobox', { waitUntil: 'load' });
    await defineEveryIsland(page);
    const atLoad = await deliveryState(page);

    // The perturbation must be real: the sheets failed, not merely slowed.
    if (mode === 'http-500') {
      expect(
        failedResponses.filter((status) => status === 500).length,
        `the route must actually fail the sheet requests (${JSON.stringify(failedResponses)})`,
      ).toBeGreaterThan(0);
    } else {
      expect(
        failedRequests.length,
        `the route must actually abort the sheet requests (${JSON.stringify(failedRequests)})`,
      ).toBeGreaterThan(0);
    }

    // Definition and activation are independent of the sheet: drive the light
    // island's machine with the failed delivery in place.
    const input = page.locator('zag-combobox-light input[data-part="input"]');
    await input.click();
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      'combobox:light-fruit:option:apple',
    );
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Apple');

    const settled = await deliveryState(page);
    const recorder = await readRecorder(page);
    expect(recorder.cssFetches, 'a failed link must not fall back to a fetch channel').toEqual([]);
    expect(recorder.rejects, 'a style failure must not surface as an unhandled rejection').toEqual(
      [],
    );
    expect(
      unexpectedErrors(pageErrors),
      `no page error beyond the documented pre-existing GAP-2 failure may surface (${
        pageErrors.join(' | ') || '(none)'
      })`,
    ).toEqual([]);

    // The delivery markup is never rewritten and nothing replaces it.
    expect(
      hrefSignature(settled.documentLinks),
      'the document delivery survives a failed sheet',
    ).toEqual(hrefSignature(atLoad.documentLinks));
    expect(
      hrefSignature(settled.hostTemplateLinks.shadowA),
      'the shadow host template delivery survives a failed sheet',
    ).toEqual(hrefSignature(atLoad.hostTemplateLinks.shadowA));
    expect(
      hrefSignature(settled.hostTemplateLinks.shadowB),
      'the second shadow host template delivery survives a failed sheet',
    ).toEqual(hrefSignature(atLoad.hostTemplateLinks.shadowB));
    expect(
      settled.documentLinks.length,
      'the failed sheet stays exactly the declared document delivery',
    ).toBeGreaterThan(0);
    expect(settled.lightLeadingLink, 'the light host gains no inline substitute link').toEqual(
      atLoad.lightLeadingLink,
    );
    expect(
      settled.inlineFallbacks,
      'a failed sheet never becomes an inline style fallback',
    ).toEqual(0);
    expect(settled.runtimeNodes, 'a failed sheet never becomes a runtime style node').toEqual(0);
    expect(
      settled.adoptedSheets,
      'a failed sheet is never adopted as a constructable sheet',
    ).toEqual({ document: 0, page: 0, shadowA: 0 });

    // A machine that selected a fruit above ran on DOM whose sheet never
    // loaded: the delivery was never read as ready, and never blocked.
    await expect(input).toHaveAttribute('role', 'combobox');
  });
}

/**
 * Mechanism probe, no fixture or product files: the shipped graph's exact
 * shape, built from two blob modules in the page.
 *
 *   B  — an async module whose exported binding is assigned behind a top-level
 *        await (the island chunk: `await fetch(styleAsset)` before the class).
 *   A  — a pure re-export facade over B (the wrapper chunk: `import … from
 *        './island-…'` plus `export { … as default }`).
 *
 * B is started and observed inside its await, then A is imported. A dynamic
 * import of A must resolve only after B's evaluation completes, so `default`
 * must be a function. This test pins the engine differential as a platform
 * fact — WebKit resolves A early and the read lands inside B's window — because
 * that is the read the generated loader performs, and the only shape that turns
 * a held style asset into a never-defined tag. It is a characterization of the
 * engine, not of our code: a fix has to make the loader (or the emitted module
 * shape) survive the early resolution, it cannot rely on the engine changing.
 */
test('KR-2 engine characterization: resolving a re-export facade while its async dependency is held', async ({
  page,
  browserName,
}) => {
  await page.goto('/combobox');
  const probe = await page.evaluate(async () => {
    const holdMs = 400;
    const bUrl = URL.createObjectURL(
      new Blob(
        [
          `
          globalThis.__kr2ProbeEntered = true;
          await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
          var exported = class { static probe = 'B'; };
          export { exported as default };
          `,
        ],
        { type: 'text/javascript' },
      ),
    );
    const aUrl = URL.createObjectURL(
      new Blob(
        [
          `
          import reexported from ${JSON.stringify(bUrl)};
          export { reexported as default };
          `,
        ],
        { type: 'text/javascript' },
      ),
    );

    const bPromise = import(bUrl);
    // Bounded setup poll: module evaluation is a task, so a microtask spin
    // never lets it run. One macrotask turn per step, deadline-bounded.
    const deadline = performance.now() + 2_000;
    while (
      (globalThis as { __kr2ProbeEntered?: boolean }).__kr2ProbeEntered !== true &&
      performance.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const enteredHold = (globalThis as { __kr2ProbeEntered?: boolean }).__kr2ProbeEntered === true;

    const startedAt = performance.now();
    const facade = (await import(aUrl)) as Record<string, unknown>;
    const facadeReturnedAfterMs = Math.round(performance.now() - startedAt);
    const readInsideWindow = typeof facade.default;

    await bPromise;
    const readAfterEvaluation = typeof facade.default;

    return { enteredHold, holdMs, facadeReturnedAfterMs, readInsideWindow, readAfterEvaluation };
  });

  const detail =
    `facade import() returned after ${probe.facadeReturnedAfterMs}ms ` +
    `(dependency held ${probe.holdMs}ms) and read default=${probe.readInsideWindow}; ` +
    `after the dependency completed, default=${probe.readAfterEvaluation}.`;

  expect(probe.enteredHold, `probe setup failed: B never entered its await. ${detail}`).toBe(true);
  if (browserName === 'webkit') {
    // The recorded defect: the read happens inside the async module's window.
    expect(probe.readInsideWindow, detail).toEqual('undefined');
    expect(probe.facadeReturnedAfterMs, detail).toBeLessThan(probe.holdMs / 2);
  } else {
    expect(probe.readInsideWindow, detail).toEqual('function');
  }
  // Every engine agrees the binding is correct once the dependency completes:
  // the module is fine, only the moment it is observed differs.
  expect(probe.readAfterEvaluation, detail).toEqual('function');
});

/**
 * K0: can the facade be dropped for a direct import of the module that defines
 * the class? The loader currently imports the re-export facade, which WebKit
 * resolves while its async dependency is still evaluating. Three shapes are
 * measured against the same held dependency:
 *
 *   cold      `import(B)` — B defines and exports the class behind its await;
 *             nothing has started B yet.
 *   second    `import(B)` again while B is already evaluating through another
 *             consumer — the product's real situation, where the light island's
 *             chunk has already pulled the shared chunk in.
 *   facade    `import(A)` where A only re-exports B (the shipped loader path).
 *
 * A direct import is only a candidate fix if `second` waits for the dependency
 * and yields the constructor; a cold-only success would leave the loader
 * reading early exactly when another island reached the chunk first.
 */
test('K0: direct import of the defining module versus the re-export facade', async ({
  page,
  browserName,
}) => {
  await page.goto('/combobox');
  const measured = await page.evaluate(async () => {
    const holdMs = 400;
    // One flag per module: a shared flag would let one shape's entry satisfy
    // another shape's wait.
    const makeB = (flagName: string) =>
      URL.createObjectURL(
        new Blob(
          [
            `
          globalThis[${JSON.stringify(flagName)}] = true;
          await new Promise((resolve) => setTimeout(resolve, ${holdMs}));
          var exported = class { static probe = 'B'; };
          export { exported as default };
          `,
          ],
          { type: 'text/javascript' },
        ),
      );

    const waitForHold = async (flagName: string) => {
      const deadline = performance.now() + 2_000;
      while (
        (globalThis as Record<string, unknown>)[flagName] !== true &&
        performance.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return (globalThis as Record<string, unknown>)[flagName] === true;
    };
    const read = async (url: string) => {
      const startedAt = performance.now();
      const namespace = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
      return {
        elapsedMs: Math.round(performance.now() - startedAt),
        defaultType: typeof namespace.default,
      };
    };

    // cold: first consumer, nothing else has started the module.
    const cold = await read(makeB('__k0Cold'));

    // second: the module is mid-evaluation through another consumer.
    const runningB = makeB('__k0Second');
    const running = read(runningB);
    const secondEntered = await waitForHold('__k0Second');
    const second = await read(runningB);
    await running;

    // facade: the shipped loader path, over the same held shape.
    const facadeB = makeB('__k0Facade');
    const started = read(facadeB);
    const facadeEntered = await waitForHold('__k0Facade');
    const facadeUrl = URL.createObjectURL(
      new Blob(
        [
          `
          import reexported from ${JSON.stringify(facadeB)};
          export { reexported as default };
          `,
        ],
        { type: 'text/javascript' },
      ),
    );
    const facade = await read(facadeUrl);
    await started;

    return { holdMs, cold, second, facade, secondEntered, facadeEntered };
  });

  const summary =
    `held dependency ${measured.holdMs}ms — ` +
    `cold import ${measured.cold.elapsedMs}ms/${measured.cold.defaultType}, ` +
    `second import ${measured.second.elapsedMs}ms/${measured.second.defaultType}, ` +
    `facade import ${measured.facade.elapsedMs}ms/${measured.facade.defaultType}`;
  expect(
    measured.secondEntered && measured.facadeEntered,
    `probe setup failed (secondEntered=${measured.secondEntered}, ` +
      `facadeEntered=${measured.facadeEntered}): ${summary}`,
  ).toBe(true);
  if (browserName === 'webkit') {
    // The recorded behaviour: the first, cold import is spec-ordered, while any
    // import of a module that is already evaluating resolves early — the facade
    // and a direct re-import alike. This is why dropping the facade cannot fix
    // the loader: another consumer always reaches the shared chunk first.
    expect(measured.cold.defaultType, summary).toEqual('function');
    expect(measured.cold.elapsedMs, summary).toBeGreaterThanOrEqual(measured.holdMs / 2);
    expect(measured.second.defaultType, summary).toEqual('undefined');
    expect(measured.facade.defaultType, summary).toEqual('undefined');
  } else {
    // Every shape waits for the dependency and sees the constructor.
    for (const shape of [measured.cold, measured.second, measured.facade]) {
      expect(shape.defaultType, summary).toEqual('function');
      expect(shape.elapsedMs, summary).toBeGreaterThanOrEqual(measured.holdMs / 2);
    }
  }
});

/**
 * Finding B1 (generated lane): an activated instance whose program-owned root
 * content was removed externally must not silently restart as a first CSR
 * activation. The reconnect resumes against the program's own DOM and fails
 * closed with the generated identity
 * `OEIR_LEAF_CLAIM_MISMATCH: missing node at /0`; the root must not be rebuilt
 * behind the caller's back, and the failed connect must not leave a
 * half-activated kernel or a style node.
 *
 * KEPT RED (owner decision): the fail-closed identity, the "not rebuilt" fact
 * and the style-node fact all hold on the generated lane, but /combobox
 * already raises GAP-2's page-level `OE_RUNTIME_STATIC_RANGE_MISMATCH` on EVERY
 * load (a generated page root cannot claim a nested hydrated LIGHT generated
 * island). The final assertion therefore compares the whole page error surface
 * to the B1 diagnostic alone: a clean fail-closed surface cannot pass while
 * the pre-existing GAP-2 error is there, and the row must not be weakened into
 * tolerating it.
 */
test('Q1-B/B1: an externally cleared activated root fails closed instead of restarting fresh', async ({
  page,
}) => {
  // The fail-closed diagnostic reaches the page as a page error or as the
  // framework's console channel depending on the engine; either proves it was
  // raised, and the assertions below keep checking it is that diagnostic.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });

  await page.goto('/combobox', { waitUntil: 'load' });
  await defineEveryIsland(page);
  await waitForPageClaim(page, 'combobox-page');

  const cleared = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    if (!host) return null;
    const parent = host.parentNode as ParentNode;
    host.remove();
    while (host.firstChild) host.removeChild(host.firstChild);
    parent.appendChild(host); // reconnect the emptied, already-activated root
    return { childrenAfterClear: host.childNodes.length };
  });
  expect(cleared, 'the fixture must expose the light island').not.toBeNull();

  // Bounded observation for the generated fail-closed identity: the connect
  // reaction runs at the end of the task the reconnect happened in.
  const deadline = Date.now() + 3_000;
  while (
    Date.now() < deadline &&
    !errors.some((line) => line.includes('OEIR_LEAF_CLAIM_MISMATCH: missing node at /0'))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const state = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    return {
      children: host?.childNodes.length ?? -1,
      styleNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      // The program's own content: a fresh fallback rebuilds it; a fail-closed
      // resume leaves the cleared root alone.
      programContent: host?.querySelector('input[data-part], form, ul, [data-part]') !== null,
    };
  });

  const failClosed = errors.filter((line) =>
    line.includes('OEIR_LEAF_CLAIM_MISMATCH: missing node at /0'),
  );
  expect(
    failClosed.length,
    `a cleared activated root must fail closed with the generated identity ` +
      `(page errors: ${errors.join(' | ') || '(none)'})`,
  ).toBe(1);
  expect(
    state.programContent,
    `the cleared root must not be silently rebuilt as a fresh activation ` +
      `(children=${state.children}, program content present=${state.programContent})`,
  ).toBe(false);
  expect(state.children, 'the fail-closed resume leaves the cleared root empty').toBe(0);
  expect(state.styleNodes, 'a failed connect must not leave a style node behind').toEqual(0);

  // A clean fail-closed surface: the page surfaced the B1 diagnostic and
  // nothing else. This is the assertion GAP-2 currently blocks (see header).
  expect(
    errors,
    `the fail-closed reconnect must be the ONLY page diagnostic ` +
      `(page errors: ${errors.join(' | ') || '(none)'})`,
  ).toEqual(failClosed);
});
