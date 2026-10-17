/**
 * The external stylesheet resource URLs a style list declares (alpha15 S lane).
 *
 * One reader for one fact: an adapter that fills a sheet from an external asset
 * records that asset's URL on the sheet under
 * {@linkcode STYLE_SHEET_URL} (authored `.css` files, the generated utility
 * sheet), and everything that needs the URL — the DSD serializer's links, the
 * claim's expected-resource set, the adoption guard that avoids a second copy
 * of a link-delivered sheet — reads it through this helper. A sheet without a
 * URL is an app-provided in-memory sheet: it has no external identity and is
 * never a resource reference.
 */

import { STYLE_SHEET_URL } from '@openelement/protocol/style-sheet';

/** The external resource URLs of a style list, in authored order. */
export function sheetResourceUrls(styles: unknown): string[] {
  if (!styles) return [];
  const sheets = Array.isArray(styles) ? styles : [styles];
  const urls: string[] = [];
  for (const sheet of sheets) {
    const url = (sheet as { [STYLE_SHEET_URL]?: unknown } | undefined)?.[STYLE_SHEET_URL];
    if (typeof url === 'string' && url !== '') urls.push(url);
  }
  return urls;
}
