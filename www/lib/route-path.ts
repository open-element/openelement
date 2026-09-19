/**
 * Route-tree path mapping shared by the site generators and gates.
 *
 * Single source for the filePath -> URL rule (moved verbatim out of
 * generate-site-nav.ts): `index` segments vanish, dynamic `[param]`
 * segments are not enumerable statically, everything else maps 1:1.
 * Import this instead of re-implementing the rule.
 */
export function fileToRoutePath(relativePath: string): string | undefined {
  const withoutExtension = relativePath.replace(/\.tsx?$/, '');
  const segments = withoutExtension.split('/');
  const mapped: string[] = [];
  for (const segment of segments) {
    if (segment === 'index') continue;
    if (segment.startsWith('[')) return undefined; // dynamic routes are not enumerable
    mapped.push(segment);
  }
  return `/${mapped.join('/')}`;
}
