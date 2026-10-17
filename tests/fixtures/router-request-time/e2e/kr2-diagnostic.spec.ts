/**
 * KR-2 stage isolation: the island-load race on WebKit.
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
 * awaits its style asset at module scope. The generated adapter creates the
 * sheet synchronously and records fetch/replace readiness ON the sheet
 * (`STYLE_SHEET_READY`), so registration cannot sit behind the style fetch —
 * the KR-2 failure mode the alpha15 S lane removed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';

/** Every island the /combobox page activates on load. */
const ISLAND_TAGS = ['decoupled-view', 'live-counter', 'zag-combobox-light', 'zag-combobox'];

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
 * The entry chunks' post-fix static shape: registration is decoupled from style
 * readiness. The generated adapter creates its `CSSStyleSheet` synchronously
 * and records fetch/replace readiness ON the sheet under
 * `STYLE_SHEET_READY`; nothing at module scope may `await fetch(...)` the style
 * asset, because such a module would make the island's definition wait on the
 * network again — exactly the KR-2 failure mode the alpha15 S lane removed.
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

interface StyleDeliveryState {
  /** Marked links the DOCUMENT itself declares (document-level sheets only). */
  documentLinks: number;
  /** Marked links declared in the shadow tree that owns the light island. */
  shadowLinks: Array<{ href: string | null; loaded: boolean }>;
  /** True when the light host's FIRST child is its marked delivery link. */
  lightLeadingLink: boolean;
  /** Runtime-written style nodes anywhere in the document. */
  runtimeNodes: number;
  /** Inline framework stylesheets (`<style data-oe-static-styles>`). */
  inlineFallbacks: number;
  /** The pre-S5-C inline fallback a host's shadow root used to start with. */
  shadowFallbackStyle: boolean;
}

/**
 * Read the page's style-delivery state from the two trees that matter. The
 * /combobox light island (`zag-combobox-light`) is a LIGHT-root component
 * nested inside `combobox-page`'s DSD template, so its sheet is declared as a
 * marked `<link>` INSIDE that template — a document-level sheet cannot reach
 * shadow-tree content, so the document head carries none of these links
 * (alpha15 S lane S-C1.2, nested-delivery half). The link is the light host's
 * LEADING node: the compiled claim tolerates only leading marked style nodes,
 * so a trailing link would cost the island its activation.
 */
function styleDelivery(page: Page): Promise<StyleDeliveryState> {
  return page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const light = frame?.querySelector('zag-combobox-light');
    const links = [...(frame?.querySelectorAll('link[data-oe-static-styles]') ?? [])];
    const first = light?.firstChild;
    const shadowHost = frame?.querySelector('zag-combobox[machine-id="shadow-a"]');
    const shadowFirst = shadowHost?.shadowRoot?.firstChild;
    const markedStyle = (node: ChildNode | null | undefined): node is Element =>
      !!node &&
      node.nodeType === 1 &&
      (node as Element).tagName.toLowerCase() === 'style' &&
      (node as Element).hasAttribute('data-oe-static-styles');
    return {
      documentLinks: document.querySelectorAll('link[data-oe-static-styles]').length,
      shadowLinks: links.map((link) => ({
        href: link.getAttribute('href'),
        loaded: (link as HTMLLinkElement).sheet !== null,
      })),
      lightLeadingLink:
        !!first &&
        first.nodeType === 1 &&
        (first as Element).tagName.toLowerCase() === 'link' &&
        (first as Element).hasAttribute('data-oe-static-styles'),
      runtimeNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      inlineFallbacks: document.querySelectorAll('style[data-oe-static-styles]').length,
      shadowFallbackStyle: markedStyle(shadowFirst),
    };
  });
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
 * Post-fix contract for the external style delivery, on the real module graph.
 * The style ADAPTER fetch is held open, so every island must define while it is
 * still pending — and the delivery itself is the server's marked `<link>`,
 * parser-visible from the first paint, so it loads independently of the held
 * adapter and there is no inline fallback to retire:
 *
 *   shadow — the marked link is the shadow root's LEADING node; the claim skips
 *            leading style nodes and KEEPS the link as the delivery;
 *   light  — the component's sheet is a resource of the TREE its content lands
 *            in (S-C1.2): the nested light island sits inside the page's
 *            shadow root, so the link is declared in that template as the light
 *            host's leading node — never in the document head;
 *   both   — the runtime writes no style node at any point.
 *
 * Holding the parser-visible stylesheet request instead would stall the
 * navigation (a stylesheet request delays the deferred island script, and with
 * it the load event), so this test holds exactly the adapter's own `fetch` —
 * the asset request the post-fix handoff is about.
 */
test('KR-2 post-fix: a held style adapter still defines every island; the external link is the delivery', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let adapterHeld = false;
  await page.route('**/*.css', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      adapterHeld = true;
      await held;
    }
    await route.continue();
  });

  await page.goto('/combobox', { waitUntil: 'load' });
  // The gate must pass while the adapter fetch is still held: registration no
  // longer waits for the style asset.
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );
  expect(adapterHeld, 'the test must actually hold the adapter fetch').toBe(true);

  const during = await styleDelivery(page);
  expect(
    during.documentLinks,
    'a sheet of a shadow-tree light root is not a document-head link',
  ).toEqual(0);
  expect(
    during.shadowLinks.length,
    'the enclosing shadow tree declares the light sheet as a marked link',
  ).toBeGreaterThan(0);
  expect(
    during.shadowLinks.every((link) => link.loaded),
    `the parser-visible delivery loads independently of the held adapter (${JSON.stringify(
      during.shadowLinks,
    )})`,
  ).toBe(true);
  expect(
    during.lightLeadingLink,
    'the light host keeps its leading marked link (the claim skips leading style nodes)',
  ).toBe(true);
  expect(during.inlineFallbacks, 'externalised sheets carry no inline DSD fallback').toEqual(0);
  expect(during.shadowFallbackStyle, 'no inline fallback survives in a shadow root').toBe(false);
  expect(
    during.runtimeNodes,
    'no island injects a runtime style node while the adapter is held',
  ).toEqual(0);

  release();
  // Bounded settle on the one signal that the held fetch + replace completed:
  // the adapter's own readiness promise on the sheet object. The delivery must
  // not change while it settles.
  await page.evaluate(async () => {
    const ctor = customElements.get('zag-combobox-light') as unknown as {
      styles?: Array<{ __openElementStyleReady?: Promise<unknown> }>;
    };
    const ready = ctor?.styles?.[0]?.__openElementStyleReady;
    if (ready) await ready;
  });
  const settled = await styleDelivery(page);
  expect(settled.documentLinks, 'the document never gains the nested light sheet link').toEqual(0);
  expect(
    settled.shadowLinks.map((link) => link.href),
    'the declarative delivery is not rewritten by the runtime',
  ).toEqual(during.shadowLinks.map((link) => link.href));
  expect(settled.lightLeadingLink, 'the leading delivery link is not replaced').toBe(true);
  expect(
    settled.runtimeNodes,
    'the light island injects no style node once its adapter has settled',
  ).toEqual(0);
  expect(settled.inlineFallbacks, 'no inline fallback is ever written').toEqual(0);
  expect(settled.shadowFallbackStyle, 'the pre-S5-C shadow fallback is gone').toBe(false);
});

/**
 * Q1-A: a disconnect before the style ADAPTER settles must leave no late style
 * write. The light island is removed while its adapter fetch is still held, and
 * the release must not touch the DOM on behalf of the dropped connection — with
 * S-C1.2 there is no runtime write channel at all: the delivery is the
 * server's declared `<link>` (declarative, removed with its host), so the probe
 * is that the document gains no framework style node and no error surfaces.
 *
 * The held request is the adapter's own `fetch`, not the parser-visible
 * stylesheet request: holding a `<link>` request blocks the deferred island
 * script (and with it DOMContentLoaded), which stalls the navigation instead of
 * exercising the handoff.
 */
test('Q1-A: a disconnect before the sheet adapter settles leaves no late style write', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let adapterHeld = false;
  await page.route('**/*.css', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      adapterHeld = true;
      await held;
    }
    await route.continue();
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/combobox', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );
  expect(adapterHeld, 'the test must actually hold the adapter fetch').toBe(true);

  const removed = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light');
    const parent = host?.parentNode ?? null;
    host?.remove();
    return { hadHost: host !== null, hadParent: parent !== null };
  });
  expect(removed, 'the fixture must expose the light island to disconnect it').toEqual({
    hadHost: true,
    hadParent: true,
  });

  release();
  const after = await page.evaluate(async () => {
    // Bounded settle on the adapter's own readiness: releasing the request must
    // be the only thing that happens — no DOM is written for a dropped root.
    const ctor = customElements.get('zag-combobox-light') as unknown as {
      styles?: Array<{ __openElementStyleReady?: Promise<unknown> }>;
    };
    const ready = ctor?.styles?.[0]?.__openElementStyleReady;
    if (ready) {
      await Promise.race([
        ready,
        new Promise((resolve) => {
          setTimeout(resolve, 5_000);
        }),
      ]);
    }
    return {
      nodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      documentLinks: document.querySelectorAll('link[data-oe-static-styles]').length,
      stillConnected:
        document.querySelector('combobox-page')?.shadowRoot?.querySelector('zag-combobox-light') !==
        null,
    };
  });

  expect(after.stillConnected, 'the light island stays disconnected').toBe(false);
  expect(after.documentLinks, 'the disconnected island declares nothing at document level').toEqual(
    0,
  );
  expect(
    after.nodes,
    'the released sheet wrote nothing on behalf of the disconnected island',
  ).toEqual(0);
  expect(pageErrors, `no error may surface across the release (${pageErrors.join(' | ')})`).toEqual(
    [],
  );
});

/**
 * Q1-B (positive regression): a reconnected light island resumes — styles,
 * bindings, dynamic content and state — instead of being treated as an
 * un-hydrated component. The reconnect must not re-claim the component's own
 * runtime DOM (that fails closed on legitimate runtime drift and tears the
 * activation down) and must not rebuild it either.
 *
 * The island is driven through real runtime changes before the move (its block
 * structure opens, its state changes), then moved in the same task, and finally
 * driven again — the second round is what proves the resumed bindings, not just
 * a restored stylesheet. Styles are compared as COMPUTED VALUES across the move
 * (S-C1.2: the delivery may be the server-declared link or the adopted sheet,
 * and either way it is not a node).
 */
test('Q1-B: a moved light island resumes styles, bindings and dynamic state', async ({ page }) => {
  const consoleLines: string[] = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

  await page.goto('/combobox', { waitUntil: 'load' });
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );

  // First round of real runtime change: open the list (a dynamic block range
  // moves into the DOM) and let the machine write its state.
  const input = page.locator('zag-combobox-light input[data-part="input"]');
  await input.click();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'combobox:light-fruit:option:apple');
  await input.fill('typed-before-move');

  const before = await styleDelivery(page);
  expect(before.runtimeNodes, 'the island carries no runtime style node before the move').toEqual(
    0,
  );
  expect(before.documentLinks, 'the light sheet is never a document-head link').toEqual(0);
  expect(
    before.shadowLinks.length,
    'the enclosing tree declares the light sheet before the move',
  ).toBeGreaterThan(0);

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
    const frameLinks = [...(frame?.querySelectorAll('link[data-oe-static-styles]') ?? [])];
    const first = host?.firstChild;
    return {
      identity: (globalThis as { __q1bIdentity?: unknown }).__q1bIdentity === host,
      runtimeNodes: document.querySelectorAll('style[data-open-element-compiled-style]').length,
      frameLinks: frameLinks.map((link) => link.getAttribute('href')),
      lightLeadingLink:
        !!first &&
        first.nodeType === 1 &&
        (first as Element).tagName.toLowerCase() === 'link' &&
        (first as Element).hasAttribute('data-oe-static-styles'),
      value: liveInput?.value ?? 'missing',
    };
  });
  expect(state.identity, 'the reconnected island is the same element instance').toBe(true);
  expect(state.runtimeNodes, 'the resumed island injects no style node').toEqual(0);
  expect(
    state.frameLinks,
    "the sheet resource is still declared after the move (the delivery is the enclosing tree's declared link)",
  ).toEqual(before.shadowLinks.map((link) => link.href));
  expect(
    state.lightLeadingLink,
    "the delivery link stays the light host's leading node across the move",
  ).toBe(true);
  expect(state.value, 'runtime state survives the move').toEqual('typed-before-move');

  // Second round of real runtime change after the resume: the resumed bindings
  // must drive the DOM again.
  await page.keyboard.press('Escape');
  await input.click();
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'combobox:light-fruit:option:apple');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Apple');

  expect(
    consoleLines.filter((line) => line.startsWith('pageerror:')),
    `no error may surface across the resume (${consoleLines.slice(-4).join(' | ')})`,
  ).toEqual([]);
});

/**
 * Q1-C: two light instances share the sheet. One disconnecting must not break
 * the other; the last owner disconnecting must clean up. The node count is
 * reported either way so the sharing model is visible in the log.
 */
test('Q1-C: one light instance disconnecting leaves the other styled', async ({ page }) => {
  await page.goto('/combobox', { waitUntil: 'load' });
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );

  const observed = await page.evaluate(async () => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const first = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    if (!frame || !first) return null;
    const second = document.createElement('zag-combobox-light');
    second.setAttribute('machine-id', 'second-instance');
    frame.appendChild(second);
    // Same sheet object: the class owns one static styles list.
    const sharedSheet = customElements.get('zag-combobox-light') as unknown as {
      styles?: readonly unknown[];
    };
    await new Promise((resolve) => setTimeout(resolve, 200));
    const nodesBefore = document.querySelectorAll('style[data-open-element-compiled-style]').length;
    // The delivery link lives in the enclosing shadow tree (S-C1.2 nested
    // half), so the shared-state queries must read THAT tree — a document-level
    // count would be zero on both sides and pin nothing.
    const linksBefore = frame.querySelectorAll('link[data-oe-static-styles]').length;
    second.remove();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const nodesAfterRemoval = document.querySelectorAll(
      'style[data-open-element-compiled-style]',
    ).length;
    const linksAfterRemoval = frame.querySelectorAll('link[data-oe-static-styles]').length;
    first.remove();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      nodesBefore,
      nodesAfterRemoval,
      linksBefore,
      linksAfterRemoval,
      nodesAfterLastDisconnect: document.querySelectorAll('style[data-open-element-compiled-style]')
        .length,
      sharedSheetCount: sharedSheet?.styles?.length ?? -1,
    };
  });

  expect(observed, 'the fixture must expose the light island').not.toBeNull();
  expect(
    observed!.linksBefore,
    'the enclosing tree declares the shared delivery link',
  ).toBeGreaterThan(0);
  expect(
    observed!.nodesAfterRemoval,
    `disconnecting one instance writes and removes no node (nodes before=${observed!.nodesBefore})`,
  ).toEqual(0);
  expect(
    observed!.linksAfterRemoval,
    `the shared delivery survives one instance leaving (links before=${observed!.linksBefore})`,
  ).toEqual(observed!.linksBefore);
  expect(
    observed!.nodesAfterLastDisconnect,
    `cleanup must leave no owned node (sheet slots: ${observed!.sharedSheetCount})`,
  ).toEqual(0);
});

/**
 * Q1-D (P0-A, real-engine resume reconciliation): a signal written while the
 * island is disconnected reaches no subscription, so the resume must reconcile
 * the runtime's own DOM to the current value instead of re-verifying it as an
 * SSR artifact (which failed closed with `part text drift`) and instead of
 * leaving the stale value in place. `<decoupled-view>` renders a text Part
 * bound to its `marker` property, so the text node itself carries the proof.
 *
 * The binding is driven before the move (live update), a value is written
 * while the element is detached, and the reconnected instance must show the
 * current value — then be driven again, so "bindings restored" is not claimed
 * from a static snapshot alone.
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
 * Q2: a stylesheet that never loads is not success. The islands still define,
 * the failure is reported through the framework's diagnostic (not a silent
 * console-less drop), the DECLARATIVE delivery survives (the marked links stay
 * in the markup; their failure means no rules, never a runtime rewrite), the
 * light owner's adapter is never read as ready, and no unhandled rejection
 * escapes.
 */
for (const mode of ['http-500', 'network-abort'] as const) {
  test(`Q2: a ${mode} stylesheet failure is diagnosed, never read as ready`, async ({ page }) => {
    const consoleLines: string[] = [];
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    await installRecorder(page);
    await page.route('**/*.css', async (route) => {
      if (mode === 'http-500') await route.fulfill({ status: 500, body: '' });
      else await route.abort('failed');
    });

    await page.goto('/combobox', { waitUntil: 'load' });
    // The constructor still becomes available: the failure is a style failure,
    // not a registration failure.
    await page.waitForFunction(
      (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
      ISLAND_TAGS,
      { timeout: GATE_TIMEOUT_MS },
    );

    // Bounded wait for the diagnostic; the scope reports it once it observes
    // the rejected readiness.
    const deadline = Date.now() + 10_000;
    while (
      Date.now() < deadline &&
      !consoleLines.some((line) => line.includes('OE_STYLES_SHEET_LOAD_FAILED'))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const state = await page.evaluate(() => {
      const frame = document.querySelector('combobox-page')?.shadowRoot;
      const host = frame?.querySelector('zag-combobox[machine-id="shadow-a"]');
      const first = host?.shadowRoot?.firstChild;
      return {
        // The delivered shape is a marked LINK (the manifest reference), not
        // the retired inline `<style data-oe-static-styles>` fallback. Both
        // carry the same marker attribute, so tag identity is what separates
        // them — a plain marker check would call the delivery a fallback.
        fallbackStyle:
          !!first &&
          first.nodeType === 1 &&
          (first as Element).tagName.toLowerCase() === 'style' &&
          (first as Element).hasAttribute('data-oe-static-styles'),
        deliveryLinks: [...(frame?.querySelectorAll('link[data-oe-static-styles]') ?? [])].map(
          (link) => link.getAttribute('href'),
        ),
        documentLinks: document.querySelectorAll('link[data-oe-static-styles]').length,
        headText:
          document.querySelector('style[data-open-element-compiled-style]')?.textContent ?? null,
        unhandled: (globalThis as unknown as { __kr2: { rejects: unknown[]; errors: unknown[] } })
          .__kr2,
      };
    });

    const diagnostic = consoleLines.find((line) => line.includes('OE_STYLES_SHEET_LOAD_FAILED'));
    expect(
      diagnostic,
      `no diagnostic was reported (console: ${consoleLines.slice(-4).join(' | ')})`,
    ).toBeTruthy();
    expect(diagnostic, 'the diagnostic names the failing sheet').toContain('style sheet');
    expect(
      (state.unhandled.rejects as unknown[]).length,
      'a style failure must not surface as an unhandled rejection',
    ).toEqual(0);
    expect((state.unhandled.errors as unknown[]).length, 'no uncaught page error').toEqual(0);
    expect(
      state.fallbackStyle,
      'the delivered shape is the declarative link, not the retired inline fallback',
    ).toBe(false);
    expect(
      state.deliveryLinks.length,
      'the declarative delivery links survive a failed sheet (markup is never rewritten)',
    ).toBeGreaterThan(0);
    expect(state.documentLinks, 'no failed sheet is declared at document level').toEqual(0);
    expect(
      state.headText?.includes('zag-combobox-input') ?? false,
      'a failed sheet must never be read as ready by the light owner',
    ).toBe(false);
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
 * Finding B1: an activated instance whose program-owned root content was
 * removed externally must not silently restart as a first CSR activation. The
 * reconnect resumes against the program's own DOM and fails closed with the
 * unresolved-node diagnostic; the root must not be rebuilt behind the caller's
 * back, and the failed connect must not leave a half-activated kernel.
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
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: GATE_TIMEOUT_MS },
  );

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

  // Bounded observation for the diagnostic: the connect reaction runs at the
  // end of the task the reconnect happened in.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && !errors.some((line) => line.includes('missing child'))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const state = await page.evaluate(() => {
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    const nodes = document.querySelectorAll('style[data-open-element-compiled-style]').length;
    return {
      children: host?.childNodes.length ?? -1,
      styleNodes: nodes,
      // The program's own content: a fresh fallback rebuilds it; a fail-closed
      // resume leaves the cleared root alone.
      programContent: host?.querySelector('input[data-part], form, ul, [data-part]') !== null,
    };
  });

  expect(
    errors.some((line) => line.includes('missing child')),
    `a cleared activated root must fail closed with the unresolved-node diagnostic ` +
      `(page errors: ${errors.join(' | ') || '(none)'})`,
  ).toBe(true);
  expect(
    state.programContent,
    `the cleared root must not be silently rebuilt as a fresh activation ` +
      `(children=${state.children}, program content present=${state.programContent})`,
  ).toBe(false);
  expect(state.styleNodes, 'a failed connect must not leave a style node behind').toEqual(0);
});
