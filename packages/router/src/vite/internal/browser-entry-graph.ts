/**
 * browser-entry-graph.ts — the M10-P1 client-build OBSERVER plugin.
 *
 * One `generateBundle` + one `moduleParsed` hook in the router CLIENT build
 * (SSR untouched) record the browser entry graph's actual facts — the emitted
 * chunks, their static/dynamic/implicit chunk edges, every rendered module and
 * its byte contribution, the entry module, the island attribution, and the
 * pre-tree-shake parsed module set — and write them as the deterministic
 * `.vite/oe-browser-entry-graph.json` artifact owned by
 * `browser-entry-graph-artifact.ts`.
 *
 * This plugin is REPORT-ONLY by construction:
 *
 * - it has no `resolveId`/`load`/`transform` hook, so it cannot add, remove or
 *   rewrite a module edge;
 * - it never calls `this.error`/`this.warn` and never throws for a report
 *   reason — a capture it cannot complete is emitted as
 *   `{ status: "incomplete", reason, diagnostics }`, and the checker turns that
 *   into UNPROVEN (exit 2). A build must not fail because its evidence
 *   instrumentation had a bad day, and no new error code is added;
 * - the only side effect is one emitted asset; the router test suite proves
 *   chunk file names, module ids and chunk code hashes are identical with and
 *   without the plugin mounted.
 *
 * The predicate (which modules are the generic executor's entry surface) is
 * NOT decided here: {@linkcode deriveBrowserEntryGraphSummary} is shared with
 * the checker, which recomputes the summary from the emitted facts instead of
 * trusting this writer. The expected verdict for the current tree is
 * VIOLATED — the artifact reports, it does not gate.
 *
 * @module ./browser-entry-graph.ts
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  BROWSER_ENTRY_GRAPH_ARTIFACT_FILE,
  BROWSER_ENTRY_GRAPH_KIND,
  BROWSER_ENTRY_GRAPH_PRODUCER,
  BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
  type BrowserEntryGraphArtifact,
  type BrowserEntryGraphChunk,
  type BrowserEntryGraphIncompleteArtifact,
  type BrowserEntryGraphIsland,
  type BrowserEntryGraphModule,
  deriveBrowserEntryGraphSummary,
  browserEntryGraphGateListDigest,
  executorEntryModuleIds,
  isNormalizedBrowserEntryGraphRelativePath,
  normalizeBrowserEntryGraphModuleId,
  serializeBrowserEntryGraphArtifact,
} from './browser-entry-graph-artifact.ts';

/**
 * One admitted island as the client entry sees it. The router build maps its
 * `ClientIslandDeliveryEntry` list to this shape; `specifier` is the declared
 * module specifier the build's identity pass resolved, and the live
 * `islandModuleIds` map (filled in `buildStart`, before `generateBundle`) is
 * the only source of the resolved module id.
 */
export interface BrowserEntryGraphIslandInput {
  tag: string;
  specifier: string;
  strategy: string;
}

/** Options the client build hands the observer. */
export interface BrowserEntryGraphPluginOptions {
  /** Absolute build root (the app directory). */
  root: string;
  /** Absolute client outDir (`<root>/<outDir>/client`). */
  outDir: string;
  /** The app's public base (`ctx.phase3.base || '/'`). */
  base: string;
  /** The machine-independent identity anchor (`findBuildWorkspaceRoot(root) ?? root`). */
  workspaceRoot: string;
  /** The resolved virtual client entry id (`\0virtual:open-client-entry`). */
  clientEntryModuleId: string;
  /** The resolved element package root, or null when the build never anchored it. */
  getElementPackageRoot: () => string | null;
  /** The admitted islands (tag + declared specifier + strategy). */
  islands: readonly BrowserEntryGraphIslandInput[];
  /** The build's own identity pass: declared specifier → resolved module id. */
  islandModuleIds: ReadonlyMap<string, string>;
}

/** The artifact file name (clientOutDir-relative), shared with the checker. */
export const BROWSER_ENTRY_GRAPH_FILE_NAME = BROWSER_ENTRY_GRAPH_ARTIFACT_FILE;

/** The stable internal reason a capture could not be completed. */
type CaptureReason =
  | 'no-emitted-chunks'
  | 'entry-chunk-not-unique'
  | 'entry-module-unresolved'
  | 'chunk-file-name-unnormalizable'
  | 'module-id-unnormalizable'
  | 'module-identity-collision'
  | 'module-chunk-ambiguous'
  | 'module-parsed-empty'
  | 'element-identity-unavailable'
  | 'element-identity-mismatch'
  | 'app-root-outside-workspace'
  | 'client-outdir-outside-root'
  | 'island-module-unresolved'
  | 'island-chunk-unresolved';

/** A report-only capture failure: internal codes only, never paths/messages. */
class CaptureIncomplete extends Error {
  readonly reason: CaptureReason;
  readonly diagnostics: readonly string[];

  constructor(reason: CaptureReason, diagnostics: readonly string[]) {
    super(reason);
    this.name = 'CaptureIncomplete';
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

/** Read a package.json version, or `unknown` when the manifest is unavailable. */
function readPackageVersion(manifestPath: string): string {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Read a package.json name, or null when the manifest is unavailable. */
function readPackageName(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : null;
  } catch {
    return null;
  }
}

/** The package the gate ids are anchored on. */
const ELEMENT_PACKAGE_NAME = '@openelement/element';

/** The producer version, read once from the router package's own manifest. */
const ROUTER_VERSION = readPackageVersion(
  fileURLToPath(new URL('../../../package.json', import.meta.url)),
);

/** The chunk fields this observer reads from the emitted bundle (structural). */
interface EmittedBundleChunk {
  type: 'chunk';
  fileName: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: readonly string[];
  dynamicImports?: readonly string[];
  implicitlyLoadedBefore?: readonly string[];
  modules?: Readonly<Record<string, { renderedLength: number }>>;
}

/** The bundle item shape the observer narrows on (assets are ignored). */
type EmittedBundleItem = EmittedBundleChunk | { type: 'asset'; fileName: string };

/** The emitted bundle, structurally typed so no Vite/rolldown type import is needed. */
type EmittedBundle = Readonly<Record<string, EmittedBundleItem>>;

/** One chunk as read from the Rollup/Rolldown `generateBundle` bundle. */
interface RawChunk {
  file: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports: string[];
  implicitlyLoadedBefore: string[];
  modules: Array<{ rawId: string; renderedLength: number }>;
}

/** POSIX spelling of an emitted bundle file name. */
function normalizeBundleFileName(fileName: string): string {
  return fileName.replace(/\\/gu, '/');
}

/**
 * The declared island specifier in a machine-independent spelling: an
 * absolute (or Vite `/@fs/`) path inside the app root becomes app-root
 * relative (`./app/islands/x.tsx`); a bare package specifier is kept verbatim;
 * anything else falls back to the artifact's normalized module-id spelling
 * (never an absolute path).
 */
function normalizeIslandSpecifier(
  specifier: string,
  appRoot: string,
  workspaceRoot: string,
): string {
  let value = normalizeBundleFileName(specifier);
  if (value.startsWith('/@fs/')) value = value.slice('/@fs'.length);
  if (isAbsolute(value)) {
    const appRelative = relative(appRoot, value).replace(/\\/gu, '/');
    if (
      appRelative !== '' &&
      appRelative !== '.' &&
      !appRelative.startsWith('../') &&
      !isAbsolute(appRelative)
    ) {
      return `./${appRelative}`;
    }
    return (
      normalizeBrowserEntryGraphModuleId(value, workspaceRoot) ?? './unresolved-island-specifier'
    );
  }
  return value;
}

/** Read every emitted chunk (assets are irrelevant to the module graph). */
function collectRawChunks(bundle: EmittedBundle): RawChunk[] {
  const chunks: RawChunk[] = [];
  for (const item of Object.values(bundle)) {
    if (item.type !== 'chunk') continue;
    const modules: Array<{ rawId: string; renderedLength: number }> = [];
    for (const [rawId, module] of Object.entries(item.modules ?? {})) {
      modules.push({ rawId, renderedLength: module.renderedLength });
    }
    chunks.push({
      file: normalizeBundleFileName(item.fileName),
      isEntry: item.isEntry === true,
      isDynamicEntry: item.isDynamicEntry === true,
      facadeModuleId: item.facadeModuleId ?? null,
      imports: [...(item.imports ?? [])].map(normalizeBundleFileName),
      dynamicImports: [...(item.dynamicImports ?? [])].map(normalizeBundleFileName),
      implicitlyLoadedBefore: [...(item.implicitlyLoadedBefore ?? [])].map(normalizeBundleFileName),
      modules,
    });
  }
  return chunks.sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  );
}

/** Sorted unique strings. */
function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** The clientOutDir-relative spelling of one validated bundle file name. */
function requireChunkFileName(fileName: string): string {
  const normalized = normalizeBundleFileName(fileName);
  if (!isNormalizedBrowserEntryGraphRelativePath(normalized)) {
    throw new CaptureIncomplete('chunk-file-name-unnormalizable', ['bundle-file-name']);
  }
  return normalized;
}

/** Build the artifact from the emitted bundle plus the moduleParsed capture. */
function captureBrowserEntryGraph(
  options: BrowserEntryGraphPluginOptions,
  bundle: EmittedBundle,
  parsedRawIds: ReadonlySet<string>,
  getModuleInfo: (id: string) => { id?: unknown } | null,
): BrowserEntryGraphArtifact {
  const rawChunks = collectRawChunks(bundle);
  if (rawChunks.length === 0) {
    throw new CaptureIncomplete('no-emitted-chunks', ['generate-bundle-empty']);
  }

  // One id normalizer per capture: it memoizes and records which raw ids landed
  // on which normalized spelling, so an identity collision is detected instead
  // of silently merging two modules.
  const normalizedById = new Map<string, string>();
  const ownersByNormalized = new Map<string, Set<string>>();
  const normalizeModuleId = (rawId: string): string => {
    const cached = normalizedById.get(rawId);
    if (cached !== undefined) return cached;
    const normalized = normalizeBrowserEntryGraphModuleId(rawId, options.workspaceRoot);
    if (normalized === null) {
      throw new CaptureIncomplete('module-id-unnormalizable', ['unresolved-module-id']);
    }
    const owners = ownersByNormalized.get(normalized) ?? new Set<string>();
    owners.add(rawId);
    ownersByNormalized.set(normalized, owners);
    normalizedById.set(rawId, normalized);
    return normalized;
  };

  // The entry chunk: the resolved virtual entry's facade, or — for a build
  // without that virtual id (the direct-Vite fixtures and any future entry
  // shape) — exactly one chunk flagged as the build entry.
  const facadeMatches = rawChunks.filter(
    (chunk) => chunk.facadeModuleId === options.clientEntryModuleId,
  );
  let entryRaw: RawChunk;
  if (facadeMatches.length === 1) {
    entryRaw = facadeMatches[0]!;
  } else if (facadeMatches.length === 0) {
    const entryFlagged = rawChunks.filter((chunk) => chunk.isEntry);
    if (entryFlagged.length !== 1) {
      throw new CaptureIncomplete('entry-chunk-not-unique', [
        `is-entry-count:${entryFlagged.length}`,
      ]);
    }
    entryRaw = entryFlagged[0]!;
  } else {
    throw new CaptureIncomplete('entry-chunk-not-unique', [
      `entry-facade-count:${facadeMatches.length}`,
    ]);
  }
  if (entryRaw.facadeModuleId === null) {
    throw new CaptureIncomplete('entry-module-unresolved', ['entry-facade-missing']);
  }

  // Chunks: validated file names, normalized ids, sorted arrays (determinism).
  const emittedModuleIds = new Set<string>();
  const chunks: BrowserEntryGraphChunk[] = rawChunks.map((rawChunk) => {
    const modules: BrowserEntryGraphModule[] = rawChunk.modules
      .map((module) => {
        const id = normalizeModuleId(module.rawId);
        emittedModuleIds.add(module.rawId);
        return { id, renderedLength: module.renderedLength };
      })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    return {
      file: requireChunkFileName(rawChunk.file),
      isEntry: rawChunk.isEntry,
      isDynamicEntry: rawChunk.isDynamicEntry,
      facadeModuleId:
        rawChunk.facadeModuleId === null ? null : normalizeModuleId(rawChunk.facadeModuleId),
      imports: sortedUnique(rawChunk.imports.map(requireChunkFileName)),
      dynamicImports: sortedUnique(rawChunk.dynamicImports.map(requireChunkFileName)),
      implicitlyLoadedBefore: sortedUnique(
        rawChunk.implicitlyLoadedBefore.map(requireChunkFileName),
      ),
      modules,
    };
  });

  // Two different raw modules landing on one normalized spelling would make the
  // loaded set depend on the spelling, not on identity. Report incomplete.
  for (const owners of ownersByNormalized.values()) {
    if (owners.size > 1 && [...owners].some((rawId) => emittedModuleIds.has(rawId))) {
      throw new CaptureIncomplete('module-identity-collision', ['normalized-id-collision']);
    }
  }

  // One module belongs to one chunk; two chunks claiming the same module id is
  // an ambiguous attribution (the checker would refuse to judge it).
  const chunkByModule = new Map<string, string>();
  for (const chunk of chunks) {
    for (const module of chunk.modules) {
      const existing = chunkByModule.get(module.id);
      if (existing !== undefined && existing !== chunk.file) {
        throw new CaptureIncomplete('module-chunk-ambiguous', ['module-in-multiple-chunks']);
      }
      chunkByModule.set(module.id, chunk.file);
    }
  }

  // Parse capture: moduleParsed is the source of truth for pre-tree-shake
  // modules; the bundle's own module/facade ids supplement it when the hook
  // missed a virtual id (generateBundle's getModuleInfo is the documented
  // fallback). An empty capture is incomplete, never a silently green graph.
  const parsedRaw = new Set(parsedRawIds);
  const supplement = (rawId: string): void => {
    if (parsedRaw.has(rawId)) return;
    const info = getModuleInfo(rawId);
    if (info !== null && typeof info.id === 'string') parsedRaw.add(info.id);
  };
  for (const rawChunk of rawChunks) {
    if (rawChunk.facadeModuleId !== null) supplement(rawChunk.facadeModuleId);
    for (const module of rawChunk.modules) supplement(module.rawId);
  }
  if (parsedRaw.size === 0) {
    throw new CaptureIncomplete('module-parsed-empty', ['module-parsed-empty']);
  }
  const parsedModuleIds = sortedUnique([...parsedRaw].map((rawId) => normalizeModuleId(rawId)));

  // Element identity: the gate ids are anchored on the build's own resolved
  // element package root. No anchor means the predicate cannot be evaluated.
  const rawElementPackageRoot = options.getElementPackageRoot();
  if (rawElementPackageRoot === null) {
    throw new CaptureIncomplete('element-identity-unavailable', [
      'element-runtime-identity-missing',
    ]);
  }
  const elementPackageRoot = normalizeModuleId(rawElementPackageRoot);
  const elementManifest = `${rawElementPackageRoot}/package.json`;
  const elementName = readPackageName(elementManifest);
  if (elementName !== null && elementName !== ELEMENT_PACKAGE_NAME) {
    throw new CaptureIncomplete('element-identity-mismatch', ['element-package-name']);
  }

  // App facts: workspace-relative root, outDir relative to that root. No
  // absolute path may reach the artifact.
  const rootRelative = relative(options.workspaceRoot, options.root).replace(/\\/gu, '/');
  if (
    rootRelative === '' ||
    rootRelative.startsWith('../') ||
    rootRelative === '..' ||
    !isNormalizedBrowserEntryGraphRelativePath(rootRelative)
  ) {
    throw new CaptureIncomplete('app-root-outside-workspace', ['app-root']);
  }
  const outDirRelative = relative(options.root, options.outDir).replace(/\\/gu, '/');
  if (
    outDirRelative === '' ||
    outDirRelative.startsWith('../') ||
    outDirRelative === '..' ||
    !isNormalizedBrowserEntryGraphRelativePath(outDirRelative)
  ) {
    throw new CaptureIncomplete('client-outdir-outside-root', ['client-outdir']);
  }

  // Island attribution: the module id comes from the build's identity pass, the
  // chunk from the emitted module graph. Anything unresolved is incomplete.
  const islands: BrowserEntryGraphIsland[] = options.islands
    .map((island) => {
      const rawModuleId = options.islandModuleIds.get(island.specifier);
      if (rawModuleId === undefined) {
        throw new CaptureIncomplete('island-module-unresolved', ['island-identity-missing']);
      }
      const moduleId = normalizeModuleId(rawModuleId);
      const containingChunks = chunks.filter((chunk) =>
        chunk.modules.some((module) => module.id === moduleId),
      );
      if (containingChunks.length !== 1) {
        throw new CaptureIncomplete('island-chunk-unresolved', [
          containingChunks.length === 0 ? 'module-not-in-chunk' : 'module-in-multiple-chunks',
        ]);
      }
      return {
        tag: island.tag,
        specifier: normalizeIslandSpecifier(island.specifier, options.root, options.workspaceRoot),
        moduleId,
        strategy: island.strategy,
        chunkFile: containingChunks[0]!.file,
      };
    })
    .sort(
      (left, right) =>
        (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0) ||
        (left.specifier < right.specifier ? -1 : left.specifier > right.specifier ? 1 : 0),
    );

  const core = {
    schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
    kind: BROWSER_ENTRY_GRAPH_KIND,
    status: 'complete' as const,
    producer: { package: BROWSER_ENTRY_GRAPH_PRODUCER, version: ROUTER_VERSION },
    app: { root: rootRelative, outDir: outDirRelative, base: options.base },
    element: { packageRoot: elementPackageRoot, version: readPackageVersion(elementManifest) },
    entry: {
      moduleId: normalizeModuleId(entryRaw.facadeModuleId),
      chunkFile: requireChunkFileName(entryRaw.file),
    },
    islands,
    chunks,
    parsedModuleIds,
  } satisfies Omit<BrowserEntryGraphArtifact, 'predicate'>;

  const summary = deriveBrowserEntryGraphSummary(core);
  return {
    ...core,
    predicate: {
      gateListDigest: browserEntryGraphGateListDigest(),
      executorEntry: executorEntryModuleIds(elementPackageRoot),
      loadedViolations: summary.loadedViolations,
      parsedOnlyExecutorResidues: summary.parsedOnlyExecutorResidues,
      diagnostics: summary.diagnostics,
    },
  };
}

/** The incomplete artifact for a capture that could not be completed. */
function incompleteArtifact(
  reason: CaptureReason | 'capture-error',
  diagnostics: readonly string[],
): BrowserEntryGraphIncompleteArtifact {
  return {
    schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
    kind: BROWSER_ENTRY_GRAPH_KIND,
    status: 'incomplete',
    reason,
    diagnostics: [...diagnostics],
  };
}

/**
 * The client-build observer. Mount it in the CLIENT build's plugin list only
 * (`cli/build-client.ts`); the SSR build must not see it. It has no hook that
 * can alter the module graph, and no failure path that fails the build.
 */
export function browserEntryGraphPlugin(options: BrowserEntryGraphPluginOptions): Plugin {
  const parsedRawIds = new Set<string>();
  return {
    name: 'open:browser-entry-graph',
    apply: 'build',
    moduleParsed(info) {
      if (typeof info?.id === 'string' && info.id !== '') parsedRawIds.add(info.id);
    },
    generateBundle(_outputOptions, bundle) {
      // The documented fallback for a virtual id moduleParsed may have missed:
      // getModuleInfo answers from the same module graph during generateBundle.
      const getModuleInfo = (id: string): { id?: unknown } | null => {
        try {
          const info = this.getModuleInfo(id);
          return info === null ? null : { id: info.id };
        } catch {
          return null;
        }
      };
      let source: string;
      try {
        source = serializeBrowserEntryGraphArtifact(
          captureBrowserEntryGraph(options, bundle, parsedRawIds, getModuleInfo),
        );
      } catch (error) {
        source = serializeBrowserEntryGraphArtifact(
          error instanceof CaptureIncomplete
            ? incompleteArtifact(error.reason, error.diagnostics)
            : incompleteArtifact('capture-error', ['unexpected-capture-error']),
        );
      }
      try {
        this.emitFile({
          type: 'asset',
          fileName: BROWSER_ENTRY_GRAPH_FILE_NAME,
          source,
        });
      } catch {
        // Report-only: an emitted-asset failure must never fail the build. A
        // missing artifact is caught by the checker as UNPROVEN.
      }
    },
  };
}
