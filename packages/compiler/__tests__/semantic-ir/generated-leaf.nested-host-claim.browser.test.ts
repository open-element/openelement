/**
 * alpha16 nested-expansion — the CLAIM half of a nested custom-element host.
 *
 * The SSR slice routes every dash tag through `nestedHost`, and the render's
 * expander replaces the literal bytes with the child's real markup. For a
 * LIGHT-root generated child that expansion is:
 *
 *   <x-child marker="…" data-oe-light><p …><!--oe:t:0-->…<!--oe:/t:0--></p></x-child>
 *
 * i.e. the child's content is written as the host's CHILDREN and the host tag
 * carries the server's light-root ownership marker. The parent component's
 * generated claim walks its own template, met that element, and failed every
 * load with:
 *
 *   OEIR_LEAF_CLAIM_MISMATCH: static attribute seed count is 1, declared 0 at
 *   /0/0 (authored …)
 *
 * This suite is the regression witness for that defect and for the two halves
 * of the fix, which live in the ONE runtime rule module (`claim-invariants.ts`)
 * and are emitted by the generated-leaf claim compiler:
 *
 *   1. a nested host's seed excludes the runtime-managed host attributes (the
 *      light-root ownership marker, the theme broadcaster's mirror, the child's
 *      JSON prop seed — the ONE `GENERATED_RUNTIME_ONLY_ATTRIBUTES` fact the
 *      compiled hydration executor already consumes);
 *   2. a childless nested host whose live tag carries the marker owns its light
 *      interior, so the parent consumes it OPAQUELY instead of walking it (the
 *      child's own claim consumes it);
 *
 * Strictness is preserved and pinned here: a genuinely wrong authored seed, an
 * extra NON-runtime attribute on the host, runtime-only names on a plain
 * element, and a foreign child inside a NON-expanded host all keep failing
 * closed with the same coded identity. The claim must never be silenced into
 * accepting whatever markup it finds.
 *
 * The bytes exercised are the emitted `<Name>__ssr` producer's own output with
 * a render-supplied expander (the same call shape the shell/host record uses);
 * the claim runs against a real browser-parsed DOM. LOCAL Chromium only.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Browser, chromium } from 'playwright';
import {
  buildRuntimeBundle,
  compileFixture,
  openGeneratedPage,
  type RuntimeBundle,
  ssr,
} from './testlib/m08-browser-harness.ts';

const FILE = '/proj/src/nested-host-claim.tsx';

/**
 * Two components: `Page` carries only the dynamic `marker` slot on the nested
 * host; `Hosted` also declares a STATIC `class`, so the seed-strictness rows
 * can prove an authored static value is still checked.
 */
const SOURCE = `function Page(props) {
  return <main id="wrap"><x-child marker={props.marker}></x-child></main>;
}
function Hosted(props) {
  return <main id="wrap"><x-child class="a" marker={props.marker}></x-child></main>;
}
`;

/** What a light-root child's expansion puts inside the host (real wire shape). */
const ISLAND_HTML = '<p id="island-content"><!--oe:t:0-->content element: first<!--oe:/t:0--></p>';
/** The server's light-root ownership marker (protocol DATA_OE_LIGHT). */
const LIGHT_MARKER = 'data-oe-light';

interface ExpandRequest {
  readonly open: string;
  readonly fallback: string;
}

/**
 * The render's nested-host expander for a light-root child: keep the emitted
 * open tag, append the ownership marker, and write the child's content as the
 * host's children. This is exactly `serializeGeneratedElementHtml`'s light-root
 * shape for the child (authored attributes first, the marker last).
 */
function expandLight(request: ExpandRequest, extraAttributes = ''): string {
  return `${request.open.replace(/>$/, `${extraAttributes} ${LIGHT_MARKER}>`)}${ISLAND_HTML}</x-child>`;
}

interface PageScope {
  dispose(detachOwnedNodes?: boolean): void;
}

interface PageSignal<T> {
  value: T;
  subscribe(fn: (value: T) => void): () => void;
}

interface PageRuntime {
  claimRecipe(owner: PageScope, recipe: unknown, parent: Node): { nodes: readonly Node[] };
  readonly LifetimeScope: new () => PageScope;
  readonly signal: <T>(value: T) => PageSignal<T>;
}

interface PageModule {
  [name: string]: ((owner: PageScope, host: unknown) => unknown) | undefined;
}

interface PageGlobals {
  readonly __oeRuntime: PageRuntime;
  readonly __oeModule: PageModule;
}

interface ClaimRun {
  readonly ok: boolean;
  readonly message: string | null;
  readonly code: string | null;
  /** The node the claim adopted (only on success), compared with the DOM. */
  readonly adoptedMain: boolean;
  /** The nested host's marker attribute AFTER the claim's dynamic write. */
  readonly marker: string | null;
  readonly lightMarkerKept: boolean;
  /** Same-node facts: the claim must not replace or move the interior. */
  readonly interiorKept: boolean;
  readonly mainKept: boolean;
}

const FIXTURE = compileFixture(SOURCE, FILE);

let bundle: RuntimeBundle;
let browser: Browser;

beforeAll(async () => {
  bundle = await buildRuntimeBundle();
  browser = await chromium.launch();
  console.log(`[nested-host-claim] engine=chromium version=${browser.version()} LOCAL`);
}, 180_000);

afterAll(async () => {
  await browser?.close();
  bundle?.dispose();
});

/**
 * Render one component through the emitted SSR producer with a render-supplied
 * nested-host expander, returning the bytes the browser should parse.
 */
function render(
  component: string,
  props: Record<string, unknown>,
  expand: (request: ExpandRequest) => string | undefined,
): string {
  const hostRecord = { __oe_nestedHost: (request: ExpandRequest) => expand(request) };
  return ssr(FIXTURE.loaded, component)(props, hostRecord as never);
}

/**
 * Claim the rendered markup in Chromium and return the coded outcome plus the
 * same-node facts. The claim's dynamic slot is driven with `props.marker`'s
 * value, so a successful claim must write it onto the nested host.
 */
async function claimRun(
  component: string,
  serverHtml: string,
  props: Record<string, unknown>,
  /** Optional DOM mutation applied between parse and claim. */
  mutate?: 'inject-foreign-child',
): Promise<ClaimRun> {
  const page = await openGeneratedPage(browser, bundle, FIXTURE);
  try {
    return (await page.evaluate(
      ({ serverHtml: html, componentName, liveProps, mutation }) => {
        const globals = window as unknown as PageGlobals;
        const runtime = globals.__oeRuntime;
        const factories = globals.__oeModule;

        document.body.innerHTML = '<div id="host"></div>';
        const host = document.getElementById('host') as HTMLElement;
        host.innerHTML = html;

        const main = host.firstChild as HTMLElement;
        const nested = main.querySelector('x-child') as HTMLElement | null;
        if (nested === null) throw new Error('the rendered nested host is missing');
        const interior = nested.firstChild;
        if (mutation === 'inject-foreign-child') {
          nested.appendChild(document.createElement('span'));
        }

        const createRecipe = factories[`create${componentName}Recipe`];
        if (createRecipe === undefined) throw new Error(`missing create${componentName}Recipe`);
        const scope = new runtime.LifetimeScope();
        const recipe = createRecipe(scope, {
          props: liveProps,
          bindings: {},
          propsChanged: runtime.signal(0),
        });

        let ok = true;
        let message: string | null = null;
        let code: string | null = null;
        let adoptedMain = false;
        try {
          const projection = runtime.claimRecipe(scope, recipe, host);
          adoptedMain = projection.nodes.length === 1 && projection.nodes[0] === main;
        } catch (caught) {
          ok = false;
          const error = caught as Error & { readonly code?: unknown };
          message = error.message;
          code = typeof error.code === 'string' ? error.code : null;
        }
        return {
          ok,
          message,
          code,
          adoptedMain,
          marker: nested.getAttribute('marker'),
          lightMarkerKept: nested.hasAttribute('data-oe-light'),
          interiorKept: interior !== null && nested.firstChild === interior,
          mainKept: host.firstChild === main,
        };
      },
      {
        serverHtml,
        componentName: component,
        liveProps: props,
        mutation: mutate,
      },
    )) as ClaimRun;
  } finally {
    await page.close();
  }
}

describe('nested custom-element host claim (Chromium LOCAL)', () => {
  test('an expanded LIGHT-root child claims: marker seed exempt, interior opaque, dynamic slot written', async () => {
    // RED before the fix: this is the /decoupled defect verbatim — the live tag
    // is [marker, data-oe-light], the declared seed is 0, and the parent claim
    // reported `static attribute seed count is 1, declared 0 at /0/0`.
    const html = render('Page', { marker: 'content element: first' }, (request) =>
      expandLight(request),
    );
    const result = await claimRun('Page', html, { marker: 'content element: after' });

    expect(result.ok, `the expanded nested host must claim (${String(result.message)})`).toBe(true);
    expect(result.adoptedMain).toBe(true);
    // The child's light region is OPAQUE to the parent: nothing replaced,
    // removed or reordered. (The child element's own claim consumes it.)
    expect(result.interiorKept).toBe(true);
    expect(result.mainKept).toBe(true);
    // The server ownership marker is not removed by the parent claim.
    expect(result.lightMarkerKept).toBe(true);
    // The authored DYNAMIC slot still flows through the claim's write phase.
    expect(result.marker).toBe('content element: after');
  });

  test('the child runtime attributes (light marker + theme mirror) are exempt from the host seed', async () => {
    // Class-lane parity (C-1): the theme broadcaster writes `data-theme` on a
    // host at ITS OWN connect, which under chunked island loading can precede
    // the parent's upgrade. Both runtime-managed names are not the parent's
    // seed; anything else on the host still is.
    const html = render('Page', { marker: 'content element: first' }, (request) =>
      expandLight(request, ' data-theme="dark"'),
    );
    const result = await claimRun('Page', html, { marker: 'content element: first' });
    expect(
      result.ok,
      `runtime-only host attributes must not drift (${String(result.message)})`,
    ).toBe(true);
    expect(result.adoptedMain).toBe(true);
    expect(result.interiorKept).toBe(true);
  });

  test('an extra NON-runtime attribute on the nested host still fails closed', async () => {
    // The exemption is a closed set, not "any extra attribute on a dash tag".
    const html = render('Page', { marker: 'content element: first' }, (request) => {
      const expanded = expandLight(request);
      return expanded.replace(` ${LIGHT_MARKER}>`, ` data-extra="1" ${LIGHT_MARKER}>`);
    });
    const result = await claimRun('Page', html, { marker: 'content element: first' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.message).toContain('static attribute seed count is 1, declared 0 at /0/0');
  });

  test('a wrongly rendered authored STATIC attribute on the host still fails closed', async () => {
    // Runtime-only names are exempted; an authored static row keeps the exact
    // value check, so the fix cannot be "skip the whole seed for dash tags".
    const html = render('Hosted', { marker: 'content element: first' }, (request) =>
      expandLight(request).replace('class="a"', 'class="b"'),
    );
    const result = await claimRun('Hosted', html, { marker: 'content element: first' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.message).toContain('static attribute class has value "b", declared "a" at /0/0');
  });

  test('a foreign child inside a NON-expanded nested host is still drift', async () => {
    // No light-root marker means the host owns no light region, so the strict
    // empty-child rule is unchanged: only the MARKED expanded interior is
    // opaque.
    const html = render('Page', { marker: 'content element: first' }, () => undefined);
    const result = await claimRun(
      'Page',
      html,
      { marker: 'content element: first' },
      'inject-foreign-child',
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    expect(result.message).toContain('extra node at /0/0');
  });

  test('runtime-only names on a PLAIN element ancestor are still drift', async () => {
    // The exemption is scoped to a custom-element host: the same name on an
    // intrinsic element stays genuine server drift.
    const html = render('Page', { marker: 'content element: first' }, (request) =>
      expandLight(request),
    );
    const page = await openGeneratedPage(browser, bundle, FIXTURE);
    try {
      const result = (await page.evaluate(
        ({ serverHtml }) => {
          const globals = window as unknown as PageGlobals;
          document.body.innerHTML = '<div id="host"></div>';
          const host = document.getElementById('host') as HTMLElement;
          host.innerHTML = serverHtml;
          const main = host.firstChild as HTMLElement;
          main.setAttribute('data-oe-light', '');
          const createRecipe = globals.__oeModule.createPageRecipe;
          if (createRecipe === undefined) throw new Error('missing createPageRecipe');
          const scope = new globals.__oeRuntime.LifetimeScope();
          const recipe = createRecipe(scope, {
            props: { marker: 'content element: first' },
            bindings: {},
            propsChanged: globals.__oeRuntime.signal(0),
          });
          try {
            globals.__oeRuntime.claimRecipe(scope, recipe, host);
            return { ok: true, message: null as string | null };
          } catch (caught) {
            return { ok: false, message: (caught as Error).message };
          }
        },
        { serverHtml: html },
      )) as { ok: boolean; message: string | null };
      expect(result.ok).toBe(false);
      expect(result.message).toContain('static attribute seed count is 2, declared 1 at /0');
    } finally {
      await page.close();
    }
  });
});
