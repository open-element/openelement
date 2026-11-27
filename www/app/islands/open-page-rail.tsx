/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW table of contents; browser state lives in open-page-rail-controller.ts. */

import { onConnect, onDispose } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { readingChromeStrings } from '../site-ui/chrome-strings.ts';
import {
  installRailScrollspy,
  uninstallRailScrollspy,
} from '../site-ui/open-page-rail-controller.ts';

/**
 * One rendered outline row, admitted to the props record.
 *
 * Declared HERE rather than imported: the generated lane proves a non-primitive
 * row's shape from a same-module type/interface alias (or an inline literal) and
 * refuses an imported element type (`OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED`),
 * because a shape it cannot read would be silently dropped from the property
 * channel. The members mirror what `open-article-view.tsx` writes through
 * `railItems`, which stays the single authority for the OUTLINE itself.
 */
interface RailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

export const openElement = defineIslandConfig({
  // The outline stays in the document tree, with real fragment links in SSR.
  root: 'light',
  hydrate: 'idle',
  ssr: true,
  // `items` is the rendered outline and takes the JSON seed channel (ADR-0182
  // D-18c), so the server-rendered rows survive the claim instead of the
  // instance reverting to the declared empty array. `locale` is a plain
  // attribute; it selects the chrome copy at SSR and on every later commit.
  properties: {
    items: { attribute: false, default: [] },
    locale: { default: 'en' },
  },
});

/**
 * The page outline: a desktop nav plus the mobile disclosure, both rendering the
 * same rows.
 *
 * The class lane's two `computed` rows become component-local `const` arrows:
 * the generated lane has no authoring `computed` (2026-11-18 ruling), and a
 * direct call to an app-local function in a tracked sink is refused with
 * `OEC9043 [OEIR_UNCLASSIFIED_BINDING]`, while a component-local const arrow IS
 * admitted and emits a bound refresh (compiled slot updates).
 *
 * Both branches link to the same section IDs and use the localized nav label.
 */
function OpenPageRail(props: { items: RailItem[]; locale: string }) {
  const railLabel = (locale: string) => readingChromeStrings(locale).onThisPage;
  const railOverview = (locale: string) => readingChromeStrings(locale).overview;

  onConnect((env) => {
    const host = env.host;
    // NOT safe to scan at connect. The mount/claim PROLOGUE replays this
    // callback BEFORE `claimRecipe`/`insertRecipe` runs (shell.ts
    // `connectedCallback`), so the host's generated region is not the rendered
    // tree yet. `railLinks(host)` reads `nav a[href^="#"]` out of that region,
    // and `installRailScrollspy` records its state BEFORE its empty-target early
    // return — so scanning an unmounted region would bind the host to zero links
    // permanently, not merely miss one pass. One macrotask lands the scan after
    // the synchronous connect pass, which is exactly when the class lane's
    // `connectedCallback` used to run.
    const timer = globalThis.setTimeout(() => installRailScrollspy(host), 0);
    env.signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        // The class lane's `disconnectedCallback` was this exact point: the
        // connection-scope signal aborts at the start of a disconnect, so a
        // reconnect re-scans the retained tree. `uninstallRailScrollspy` is
        // guarded by its own state map, so the dispose below is a no-op after
        // this already ran.
        uninstallRailScrollspy(host);
      },
      { once: true },
    );
  });
  onDispose((env) => {
    // Element teardown, the class lane's other release point: never leave the
    // observer (or a runtime-written `aria-current` mark) behind a disposed host.
    uninstallRailScrollspy(env.host);
  });

  return (
    <div data-pagefind-ignore>
      <div class='hidden min-[901px]:block'>
        <nav class='grid gap-1' aria-label={railLabel(props.locale)}>
          <a
            class='block py-1 pe-0 ps-3 text-muted-foreground text-sm leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground aria-[current=location]:text-foreground aria-[current=location]:font-semibold aria-[current=location]:border-s-primary'
            href='#start'
          >
            {railOverview(props.locale)}
          </a>
          {props.items.map((item) => (
            <a
              key={item.id}
              class='block py-1 pe-0 ps-3 text-muted-foreground text-sm leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-6 aria-[current=location]:text-foreground aria-[current=location]:font-semibold aria-[current=location]:border-s-primary'
              href={item.href}
              data-depth={item.depth}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
      <details class='block min-[901px]:hidden'>
        <summary
          id='page-outline'
          class='min-h-11 cursor-pointer scroll-mt-[calc(var(--nav-height)+1rem)] rounded-lg border border-border bg-(--surface-1) px-4 py-2 text-sm font-semibold text-foreground'
        >
          {railLabel(props.locale)}
        </summary>
        <nav class='grid gap-1 pt-3' aria-label={railLabel(props.locale)}>
          <a
            class='block py-1 pe-0 ps-3 text-muted-foreground text-sm leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground aria-[current=location]:text-foreground aria-[current=location]:font-semibold aria-[current=location]:border-s-primary'
            href='#start'
          >
            {railOverview(props.locale)}
          </a>
          {props.items.map((item) => (
            <a
              key={item.id}
              class='block py-1 pe-0 ps-3 text-muted-foreground text-sm leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-6 aria-[current=location]:text-foreground aria-[current=location]:font-semibold aria-[current=location]:border-s-primary'
              href={item.href}
              data-depth={item.depth}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </details>
    </div>
  );
}

export default OpenPageRail;
