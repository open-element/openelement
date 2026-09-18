/** Declarative route data for private WWW structural components. */

export type PageOutlineItem = Readonly<{
  id: string;
  label: string;
  level?: 2 | 3;
}>;

export type ReadingMetadata = Readonly<{
  breadcrumb: string;
  /** Section root the breadcrumb label links to; absent keeps plain text. */
  breadcrumbHref?: string;
  title: string;
  lede?: string;
  date?: string;
  /** Machine-derived source-file stamp; absent hides the freshness row. */
  updated?: string;
  /** Version mark the article applies to; absent hides the freshness row. */
  version?: string;
  /** Optional editorial accent rendered in Instrument Serif after the title. */
  accent?: string;
  tags?: readonly string[];
}>;

export type ReadingNavigation = Readonly<{
  previous?: Readonly<{ href: string; label: string }>;
  next?: Readonly<{ href: string; label: string }>;
}>;

export function serializeOutline(outline: readonly PageOutlineItem[]): string {
  return JSON.stringify(outline);
}
