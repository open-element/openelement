/** @jsxImportSource @openelement/element */
/** Private WWW long-form reading shell. */

import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import { formatFreshnessDate, readingChromeStrings } from './chrome-strings.ts';

type ReadingTag = { key: string; label: string };

/** One row of the reading shell's source-freshness meta line (no rows when absent). */
interface FreshnessRow {
  key: string;
  prefix: string;
  updated: string;
  label: string;
}

/**
 * READING SHELL — generated-element lane (2026-11-20 migration).
 *
 * Three facts of the migration are worth the reader's time:
 *
 * - `metadata`/`navigation` are `attribute: false` rows, and the lane admits a
 *   props member only when its type is a NON-GENERIC local mirror
 *   (`OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED` refuses an imported or
 *   `Record<string, unknown>` spelling), so both are mirrored locally below —
 *   the same shape `open-search`'s `hits` row needed.
 * - the 21 class `computed` fields are the lane's `computed` intrinsic: derived
 *   nodes the compiler creates in the retained setup factory (ADR-0183 D-4),
 *   read as `.value` at their sinks.
 * - the shared chrome copy is resolved ONCE in setup scope
 *   (`const chrome = readingChromeStrings(props.locale)`); the derived nodes
 *   capture it, and the retained factory emits that local in authored order
 *   (ADR-0183 D-4 ordering), so no derived node reads a binding declared after it.
 */

/** Local mirror of the `attribute: false` metadata row (the lane refuses imports). */
interface ReadingMetadata {
  breadcrumb: string;
  breadcrumbHref?: string;
  title: string;
  lede?: string;
  date?: string;
  updated?: string;
  version?: string;
  accent?: string;
  tags?: readonly string[];
}

/** Local mirror of the `attribute: false` navigation row. */
interface ReadingNavigation {
  previous?: { href: string; label: string };
  next?: { href: string; label: string };
}

export const openElement = defineIslandConfig({
  tag: 'open-reading-shell',
  properties: {
    rail: { reflect: true, default: false },
    footer: { reflect: true, default: false },
    meta: { reflect: true, default: false },
    metadata: { attribute: false, default: { breadcrumb: '', title: '' } },
    navigation: { attribute: false, default: {} },
    previous: { default: '' },
    next: { default: '' },
    previousLabel: { default: '' },
    nextLabel: { default: '' },
    locale: { default: 'en' },
  },
});

function OpenReadingShell(props: {
  rail: boolean;
  footer: boolean;
  meta: boolean;
  metadata: ReadingMetadata;
  navigation: ReadingNavigation;
  previous: string;
  next: string;
  previousLabel: string;
  nextLabel: string;
  locale: string;
}) {
  // The chrome copy depends only on the `locale` row: resolved once here and
  // captured by the derived nodes below (a module import read directly inside a
  // tracked slot is a host-unclassified binding, OEC9043).
  const chrome = readingChromeStrings(props.locale);

  const breadcrumb = computed(() => props.metadata?.breadcrumb ?? '');
  const breadcrumbHref = computed(() => props.metadata?.breadcrumbHref ?? '');
  // Block branches must be fully static (OEC9012), so both breadcrumb forms stay
  // in the tree and toggle through `hidden` like the pager links below.
  const hideBreadcrumbLink = computed(() => !props.metadata?.breadcrumbHref);
  const hideBreadcrumbText = computed(() => !!props.metadata?.breadcrumbHref);
  const breadcrumbLabel = computed(() => chrome.breadcrumb);
  const pageTitle = computed(() => props.metadata?.title ?? '');
  const accent = computed(() => props.metadata?.accent ?? '');
  const lede = computed(() => props.metadata?.lede ?? '');
  // Source-freshness meta row: version mark + machine-derived update date. The
  // row must not EXIST when there is nothing to show: the previous form rendered
  // it always and only toggled `hidden`, so non-article pages shipped a hidden
  // row with dangling "Applies to  · Updated " text and an empty `<time
  // datetime>`. Compiled branches cannot interpolate text (OEC9012), so the row
  // is a zero-or-one list — an empty list emits no element and no text.
  const freshnessRows = computed((): FreshnessRow[] =>
    props.metadata?.version && props.metadata?.updated
      ? [
          {
            key: 'freshness',
            prefix: `${chrome.appliesTo} ${props.metadata?.version ?? ''}${chrome.freshnessSeparator}${chrome.updated} `,
            updated: props.metadata?.updated ?? '',
            label: formatFreshnessDate(props.metadata?.updated ?? '', props.locale),
          },
        ]
      : [],
  );
  const date = computed(() => props.metadata?.date ?? '');
  const tags = computed((): ReadingTag[] =>
    (props.metadata?.tags ?? []).map((tag) => ({ key: tag, label: tag })),
  );
  const hideDetails = computed(() => !props.metadata?.date && !props.metadata?.tags?.length);
  const previousHref = computed(() => props.navigation?.previous?.href ?? props.previous);
  const nextHref = computed(() => props.navigation?.next?.href ?? props.next);
  const previousText = computed(() => props.navigation?.previous?.label ?? props.previousLabel);
  const nextText = computed(() => props.navigation?.next?.label ?? props.nextLabel);
  // No route sets the kicker props; fall back to the locale chrome copy so zh
  // pages never show an English Previous/Next.
  const previousKicker = computed(() => props.previousLabel || chrome.previous);
  const nextKicker = computed(() => props.nextLabel || chrome.next);
  const hidePrevious = computed(() => !(props.navigation?.previous?.href ?? props.previous));
  const hideNext = computed(() => !(props.navigation?.next?.href ?? props.next));
  const onThisPage = computed(() => chrome.onThisPage);
  const pageNavigationLabel = computed(() => chrome.pageNavigation);

  return (
    <div class='shell'>
      <article class='main'>
        <span class='reading-start' id='start' tabindex='-1'></span>
        <header class='meta'>
          <slot name='meta'>
            <div>
              <nav
                class='m-0 mb-4 flex flex-wrap items-baseline gap-2 font-mono text-(length:--text-xs) font-extrabold tracking-[0.1em] text-muted-foreground uppercase print:hidden!'
                aria-label={breadcrumbLabel.value}
              >
                <a
                  class='text-inherit no-underline hover:text-primary hover:underline'
                  href={breadcrumbHref.value}
                  hidden={hideBreadcrumbLink.value}
                >
                  {breadcrumb.value}
                </a>
                <span hidden={hideBreadcrumbText.value}>{breadcrumb.value}</span>
                <span aria-hidden='true'>{'/'}</span>
                <span class='text-primary' aria-current='page'>
                  {pageTitle.value}
                </span>
              </nav>
              <h1
                class='m-0 font-sans text-(length:--text-2xl) leading-[1.05] font-extrabold tracking-[-0.035em] break-words text-foreground text-balance min-[901px]:text-[clamp(2.1rem,4.6vw,3.4rem)]'
                data-pagefind-meta='title'
              >
                {pageTitle.value}
                <span class='block font-serif text-[calc(1em*1.08)] font-normal italic tracking-[-0.01em] text-primary'>
                  {accent.value}
                </span>
              </h1>
              <p class='mt-4 mb-0 leading-[1.65] text-muted-foreground min-[901px]:text-[clamp(var(--text-base),1.4vw,var(--text-xl))]'>
                {lede.value}
              </p>
              {freshnessRows.value.map((row) => (
                <p
                  key={row.key}
                  class='mt-3 mb-0 font-mono text-(length:--text-xs) text-muted-foreground'
                  data-pagefind-ignore
                >
                  <span>{row.prefix}</span>
                  <time datetime={row.updated}>{row.label}</time>
                </p>
              ))}
              <p
                class='mt-4 mb-0 flex flex-wrap gap-2 font-mono text-(length:--text-xs) text-muted-foreground'
                hidden={hideDetails.value}
                data-pagefind-ignore
              >
                <time>{date.value}</time>
                {tags.value.map((tag) => (
                  <span class='rounded-md border border-border px-2 py-1' key={tag.key}>
                    {tag.label}
                  </span>
                ))}
              </p>
            </div>
          </slot>
        </header>
        <aside class='rail print:hidden!' aria-label={onThisPage.value} data-pagefind-ignore>
          <p class='mt-0 mb-3 hidden font-mono text-(length:--text-xs) font-extrabold tracking-[0.14em] text-muted-foreground uppercase min-[901px]:block'>
            {onThisPage.value}
          </p>
          <slot name='rail'></slot>
        </aside>
        <div class='reading-body'>
          <slot></slot>
        </div>
        <footer class='footer mt-10 border-t border-border pt-5'>
          <slot name='footer'>
            <nav
              class='grid grid-cols-1 gap-4 min-[901px]:grid-cols-2 print:hidden!'
              aria-label={pageNavigationLabel.value}
              data-pager
            >
              <a
                class='block rounded-lg border border-border px-5 py-4 text-foreground no-underline hover:border-primary'
                href={previousHref.value}
                hidden={hidePrevious.value}
              >
                <span class='mb-1 block font-mono text-(length:--text-xs) tracking-[0.08em] text-muted-foreground uppercase'>
                  ← {previousKicker.value}
                </span>
                <span class='block font-bold'>{previousText.value}</span>
              </a>
              <a
                class='block rounded-lg border border-border px-5 py-4 text-foreground no-underline hover:border-primary min-[901px]:col-start-2 min-[901px]:text-end'
                href={nextHref.value}
                hidden={hideNext.value}
              >
                <span class='mb-1 block font-mono text-(length:--text-xs) tracking-[0.08em] text-muted-foreground uppercase'>
                  {nextKicker.value} →
                </span>
                <span class='block font-bold'>{nextText.value}</span>
              </a>
            </nav>
          </slot>
        </footer>
      </article>
    </div>
  );
}

export default OpenReadingShell;
