/** @jsxImportSource @openelement/element */
/** Client activation entry AND the compiled component for the WWW page rail. */
import { onConnect, onDispose } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { readingChromeStrings } from '../site-ui/chrome-strings.ts';
import {
  installRailScrollspy,
  uninstallRailScrollspy,
} from '../site-ui/open-page-rail-controller.ts';

export default function OpenPageRail(props: {
  // Declared rows (sidecar below): the D-18c seed channel supplies the SSR
  // outline array, `locale` rides its reflected attribute.
  items: { id: string; href: string; label: string; depth: string }[];
  locale: string;
}) {
  // Rules moved to the linked document stylesheet (www/site-chrome.css).
  const locale = props.locale;
  const items = Array.isArray(props.items) ? props.items : [];

  // Read once at the top of the function body: the compiled lane rejects call
  // expressions inside JSX attribute and child positions (OEC9043).
  const strings = readingChromeStrings(locale);
  const onThisPage = strings.onThisPage;
  const overview = strings.overview;

  onConnect((env) => installRailScrollspy(env.host));
  onDispose((env) => uninstallRailScrollspy(env.host));

  return (
    <div data-pagefind-ignore>
      <div class='hidden min-[901px]:block'>
        <nav class='grid gap-1 [counter-reset:rail-item]' aria-label={onThisPage}>
          <a
            class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
            href='#start'
          >
            {overview}
          </a>
          {items.map((item) => (
            <a
              key={item.id}
              class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
              href={item.href}
              data-depth={item.depth}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
      <details class='block min-[901px]:hidden'>
        <summary class='cursor-pointer rounded-lg border border-border bg-(--surface-1) px-4 py-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.12em] text-foreground uppercase'>
          {onThisPage}
        </summary>
        <nav class='grid gap-1 pt-3 [counter-reset:rail-item]' aria-label={onThisPage}>
          <a
            class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
            href='#start'
          >
            {overview}
          </a>
          {items.map((item) => (
            <a
              key={item.id}
              class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
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

export const openElement = defineIslandConfig({
  tag: 'open-page-rail',
  // LIGHT, as the class lane compiled it: www/site-chrome.css selects the
  // rail's markup in the document tree, so a shadow root would put the
  // selectors out of reach.
  root: 'light',
  hydrate: 'idle',
  ssr: true,
  properties: {
    locale: { reflect: true, attribute: 'locale', default: 'en' },
    // The SSG shell passes the outline as a JSON attribute; the D-18c seed
    // channel (ADR-0182) carries the array server-to-client so the
    // server-rendered rows survive the claim (open-search's `hits` shape).
    items: { attribute: false, default: [] },
  },
});
