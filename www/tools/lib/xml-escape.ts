/**
 * XML text/attribute escaping shared by the site's XML emitters (RSS feed,
 * sitemap). Escapes the five XML predefined entities; everything else passes
 * through byte-for-byte.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
