/**
 * ./island-transform.ts — Island transform core logic.
 *
 * Pure function: injects island metadata markers into source code.
 * Zero Vite dependency. Usable with any build tool.
 */

import type { IslandTransformOptions, IslandTransformResult } from '@openelement/protocol/island';
import { normalizeSeparators, pathToTagName } from './path-utils.ts';
export type { IslandTransformOptions, IslandTransformResult };

/**
 * Inject island metadata markers into source code.
 *
 * Only transforms files inside the islands directory.
 * Tag names are derived from the file path and normalized to valid custom
 * element names (lowercase letters, digits, and hyphens). Unsafe characters
 * are silently normalized to hyphens.
 */
export function transformIslandSource(
  source: string,
  options: IslandTransformOptions,
): IslandTransformResult {
  const { islandsDir, filePath } = options;
  // Normalize to forward slashes and ensure leading slash for reliable matching
  let normalizedPath = normalizeSeparators(filePath);
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }
  // Only SCRIPT modules are island sources — the same file set the build's
  // island scanner admits (`*.ts|tsx|js|jsx`, query/hash stripped). A `.css`,
  // `.json` or any other asset that happens to sit under the islands
  // directory is content, not a component: appending JS markers to it would
  // corrupt the module's own text (a `.css?inline` read then carries the
  // markers INSIDE the stylesheet), and no marker of it could ever be read.
  const modulePath = normalizedPath.split(/[?#]/, 1)[0]!;
  if (!/\.(?:ts|tsx|js|jsx)$/.test(modulePath)) {
    return { code: source, islands: [] };
  }
  // Segment-wise trim (linear, no backtracking quantifiers): the analyzer
  // flags replace(/^\/+|\/+$/g) on library input, and slicing says the same
  // thing without it.
  let normalizedIslandsDir = normalizeSeparators(islandsDir);
  while (normalizedIslandsDir.startsWith('/')) normalizedIslandsDir = normalizedIslandsDir.slice(1);
  while (normalizedIslandsDir.endsWith('/'))
    normalizedIslandsDir = normalizedIslandsDir.slice(0, -1);

  // Only transform files in the islands directory. The needle is
  // segment-anchored on both sides (`app/islands-backup` never matches) and
  // anchored on its LAST occurrence: an outer same-named directory (nested
  // checkouts, fixtures) must not hijack the admission or the tag derivation
  // — the innermost islands root wins.
  const needle = `/${normalizedIslandsDir}/`;
  const anchor = normalizedIslandsDir === '' ? -1 : normalizedPath.lastIndexOf(needle);
  if (anchor === -1) {
    return layoutAdmission(source, options);
  }

  // Extract tag name from file path using the same helper as the SSG route
  // scanner. This keeps route and island tag-name derivation consistent and
  // safely handles edge cases such as top-level numeric file names.
  const relativePath =
    normalizedPath.slice(anchor + needle.length) || normalizedPath.split('/').pop()!;
  const tagName = pathToTagName(relativePath);

  // Files that do not yield a valid name are skipped silently.
  if (!tagName) {
    return { code: source, islands: [] };
  }

  // pathToTagName already guarantees a valid custom element name (or empty).
  // No further validation is needed here.

  // Inject metadata markers
  const injected = `
 // --- Island Markers (auto-injected) ---
 export const __island = true;
 export const __tagName = '${tagName}';
 // --- End Island Markers ---
 `;

  return {
    code: source + '\n' + injected,
    islands: [{ tagName, filePath }],
  };
}

/**
 * Layout-convention admission (alpha15 R batch 3): the layout module lives
 * outside `islandsDir` (`app/layout.tsx`), so the islands gate above never
 * sees it. When the caller passes the router-resolved layout, admit exactly
 * that one project-relative path with its resolved tag — never a basename
 * guess, so `app/components/layout-helper.tsx` and friends stay out. No
 * admission configured (or no match) means the source passes through
 * unchanged: a deleted convention file is a supported shell-less project,
 * and a configured-but-missing module fails closed later at import time.
 */
function layoutAdmission(source: string, options: IslandTransformOptions): IslandTransformResult {
  const { filePath, layout } = options;
  if (!layout) return { code: source, islands: [] };
  let normalizedPath = normalizeSeparators(filePath);
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }
  // Vite ids may carry a query/hash (?v=, ?t=); the admission compares the
  // module path only.
  const idPath = normalizedPath.split(/[?#]/, 1)[0];
  const want = normalizeSeparators(layout.path).replace(/^(\.\/|\/)+/, '');
  if (want === '' || (idPath !== `/${want}` && !idPath.endsWith(`/${want}`))) {
    return { code: source, islands: [] };
  }
  const injected = `
// --- Island Markers (auto-injected) ---
export const __island = true;
export const __tagName = '${layout.tagName}';
// --- End Island Markers ---
`;
  return {
    code: source + '\n' + injected,
    islands: [{ tagName: layout.tagName, filePath }],
  };
}
