/**
 * Router tooling internal SSG post-processing.
 *
 * Pure Node.js fs operations for SSG output post-processing.
 * No Vite dependency - these functions only read/write files.
 *
 * URLPattern is used for route matching per WHATWG section7.2.
 *
 * Post-processing pipeline (called after SSG rendering):
 * 1. injectClientScript() - add island client entry
 * 2. injectViewTransitionMeta() - enable cross-page View Transitions
 * 3. injectSpeculationRules() - prefetch/prerender for navigation performance
 * 4. injectCspMeta() - Content-Security-Policy meta tag
 */

import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@openelement/element';
import { formatError } from '@openelement/element';
import { insertBeforeBodyClose } from '@openelement/element/build-utils';
import { visitHtmlFiles } from '../html-files.ts';
export { buildSpeculationRulesJson } from './speculation-rules.ts';

const log = createLogger('postprocess');

/** Hash suffix emitted by Rolldown/Vite content hashes: base64url — may contain `-`/`_`. */
const ISLAND_CHUNK_SUFFIX_RE = /^[A-Za-z0-9_-]+\.js$/;

/**
 * Match an island chunk file against a known tagName without splitting off
 * the content hash by position (hashes may contain `-`, so positional
 * splits are ambiguous). Matches both manualChunks output
 * (`island-<tag>-<hash>.js`) and Rolldown default chunk names
 * (`<tag>-<hash>.js`).
 */
function matchIslandChunkFile(file: string, tagName: string): boolean {
  for (const prefix of [`islands/island-${tagName}-`, `islands/${tagName}-`]) {
    if (file.startsWith(prefix) && ISLAND_CHUNK_SUFFIX_RE.test(file.slice(prefix.length))) {
      return true;
    }
  }
  return false;
}

// Shared directory walker: visitHtmlFiles from ../html-files.ts (#710) —
// walks the tree and applies a visitor to each HTML file. If the visitor
// returns a string, the file is overwritten with that content; if it returns
// null, the file is left unchanged.

// ─── HTML Insertion Helpers ────────────────────────────────────────────

/** Insert content immediately after <head> opening tag (handles attributes) */
function insertAfterHead(html: string, content: string): string {
  // M-11 fix: Use [^>]* instead of [\s\S]*? to prevent backtracking
  const headMatch = html.match(/<head(\s[^>]*)?>/i);
  if (!headMatch) {
    return html.startsWith('<!') || html.startsWith('<html')
      ? html.replace(/(<(?:!DOCTYPE|html)[^>]*>)/i, `$1\n<head>\n  ${content}\n</head>`)
      : `<head>\n  ${content}\n</head>\n${html}`;
  }
  if (headMatch.index === undefined) {
    throw new Error('insertAfterHead: matched <head> but index is undefined');
  }
  const headEnd = headMatch.index + headMatch[0].length;
  return html.slice(0, headEnd) + `\n  ${content}` + html.slice(headEnd);
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Scan client build output to build tagName -> chunk path mapping.
 * Reads Rollup manifest JSON (v0.3.0+ deterministic approach).
 *
 * Chunk identity comes from the manifest `name` field when present (exact,
 * hash-agnostic). Filename matching is only a fallback for manifests
 * without `name`: Rolldown/Vite content hashes are base64url and may
 * contain `-`/`_`, so the hash is never split off by position — files are
 * prefix-matched against each known tagName instead.
 */
export async function buildIslandChunkMap(
  root: string,
  outDir: string,
  islands: string[],
  basePath: string = '/',
  islandChunkAliases: Record<string, readonly string[]> = {},
): Promise<Record<string, string>> {
  const distDir = resolve(root, outDir);
  const clientDir = resolve(distDir, 'client');
  const islandChunkMap: Record<string, string> = {};

  if (!existsSync(clientDir)) return islandChunkMap;

  const manifestPath = join(clientDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return islandChunkMap;

  try {
    const manifestRaw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw);

    const aliasesFor = (tagName: string): readonly string[] =>
      islandChunkAliases[tagName] || [tagName];
    const tagsForCandidate = (candidate: string): string[] =>
      islands.filter((tagName) => aliasesFor(tagName).includes(candidate));
    const mapChunk = (tagNames: string[], file: string): void => {
      for (const tagName of tagNames) islandChunkMap[tagName] = `${basePath}client/${file}`;
    };

    for (
      const [_srcPath, entry] of Object.entries(manifest) as [
        string,
        { file?: string; name?: string },
      ][]
    ) {
      if (!entry.file) continue;
      const file = entry.file;

      if (file === 'islands/client.js') {
        for (const tagName of islands) {
          if (!islandChunkMap[tagName]) {
            islandChunkMap[tagName] = `${basePath}client/islands/client.js`;
          }
        }
        continue;
      }

      if (!file.startsWith('islands/') || !file.endsWith('.js')) continue;

      // Primary: manifest chunk name (exact, hash-agnostic). manualChunks
      // names island chunks `island-<tag>`; Rolldown default names them
      // `<tag>` after the source file basename.
      let matchedTags: string[] = [];
      if (entry.name) {
        const candidates = entry.name.startsWith('island-')
          ? [entry.name.slice('island-'.length), entry.name]
          : [entry.name];
        for (const candidate of candidates) {
          matchedTags = tagsForCandidate(candidate);
          if (matchedTags.length > 0) break;
        }
      }
      // Fallback: filename prefix match (the hash may contain `-`/`_`).
      if (matchedTags.length === 0) {
        matchedTags = islands.filter((island) =>
          aliasesFor(island).some((candidate) => matchIslandChunkFile(file, candidate))
        );
      }

      if (matchedTags.length > 0) {
        mapChunk(matchedTags, file);
      } else if (entry.name?.startsWith('island-') || file.startsWith('islands/island-')) {
        // Emitted as an island chunk (manualChunks `island-<tag>` naming) but
        // no scanned island tag matched — previously dropped silently.
        log.warn(
          `Unmatched island chunk "${file}" does not correspond to any scanned island; skipping it.`,
        );
      }
    }

    // An island with neither a dedicated chunk nor the client.js fallback
    // would silently never hydrate — surface that instead of dropping it.
    for (const tagName of islands) {
      if (!islandChunkMap[tagName]) {
        log.warn(`No client chunk found for island "${tagName}" in the client manifest.`);
      }
    }
  } catch (e) {
    // Malformed manifest - warn and return empty map
    log.warn(
      `Could not parse client manifest: ${formatError(e)}`,
    );
  }

  return islandChunkMap;
}

/**
 * Inject client script tag into all HTML files.
 */
export function injectClientScript(dir: string, scriptSrc: string): void {
  const scriptTag = `  <script type="module" src="${scriptSrc}"></script>`;
  visitHtmlFiles(dir, (content) => {
    if (content.includes(scriptSrc)) return null;
    return insertBeforeBodyClose(content, scriptTag);
  });
}

/**
 * Inject CSP <meta> tag into all HTML files (SSG-only).
 *
 * For static sites, CSP is enforced via <meta http-equiv="Content-Security-Policy">
 * rather than HTTP headers. Nonce-based CSP is NOT supported for SSG
 * (nonces must be per-request and unpredictable - impossible in static files).
 */
export function injectCspMeta(
  dir: string,
  cspPolicy: string,
  reportOnly = false,
  nonce = false,
): void {
  if (nonce) {
    log.warn(
      'CSP nonce is not supported for SSG static output. ' +
        'Falling back to policy-only Content-Security-Policy meta tag. ' +
        'For per-request nonces, use a server-side middleware instead.',
    );
  }

  const headerName = reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const escapedPolicy = cspPolicy.replace(/"/g, '&quot;');
  const metaTag = `  <meta http-equiv="${headerName}" content="${escapedPolicy}">`;

  visitHtmlFiles(dir, (content) => {
    if (content.includes(`http-equiv="${headerName}"`)) return null;
    return insertAfterHead(content, metaTag);
  });
}

// ─── View Transitions API ─────────────────────────────────────────────

/**
 * Inject View Transitions meta tag into all HTML files.
 *
 * The View Transitions API (Chrome 111+, Safari 18+, Firefox 129+) enables
 * smooth cross-page animations for MPA (Multi-Page App) navigation.
 * For SSG sites, this is a single meta tag - zero JavaScript required.
 *
 * When a user clicks a link, the browser automatically creates a cross-fade
 * transition between the old and new page. No SPA routing needed.
 *
 * Supported browsers: Chrome 111+, Edge 111+, Safari 18+, Firefox 129+.
 * Unsupported browsers silently ignore the meta tag (graceful degradation).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
 * @see https://chromestatus.com/feature/5190686707568640
 */
export function injectViewTransitionMeta(dir: string): void {
  const metaTag = '  <meta name="view-transition" content="same-origin">';

  visitHtmlFiles(dir, (content) => {
    if (content.includes('<meta name="view-transition"')) return null;
    return insertAfterHead(content, metaTag);
  });
}

// ─── Speculation Rules API ────────────────────────────────────────────

/**
 * Inject Speculation Rules into all HTML files.
 *
 * The Speculation Rules API (Chrome 121+) enables the browser to
 * prefetch or prerender pages before the user navigates to them.
 * This makes navigation feel instant for SSG sites.
 *
 * Speculation Rules are declarative JSON in a <script type="speculationrules"> tag.
 * They have zero JavaScript runtime cost - the browser handles everything natively.
 *
 * Only Chromium-based browsers (Chrome, Edge) support this as of 2026.
 * Safari and Firefox silently ignore the script tag (graceful degradation).
 *
 * @param dir - Output directory containing HTML files
 * @param rulesJson - Pre-built speculation rules JSON string
 */
export function injectSpeculationRules(dir: string, rulesJson: string): void {
  if (!rulesJson.trim()) return;

  const scriptTag = `  <script type="speculationrules">\n  ${rulesJson}\n  </script>`;

  visitHtmlFiles(dir, (content) => {
    if (content.includes('<script type="speculationrules"')) return null;
    return insertAfterHead(content, scriptTag);
  });
}
