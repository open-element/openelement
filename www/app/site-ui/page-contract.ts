/** Declarative route data for private WWW structural components. */

export type PageOutlineItem = Readonly<{
  id: string;
  label: string;
  level?: 2 | 3;
}>;

export type ReadingMetadata = Readonly<{
  breadcrumb: string;
  title: string;
  lede?: string;
  date?: string;
  tags?: readonly string[];
}>;

export type ReadingNavigation = Readonly<{
  previous?: Readonly<{ href: string; label: string }>;
  next?: Readonly<{ href: string; label: string }>;
}>;

export function serializeOutline(outline: readonly PageOutlineItem[]): string {
  return JSON.stringify(outline);
}
