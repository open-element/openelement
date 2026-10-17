/**
 * Route-tree path mapping shared by the site generators and gates.
 *
 * Single source for the filePath -> URL rule (moved verbatim out of
 * generate-site-nav.ts): `index` segments vanish, dynamic `[param]`
 * segments are not enumerable statically, everything else maps 1:1.
 * Import this instead of re-implementing the rule.
 *
 * The optional `dynamic` mapper projects a `[param]` segment (CL-36): the
 * sitemap scanner passes `(name) => ':' + name` so dynamic routes stay
 * enumerable as `:param` placeholders downstream. Without it the historic
 * contract holds — a dynamic segment makes the whole path unmappable
 * (`undefined`), which is what the retired-URL and nav consumers rely on.
 */
export function fileToRoutePath(
  relativePath: string,
  options: { dynamic?: (name: string) => string } = {},
): string | undefined {
  const withoutExtension = relativePath.replace(/\.tsx?$/, '');
  const segments = withoutExtension.split('/');
  const mapped: string[] = [];
  for (const segment of segments) {
    if (segment === 'index') continue;
    const dynamic = /^\[([A-Za-z0-9_]+)\]$/.exec(segment);
    if (dynamic) {
      if (!options.dynamic) return undefined; // dynamic routes are not enumerable
      mapped.push(options.dynamic(dynamic[1]!));
      continue;
    }
    if (segment.startsWith('[')) return undefined;
    mapped.push(segment);
  }
  return `/${mapped.join('/')}`;
}
