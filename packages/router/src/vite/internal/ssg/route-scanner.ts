/**
 * route-scanner.ts - Route scanner
 * Scans the routes directory and generates a route map.
 * Produces the virtual:routes module.
 *
 * Phase 1 enhancement: support for _renderer.ts (layout) and
 * _middleware.ts (Hono middleware) special files.
 *
 * Phase 2 enhancement: support for package islands auto-detection.
 * Packages can export an `islands` array in their main entry.
 *
 * Convention (minimal augmentation):
 * - _renderer.ts: exports a server wrapper around rendered route HTML
 * - _middleware.ts: exports a Hono middleware function applied before the route
 * - Files starting with _ are not route handlers but are loaded by the framework
 *
 * ─── SSR import discovery ─────────────────────────────────────
 *
 * This file discovers islands but does NOT import them (static scan only):
 *
 * 1. Local island files:
 *    - Scanned by `scanIslands()`
 *    - Metadata read by `scanIslandMeta()` (static, no import)
 *    - SSR decision: `openElement.ssr` field (static read, no import)
 *
 * 2. Package manifest islands:
 *    - Discovered by `scanPackageManifests()`
 *    - Imports package module to read `manifest` export
 *    - Browser-only packages: caught by try/catch
 *    - SSR decision: `manifest.declarations[].openElement.ssr` field
 *
 * 3. CEM manifests:
 *    - `scanCemManifests()` reads custom-elements.json without importing code.
 *    - `parseCem()` and `classifyCemManifest()` establish compatibility facts.
 *
 * 4. Nested compiled custom elements:
 *    - NOT handled in this file
 *    - Static component discovery is owned by `static-component-scanner.ts`;
 *      recursive expansion is owned by the generated SSG render runtime.
 *
 * TypeScript/TSX meaning is owned by the bundler-neutral compiler semantic
 * core. This scanner owns only file discovery, route paths, and delivery data.
 */

import type { RouteEntry, SpecialFileType } from '../protocol/framework.ts';
import { createLogger } from '@openelement/element';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { safeReadDir, safeReadFile, safeStat } from './route-scanner-fs.ts';
import { analyzeModuleSemantics } from '@openelement/element/compiler';

const IMPORT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * #577: a page's enhanced form may live in an imported component — scanning
 * only the route source would silently drop the enhancement layer. Follow
 * project-local relative imports (bounded depth, cycle-safe) and scan those
 * sources too.
 */
async function sourceTreeHasEnhancedForms(
  filePath: string,
  source: string,
  depth = 0,
  seen: Set<string> = new Set(),
): Promise<boolean> {
  const semantics = analyzeModuleSemantics(source, filePath);
  if (semantics.enhancedForm) return true;
  if (depth >= 3 || seen.has(filePath)) return false;
  seen.add(filePath);
  const dir = dirname(filePath);
  for (const specifier of semantics.relativeImports) {
    const candidates = [specifier, ...IMPORT_EXTENSIONS.map((ext) => specifier + ext)];
    for (const rel of candidates) {
      const candidate = join(dir, rel);
      const imported = await safeReadFile(candidate);
      if (imported === undefined) continue;
      if (await sourceTreeHasEnhancedForms(candidate, imported, depth + 1, seen)) return true;
      break;
    }
  }
  return false;
}

const log = createLogger('scanner');

/**
 * Missing-tagName notes fire at most once per file per process. scanRoutes()
 * is invoked by several build phases with different routesDir spellings
 * (relative vs absolute); keying on the resolved path keeps each file to a
 * single note.
 */
const notedMissingTagName = new Set<string>();

/**
 * #960: the ignored-tagName migration note also fires at most once per file
 * per process (same multi-pass routesDir spellings as above).
 */
const notedIgnoredTagName = new Set<string>();

/**
 * Convert a route file path to a URL path pattern.
 * e.g., 'index.ts' -> '/', 'about.ts' -> '/about', 'posts/[id].ts' -> '/posts/:id'
 *
 * v0.6: Uses URLPattern-compatible syntax where possible.
 * URLPattern is the WHATWG standard for URL matching (section7.2).
 * Pattern :param is compatible with both Hono and URLPattern.
 */
export function parseRouteFilePath(filePath: string): string {
  // Normalize separators - handle Windows backslash paths
  let p = normalizeSeparators(filePath);

  // v0.25: AST-verified — path utility, regex is the appropriate tool
  p = p.replace(/\.[^.]+$/, '');

  // v0.25: AST-verified — path utility, converts [param] to :param
  // 0.42.0-alpha.5 (#556): a catch-all segment [...path] becomes the Hono
  // named regex parameter :path{.+} (matches across '/'), not the literal
  // single-segment ':...path' the naive replacement produced.
  p = p.replace(/\[\.\.\.([^\]]+)\]/g, ':$1{.+}');
  p = p.replace(/\[([^\]]+)\]/g, ':$1');

  // Handle index
  if (p === 'index') return '/';
  if (p.endsWith('/index')) {
    p = p.slice(0, -6); // Remove trailing /index
    // After stripping /index, check if the result is the root index
    if (p === 'index' || p === '') return '/';
  }

  // Ensure leading slash
  if (!p.startsWith('/')) p = '/' + p;

  return p;
}

/**
 * Determine route type from file path.
 * Files under 'api/' subdirectory are API routes.
 */
function getRouteType(filePath: string): 'page' | 'api' {
  const normalized = filePath.split(sep).join(posix.sep);
  return normalized.startsWith('api/') || normalized.includes('/api/') ? 'api' : 'page';
}

/**
 * Generate a valid JS variable name from a route path.
 * e.g., '/' -> 'RouteIndex', '/about' -> 'RouteAbout', '/posts/:id' -> 'RoutePostsId'
 */
function pathToVarName(path: string): string {
  // v0.25: AST-verified — path-to-identifier transformation, regex is the appropriate tool
  let name = path
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/:([^/]+)/g, '$1')
    .replace(/[^a-zA-Z0-9]/g, '_');
  if (!name || name === '_') name = 'Index';
  return 'Route_' + name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Identify special file types by name.
 * _renderer.ts -> renderer, _middleware.ts -> middleware
 */
// inline lookup replaces 2-case switch
function getSpecialFileType(fileName: string): SpecialFileType | null {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return ({ _renderer: 'renderer', _middleware: 'middleware' } as Record<string, SpecialFileType>)[
    baseName
  ] ?? null;
}

/**
 * Check if a file should be ignored for routing.
 * Dot-files are always ignored.
 */
function isIgnoredFile(fileName: string): boolean {
  return fileName.startsWith('.');
}

/**
 * Recursively scan a directory for route files.
 * Also collects _renderer.ts and _middleware.ts special files.
 */
interface ScanRoutesOptions {
  /** Capture source text for page routes so consumers can extract metadata. */
  includeSource?: boolean;
}

/**
 * Recursively scan a directory for route files.
 * Also collects _renderer.ts and _middleware.ts special files.
 */
export async function scanRoutes(
  routesDir: string,
  baseDir: string = '',
  options: ScanRoutesOptions = {},
): Promise<RouteEntry[]> {
  const entries: RouteEntry[] = [];
  const files = await safeReadDir(routesDir);

  if (files === undefined) {
    log.debug(`Routes directory "${routesDir}" not found`);
    return entries;
  }

  for (const file of files) {
    if (isIgnoredFile(file)) continue;

    const fullPath = join(routesDir, file);
    const relativePath = baseDir ? join(baseDir, file) : file;
    const fileStat = await safeStat(fullPath);
    if (!fileStat) {
      log.debug(`File vanished before stat: ${fullPath}`);
      continue;
    }

    if (fileStat.isDirectory()) {
      // Recurse into subdirectories
      const subEntries = await scanRoutes(fullPath, relativePath, options);
      entries.push(...subEntries);
    } else if (/\.(ts|tsx|js|jsx|mdx)$/.test(file)) {
      // #954: .mdx pages are routes too — the dev entry and the Phase 3 SSR
      // build both carry mdxPlugin, and the generated importPath keeps the
      // real extension, so a discovered .mdx file imports cleanly.
      // Check for special files
      const specialType = getSpecialFileType(file);
      if (specialType) {
        // Add as a special entry - not a route handler, but loadable
        entries.push({
          path: parseRouteFilePath(relativePath),
          filePath: normalizeSeparators(relativePath),
          type: 'special', // Not a page or API route - renderer/middleware only
          varName: `Special_${specialType}_${baseDir.replace(/[\\/]/g, '_') || 'root'}`,
          special: specialType,
        });
      } else if (!file.startsWith('_')) {
        // Regular route file
        const routePath = parseRouteFilePath(relativePath);
        const routeType = getRouteType(relativePath);
        // v0.25: AST-verified — path utility, extracts [param] patterns
        // 0.42.0-alpha.5 (#556): a catch-all [...path] contributes the bare
        // param name 'path' (no '...' prefix) to match the ':path{.+}' pattern.
        const paramMatches = relativePath.match(/\[([^\]]+)\]/g);
        const params = paramMatches
          ? paramMatches.map((m) => m.slice(1, -1).replace(/^\.\.\./, ''))
          : undefined;
        let tagName: string | undefined;
        let source: string | undefined;
        let isDefinePage = false;
        if (routeType === 'page') {
          // The compiler semantic core reads route meaning without executing the module.
          source = await safeReadFile(fullPath);
          if (source === undefined) {
            log.debug(`Unable to read route module: ${fullPath}`);
          } else {
            const semantics = analyzeModuleSemantics(source, fullPath);
            tagName = semantics.exportedTagName;
            isDefinePage = semantics.definePage;
            // .mdx routes never carry a tagName export either — the entry
            // wraps their function component itself (#954), like definePage.
            if (tagName === undefined && !isDefinePage && !fullPath.endsWith('.mdx')) {
              // tagName not found is normal — not all page routes define one.
              // Dedupe by resolved path: multiple scan passes spell the same
              // routesDir differently (relative vs absolute).
              const resolvedPath = resolve(fullPath);
              if (!notedMissingTagName.has(resolvedPath)) {
                notedMissingTagName.add(resolvedPath);
                log.debug(`No tagName export found in route module: ${resolvedPath}`);
              }
            }
            // #960: migration-period signal. On a definePage route the
            // tagName export no longer drives SSR registration (the page's
            // tag resolves from its compiled Part Program at entry evaluation,
            // #1276); it only names a content element. Sanctioned shape-1
            // modules USE the tag
            // (defineElement + <tag/> in the render) and stay silent — an
            // orphaned export gets a one-time note.
            if (isDefinePage && tagName !== undefined && !semantics.usesExportedTagName) {
              const resolvedPath = resolve(fullPath);
              if (!notedIgnoredTagName.has(resolvedPath)) {
                notedIgnoredTagName.add(resolvedPath);
                log.info(
                  `Route module ${resolvedPath} exports tagName '${tagName}' but never uses it; ` +
                    `the export is ignored for registration on definePage routes (#960) — ` +
                    `the page's SSR tag resolves from its compiled Part Program (#1276).`,
                );
              }
            }
            // #971 (0.43, hard failure): a content element whose tag EQUALS
            // the path-derived fallback tag shadows the page class (the #952
            // ownership rule protects self-registrations), so the definePage
            // render is bypassed — request/actionData context never reaches
            // the page. This shape has never worked correctly; fail the build
            // with the rename guidance instead of letting it ship silently.
            if (
              isDefinePage && tagName !== undefined && tagName === fileToTagName(relativePath) &&
              semantics.usesExportedTagName
            ) {
              throw new Error(
                `Route module ${resolve(fullPath)} self-registers content element '${tagName}', ` +
                  `which equals the route's fallback registration tag — the content element ` +
                  `would shadow the page class (#952 rule) and the definePage render would be ` +
                  `bypassed (request/actionData context would not reach the page). ` +
                  `Rename the content element to a distinct tag (e.g. '${tagName}-view').`,
              );
            }
          }
        }
        entries.push({
          path: routePath,
          filePath: normalizeSeparators(relativePath),
          type: routeType,
          varName: pathToVarName(routePath),
          tagName,
          ...(isDefinePage ? { definePage: true } : {}),
          // #569: page sources carrying data-open-enhance require the client
          // enhancement layer even when the app has zero islands. The match
          // requires attribute shape (= or >) so prose mentioning the
          // attribute (e.g. guide pages) does not pull the layer in. #577:
          // follow relative imports so forms inside shared components count.
          ...(source !== undefined && await sourceTreeHasEnhancedForms(fullPath, source)
            ? { hasEnhancedForms: true }
            : {}),
          ...(options.includeSource && source !== undefined ? { source } : {}),
          params,
        });
      }
      // Other _-prefixed files (not _renderer/_middleware) are silently skipped
    }
  }

  // Generated order: special files last; static, parameters, catch-all;
  // ties use code-point path/file ordering independent of machine locale.
  entries.sort((a, b) => {
    const rank = (r: RouteEntry) =>
      r.special ? 3 : !r.path.includes(':') ? 0 : r.path.includes('{.+}') ? 2 : 1;
    const difference = rank(a) - rank(b);
    if (difference) return difference;
    return a.path < b.path
      ? -1
      : a.path > b.path
      ? 1
      : a.filePath < b.filePath
      ? -1
      : a.filePath > b.filePath
      ? 1
      : 0;
  });

  // #1029: pathToVarName folds '/', '-', and '_' into '_', so paths like
  // /a-b, /a/b, and /a_b all generate the identifier Route_A_b. The virtual
  // entry would then declare the same import twice and Rollup would fail with
  // a bare "Identifier has already been declared" — fail here instead, naming
  // both source paths. Checked once at the top-level call (recursion passes a
  // non-empty baseDir).
  if (baseDir === '') {
    const seenPaths = new Map<string, string>();
    for (const entry of entries) {
      if (entry.special) continue;
      // Only compare the scanner's bracket-file grammar; no regex-language
      // equivalence or arbitrary overlap rejection is attempted.
      const shape = parseRouteFilePath(
        entry.filePath.replace(/\[\.\.\.[^\]]+\]/g, '[...param]').replace(
          /\[(?!\.\.\.)[^\]]+\]/g,
          '[param]',
        ),
      );
      const previous = seenPaths.get(shape);
      if (previous) {
        throw new Error(
          `Equivalent route files: '${previous}' and '${entry.filePath}' produce '${shape}'`,
        );
      }
      seenPaths.set(shape, entry.filePath);
    }
    const seenVarNames = new Map<string, string>();
    for (const entry of entries) {
      const existing = seenVarNames.get(entry.varName);
      if (existing !== undefined) {
        throw new Error(
          `Route variable name collision: '${existing}' and '${entry.filePath}' both map to ` +
            `identifier '${entry.varName}' (pathToVarName folds '/', '-', '_' to '_'). ` +
            `Rename one of the route files.`,
        );
      }
      seenVarNames.set(entry.varName, entry.filePath);
    }
  }

  return entries;
}

/**
 * Convert a file path to a valid Custom Element tag name.
 *
 * Delegates to `@openelement/element` so the validation rules stay in
 * one place. Top-level files like `404.ts` get a safe prefix (`el-404`) and
 * files without a natural hyphen get a `-page` suffix.
 *
 * Examples:
 *   'my-counter.ts'        -> 'my-counter'
 *   'posts/index.ts'       -> 'posts-index'
 *   'admin\\dashboard.ts'  -> 'admin-dashboard'
 *   '404.ts'               -> 'el-404'
 */
export function fileToTagName(fileName: string): string {
  return pathToTagName(fileName);
}

export {
  type LocalIslandMeta,
  readIslandConfig,
  resolveIslandHydrate,
  resolveIslandSsrDsd,
  scanIslandMeta,
  scanIslands,
  scanPackageManifests,
} from './island-scanner.ts';
export {
  type CemScanResult,
  detectAndClassifyCemPackages,
  scanCemManifests,
} from './cem-scanner.ts';
