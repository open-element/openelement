// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the frozen executor-load predicate, the artifact schema and its evaluator are deliberately one module so writer and checker cannot drift — the file owns exactly those three facts and nothing else; the boundary is the deterministic .vite/oe-browser-entry-graph.json artifact written by browser-entry-graph.ts in the router client build and re-evaluated by the checker from raw chunk/module facts, with anything missing, malformed or untrustworthy UNPROVEN (exit 2), never silently MET.
/**
 * browser-entry-graph-artifact.ts — the M10-P1 browser-entry module-graph
 * artifact contract and its ONE evaluator.
 *
 * This module owns three facts and nothing else:
 *
 * 1. **The frozen predicate.** The P1 claim under test is the plan §12a
 *    wording: no production browser entry LOADS the generic Part Program
 *    executor. Six executor **entry** modules name that load surface; they are
 *    matched by exact module identity (the resolved `@openelement/element`
 *    package root plus the package-relative path), never by suffix,
 *    substring, or implementation closure. Shared primitives, the retained
 *    server-private serializer/resources, and the class-authoring surface are
 *    REPORT-ONLY categories: they are listed so the evidence record shows what
 *    the old path still ships, but a loaded support module can never turn the
 *    verdict red or green.
 *
 * 2. **The artifact schema** (`schemaVersion: 1`). The writer
 *    (`browser-entry-graph.ts`, mounted in the router client build) writes one
 *    deterministic, machine-path-free document under
 *    `<clientOutDir>/.vite/oe-browser-entry-graph.json`; this module owns the
 *    shape, the id normalization rule, and the serializer so the writer and
 *    the checker cannot drift.
 *
 * 3. **The evaluator** (`evaluateBrowserEntryGraphArtifact`). The checker
 *    recomputes the predicate from the artifact's emitted chunk/module facts
 *    instead of trusting the writer's summary. A missing, malformed,
 *    incomplete, self-inconsistent, or structurally untrustworthy artifact is
 *    `UNPROVEN` (exit 2) — never a silent MET. The same function feeds the
 *    writer's own summary so both sides agree byte for byte.
 *
 * Hard boundaries (deliberate):
 *
 * - **No `vite` import.** `tools/repo/check-browser-entry-graph.ts` typechecks
 *   and runs under the tools tsconfig; importing the router's Vite plugin
 *   types would drag the whole build surface in. Only Node builtins are used.
 * - **No public surface.** This file is internal build plumbing; it adds no
 *   package export, no error code, and no release gate.
 * - **No embedded app-completeness claim.** The evaluator judges the
 *   artifacts it is given. Which production apps are covered is a claim of
 *   the evidence record (owner/review), not of this module; there is no
 *   hard-coded app list, no baseline, and no `--all`.
 * - **Report, never fail the build.** The writer only reads the emitted
 *   bundle. Violations may be expected (the tree is red today); the audit is
 *   produced, not enforced.
 * - **The artifact is trusted build output, not authenticated JSON.** The
 *   checker's recomputation catches writer bugs, truncated/partial captures,
 *   structural forgery of the chunk table, and non-canonical spellings that
 *   would otherwise change an exact-identity result by accident. It cannot
 *   authenticate provenance: an actor who can write the artifact can write a
 *   coherent MET document (or replace `dist/` wholesale), and no amount of
 *   self-consistency checking detects that. Trust in the artifact comes from
 *   the build/CI pipeline that produced it (commit, clean tree, exact command,
 *   artifact sha256 recorded in the evidence record), never from this schema.
 *   We do not pretend the checker verifies authenticity.
 * - **Virtual ids are decoded, never published opaque.** The bundler's `\0`
 *   namespace can embed machine paths (the style-asset graph id is
 *   base64url of an absolute sheet path). A known encoded scheme is decoded
 *   and re-anchored on the same workspace/package identity rule; an unknown or
 *   undecodable virtual id makes the capture INCOMPLETE instead of shipping an
 *   opaque id that may leak a machine path.
 *
 * @module ./browser-entry-graph-artifact.ts
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';

/** The artifact schema version this module reads and writes. */
export const BROWSER_ENTRY_GRAPH_SCHEMA_VERSION = 1;

/** The artifact's discriminator. */
export const BROWSER_ENTRY_GRAPH_KIND = 'open-browser-entry-graph';

/**
 * The artifact path RELATIVE to the client build's outDir — the same
 * directory and trust class as Vite's own `.vite/manifest.json`, Git-ignored
 * build output (`dist/`), and never a tracked generated surface.
 */
export const BROWSER_ENTRY_GRAPH_ARTIFACT_FILE = '.vite/oe-browser-entry-graph.json';

/** The producer package recorded in every artifact. */
export const BROWSER_ENTRY_GRAPH_PRODUCER = '@openelement/router';

/**
 * The router client build's style-asset graph id prefix
 * (`packages/router/src/vite/internal/style-assets.ts`):
 * `\0oe-style-asset:<base64url(registry key)>.js`. The registry key is the
 * sheet file's ABSOLUTE path plus the optional light-root scope tag (NUL
 * separator), so the raw id is machine-path-bearing by construction and must
 * be decoded and re-anchored before publication.
 */
export const STYLE_ASSET_VIRTUAL_MODULE_PREFIX = '\0oe-style-asset:';

/**
 * `\0` module ids the artifact may keep verbatim. Everything else in the
 * `\0` namespace is UNKNOWN: a virtual id can embed an absolute path, so an
 * unrecognized one is reported incomplete by the writer and treated as
 * malformed by the checker — it is never published opaque. Adding a bundler or
 * plugin virtual id extends this frozen set together with its review and its
 * machine-independence argument.
 */
const VERBATIM_VIRTUAL_MODULES: ReadonlySet<string> = new Set([
  '\0empty-preact-rts',
  '\0oe-tailwind-components.js',
]);

/** `\0virtual:<name>`: plugin-namespaced virtuals carry no path segments. */
const VIRTUAL_PLAIN_ID = /^[A-Za-z0-9_.:-]+$/u;

/** Bundler-owned helper roots whose tail must still be a clean relative path. */
const VIRTUAL_HELPER_ROOTS: readonly string[] = ['\0vite/', '\0rolldown/'];

/** A canonical custom-element tag (the light-root scope record in a style key). */
const STYLE_SCOPE_TAG = /^[a-z][a-z0-9._-]*$/u;

/**
 * The P1 gate: the generic executor's **entry** modules, element-package
 * relative, in the reviewed order. These are the call-surface modules a
 * production browser entry must load to execute a Part Program in the browser
 * (the program normalizer every path starts at, fresh mount, hydration, and the
 * kernel that drives them). Matched by exact identity only — a same-named
 * module outside the resolved element package root is NOT an executor entry.
 *
 * FOUR, NOT SIX (F16 class-lane retirement). `facade-host.ts` and `runtime/kernel.ts`
 * were the class lane's own call surfaces — the facade that turned
 * `__compiledProperties`/`__partProgram` statics into live element behaviour,
 * and the claim/resume kernel that drove them — and both were deleted with the
 * lane (`5ff82e101`, `5275a66b2`). Naming them here kept the gate permanently
 * one-half decorative: two of its six ids could never appear in any graph, so
 * the digest pinned a claim the tree could no longer fail. The survivors are
 * the executor proper, and they cover every way a browser graph can reach it —
 * measured: a graph importing the element root entry loads all four, while the
 * sanctioned generated path (leaf runtime + shell) loads none.
 *
 * Changing this table is a reviewed code change with the per-id rationale in
 * the M10-P1 design; the artifact records {@linkcode browserEntryGraphGateListDigest}
 * so a checker from another revision refuses to judge rather than judging a
 * different claim.
 */
export const EXECUTOR_ENTRY_RELATIVE_MODULES = [
  'src/internal/compiled/runtime-program.ts',
  'src/internal/compiled/runtime/fresh-dom.ts',
  'src/internal/compiled/runtime/hydrate.ts',
  'src/internal/compiled/runtime/program-kernel.ts',
] as const;

/**
 * Report-only: executor **support** modules (implementation resources reached
 * only through an executor entry). Listed for the evidence record, never
 * gated — the gate is the entry path, and the plan/ADR retain these resources
 * and their server-side consumers.
 */
export const EXECUTOR_SUPPORT_RELATIVE_MODULES = [
  'src/internal/compiled/runtime/parts.ts',
  'src/internal/compiled/runtime/blocks.ts',
  'src/internal/compiled/runtime/props.ts',
  'src/internal/compiled/runtime/revive.ts',
  'src/internal/compiled/runtime/error-boundary.ts',
  'src/internal/compiled/runtime/pre-upgrade-events.ts',
  'src/internal/compiled/runtime/hydrate-recovery.ts',
  'src/internal/compiled/runtime/blocks-seam.ts',
] as const;

/**
 * Report-only: modules ADR-0174 explicitly keeps OUTSIDE the P1 gate (the Part
 * Program artifact/validator/metadata and the server serialization
 * consumers). A browser graph loading them is suspicious and reported loudly,
 * but it is not the gate's item.
 */
export const SERVER_PRIVATE_RELATIVE_MODULES = [
  'src/internal/compiled/serializer/serialize-program.ts',
  'src/internal/compiled/server/index.ts',
  'src/internal/compiled/server/shared.ts',
] as const;

/**
 * Report-only: the class-authoring surface. Class-island migration is M10
 * partition evidence (public API + browser runtime), separate from P1's
 * executor-unreachability wording; in practice loading it implies an executor
 * entry, which the report records as the relationship.
 */
export const AUTHORING_RELATIVE_MODULES = [
  'src/index.ts',
  'src/client-only.ts',
  'src/no-blocks.ts',
  'src/base.ts',
  'src/public-surface.ts',
  'src/open-element.ts',
  'src/open-element-implementation.ts',
] as const;

/**
 * Report-only: the generated-leaf/neutral M04 surface the sanctioned
 * ADR-0177 generated path legitimately imports. Only OBSERVED ids are listed;
 * no classification here can change the verdict.
 */
export const LEAF_SURFACE_RELATIVE_MODULES = [
  'src/internal/compiled/runtime.ts',
  'src/internal/compiled/runtime/recipe.ts',
  'src/internal/compiled/runtime/values.ts',
  'src/internal/compiled/runtime/bindings.ts',
  'src/internal/compiled/runtime/markers.ts',
  'src/internal/compiled/runtime/claim-invariants.ts',
  'src/internal/compiled/runtime/lineage.ts',
  'src/internal/compiled/runtime/observability.ts',
  'src/internal/compiled/runtime/static-sibling-ranges.ts',
  'src/internal/compiled/runtime/list-key.ts',
  'src/internal/compiled/lifetime-scope.ts',
] as const;

/** The generated-element emitter surface: every module under this prefix is leaf surface. */
export const GENERATED_ELEMENT_RELATIVE_PREFIX = 'src/internal/compiled/generated-element/';

/** Report-only classification of one loaded module. */
export type BrowserEntryGraphModuleCategory =
  | 'executorEntry'
  | 'executorSupport'
  | 'serverPrivate'
  | 'authoring'
  | 'leafSurface';

/** One emitted module's rendered contribution inside a chunk. */
export interface BrowserEntryGraphModule {
  /** Normalized module id (workspace-relative, `node_modules/<pkg>/…`, or a virtual id). */
  id: string;
  /** Bytes this module contributed to the chunk (0 = parsed, fully tree-shaken). */
  renderedLength: number;
}

/** One emitted client chunk, as the browser downloads it. */
export interface BrowserEntryGraphChunk {
  /** The emitted file name, clientOutDir-relative (e.g. `islands/client.js`). */
  file: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
  /** Static chunk imports (file names). */
  imports: string[];
  /** Dynamic `import()` chunk edges (file names). */
  dynamicImports: string[];
  /** Implicitly loaded chunk edges (file names), when the bundler reports them. */
  implicitlyLoadedBefore: string[];
  modules: BrowserEntryGraphModule[];
}

/** One island's identity → module → chunk attribution. */
export interface BrowserEntryGraphIsland {
  tag: string;
  /** The declared module specifier the build's identity pass resolved. */
  specifier: string;
  /** The resolved module id, normalized; the asset manifest joins on the same id. */
  moduleId: string;
  strategy: string;
  /** The emitted chunk file carrying the island module. */
  chunkFile: string;
}

/** Per-category report lists (report-only; never gate). */
export interface BrowserEntryGraphDiagnostics {
  executorSupport: string[];
  serverPrivate: string[];
  authoring: string[];
  leafSurface: string[];
}

/** One loaded executor-entry module with its chunk and island attribution. */
export interface BrowserEntryGraphViolation {
  moduleId: string;
  chunkFile: string;
  /** Tags whose chunk load closure contains this module's chunk (empty = entry-level). */
  islands: string[];
}

/**
 * The artifact's own summary of the predicate. The checker RECOMPUTES this
 * from `chunks`/`parsedModuleIds` and only compares the declared copy for
 * self-consistency; it never trusts it.
 */
export interface BrowserEntryGraphPredicate {
  gateListDigest: string;
  /** Normalized executor-entry module ids for this artifact's element package root. */
  executorEntry: string[];
  loadedViolations: BrowserEntryGraphViolation[];
  parsedOnlyExecutorResidues: string[];
  diagnostics: BrowserEntryGraphDiagnostics;
}

/** The app (build root) facts the artifact was produced from. */
export interface BrowserEntryGraphApp {
  /** Workspace-relative app root (e.g. `www`), never an absolute path. */
  root: string;
  /** Client outDir relative to the app root (e.g. `dist/client`). */
  outDir: string;
  /** The app's public base (the client build uses `<base>client/`). */
  base: string;
}

/** The element package identity the gate ids are anchored on. */
export interface BrowserEntryGraphElement {
  /** Normalized resolved `@openelement/element` package root. */
  packageRoot: string;
  version: string;
}

/** The client entry chunk and its module. */
export interface BrowserEntryGraphEntry {
  moduleId: string;
  chunkFile: string;
}

/** Producer metadata (no timestamps: determinism is an acceptance criterion). */
export interface BrowserEntryGraphProducer {
  package: string;
  version: string;
}

/** Every field of a COMPLETE artifact except its predicate summary. */
export interface BrowserEntryGraphCore {
  schemaVersion: typeof BROWSER_ENTRY_GRAPH_SCHEMA_VERSION;
  kind: typeof BROWSER_ENTRY_GRAPH_KIND;
  status: 'complete';
  producer: BrowserEntryGraphProducer;
  app: BrowserEntryGraphApp;
  element: BrowserEntryGraphElement;
  entry: BrowserEntryGraphEntry;
  islands: BrowserEntryGraphIsland[];
  chunks: BrowserEntryGraphChunk[];
  /** Every module the build's `moduleParsed` hook observed (pre-tree-shake). */
  parsedModuleIds: string[];
}

/** A COMPLETE artifact: the emitted-graph facts plus their predicate summary. */
export interface BrowserEntryGraphArtifact extends BrowserEntryGraphCore {
  predicate: BrowserEntryGraphPredicate;
}

/**
 * A capture that could not be completed. Still emitted (report-only) so the
 * checker can say UNPROVEN instead of the build pretending it has evidence.
 * `reason`/`diagnostics` are stable internal codes — never paths, never
 * messages from the bundler (they can carry machine paths).
 */
export interface BrowserEntryGraphIncompleteArtifact {
  schemaVersion: typeof BROWSER_ENTRY_GRAPH_SCHEMA_VERSION;
  kind: typeof BROWSER_ENTRY_GRAPH_KIND;
  status: 'incomplete';
  reason: string;
  diagnostics: string[];
}

/** What the checker/evaluator concludes about one artifact. */
export type BrowserEntryGraphVerdict = 'MET' | 'VIOLATED' | 'UNPROVEN';

/** The evaluator's verdict plus everything the evidence record needs. */
export interface BrowserEntryGraphEvaluation {
  verdict: BrowserEntryGraphVerdict;
  /** Stable machine code for UNPROVEN; null otherwise. */
  reason: string | null;
  /** Human sentence naming only normalized ids; null when not applicable. */
  detail: string | null;
  violations: BrowserEntryGraphViolation[];
  diagnostics: BrowserEntryGraphDiagnostics;
  parsedOnlyExecutorResidues: string[];
  loadedModuleCount: number;
  chunkCount: number;
  islandCount: number;
  gateListDigest: string | null;
}

/** The three recomputed report sections, shared by writer and evaluator. */
export interface BrowserEntryGraphSummary {
  loadedViolations: BrowserEntryGraphViolation[];
  parsedOnlyExecutorResidues: string[];
  diagnostics: BrowserEntryGraphDiagnostics;
}

/** A stable code for one UNPROVEN cause (used by the CLI and the tests). */
export type BrowserEntryGraphUnprovenReason =
  | 'artifact-not-an-object'
  | 'unsupported-schema-version'
  | 'foreign-kind'
  | 'artifact-incomplete'
  | 'malformed-artifact'
  | 'entry-chunk-missing'
  | 'entry-chunk-ambiguous'
  | 'entry-facade-mismatch'
  | 'entry-not-parsed'
  | 'chunk-facade-not-parsed'
  | 'chunk-reference-dangling'
  | 'chunk-unreachable'
  | 'module-chunk-ambiguous'
  | 'island-attribution-unsure'
  | 'gate-list-drift'
  | 'predicate-summary-mismatch';

/* ────────────────────────────────────────────────────────────────────────── */
/* Id normalization                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** POSIX-separated spelling of a path (the artifact's only separator). */
function toPosixPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

/** Strip one trailing slash (but keep the filesystem root as-is). */
function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Collapse a pnpm virtual-store suffix to the installed package spelling:
 * `node_modules/.pnpm/<id>/node_modules/<pkg>/…` → `<pkg>/…`. The `.pnpm`
 * directory name embeds the dependency version and peer hash, so keeping it
 * would make the artifact depend on the lockfile layout rather than on the
 * module's identity.
 */
function stripPnpmStorePrefix(suffix: string): string {
  if (!suffix.startsWith('.pnpm/')) return suffix;
  const marker = '/node_modules/';
  const nested = suffix.indexOf(marker);
  return nested === -1 ? suffix : suffix.slice(nested + marker.length);
}

/** The nearest enclosing package.json's `name`, walking up (bounded). */
function owningPackageName(file: string): string | undefined {
  let current = dirname(file);
  for (let depth = 0; depth < 16; depth++) {
    const manifest = `${current}/package.json`;
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name !== '') return parsed.name;
      } catch {
        // An unreadable manifest is not a package anchor; keep walking.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/** The nearest enclosing package root directory (where the manifest lives). */
function owningPackageRoot(file: string): string | undefined {
  let current = dirname(file);
  for (let depth = 0; depth < 16; depth++) {
    if (existsSync(`${current}/package.json`)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Normalize one raw bundler module id to the artifact's deterministic,
 * machine-independent spelling:
 *
 * - the style-asset virtual id is decoded (base64url registry key = absolute
 *   sheet path + optional scope tag) and re-anchored through the same path
 *   rule, so the artifact carries `\0oe-style-asset:<workspace path>` and never
 *   the absolute path;
 * - other `\0` virtual ids are kept verbatim only when they are in the frozen
 *   machine-independent set below — an unknown virtual id returns `null`;
 * - an id under a `node_modules` segment keeps only the last install-layout
 *   spelling (`node_modules/<pkg>/…`), with the pnpm store collapsed;
 * - an id under the build's workspace root becomes workspace-relative;
 * - otherwise the nearest package.json gives a `pkg:<name>/<path>` spelling;
 * - anything else returns `null` — the writer must report the artifact as
 *   INCOMPLETE rather than emit an absolute machine path.
 *
 * Query suffixes are stripped (Vite's `?v=`/`?raw` views are the same module);
 * callers treat two raw ids landing on one normalized id as an identity
 * collision and report incomplete rather than guessing.
 */
export function normalizeBrowserEntryGraphModuleId(
  rawId: string,
  workspaceRoot: string,
): string | null {
  if (typeof rawId !== 'string' || rawId === '') return null;
  const queryIndex = rawId.indexOf('?');
  const withoutQuery = queryIndex === -1 ? rawId : rawId.slice(0, queryIndex);
  const id = toPosixPath(withoutQuery);
  if (id === '') return null;
  if (id.startsWith('\0')) return normalizeVirtualModuleIdentity(id, workspaceRoot);
  const normalized = normalizePathIdentity(id, workspaceRoot);
  return normalized !== null && isNormalizedBrowserEntryGraphModuleId(normalized)
    ? normalized
    : null;
}

/**
 * Re-anchor one decoded style-asset registry key (absolute sheet file plus an
 * optional light-root scope tag, NUL-separated) on the same identity rule as
 * every other module id. Returns `null` when the key cannot be placed
 * machine-independently or is not a canonical spelling.
 */
function normalizeStyleAssetRegistryKey(decoded: string, workspaceRoot: string): string | null {
  const separator = decoded.indexOf('\0');
  if (separator !== decoded.lastIndexOf('\0')) return null;
  const filePart = separator === -1 ? decoded : decoded.slice(0, separator);
  const scopeTag = separator === -1 ? null : decoded.slice(separator + 1);
  const queryIndex = filePart.indexOf('?');
  const file = toPosixPath(queryIndex === -1 ? filePart : filePart.slice(0, queryIndex));
  if (file === '') return null;
  let normalizedFile: string | null;
  if (isAbsolute(file)) {
    normalizedFile = normalizePathIdentity(file, workspaceRoot);
  } else {
    normalizedFile = isNormalizedBrowserEntryGraphRelativePath(file) ? file : null;
  }
  if (normalizedFile === null) return null;
  if (scopeTag !== null && !STYLE_SCOPE_TAG.test(scopeTag)) return null;
  return scopeTag === null ? normalizedFile : `${normalizedFile}\0${scopeTag}`;
}

/**
 * Normalize the router client build's style-asset graph id: decode the
 * base64url registry key and publish the canonical, machine-independent
 * spelling. A malformed/undecodable payload or an unplaceable path returns
 * `null` (the writer reports incomplete).
 */
function normalizeStyleAssetVirtualModuleId(id: string, workspaceRoot: string): string | null {
  const body = id.slice(STYLE_ASSET_VIRTUAL_MODULE_PREFIX.length);
  // The canonical spelling is self-describing. The bundler's original spelling
  // is an opaque base64url payload (base64url has no `:`), so the `file:`
  // marker is also how an already-canonical id is told apart from a raw one.
  if (body.startsWith('file:')) {
    return isCanonicalStyleAssetVirtualModuleId(id) ? id : null;
  }
  if (!body.endsWith('.js') || body.length <= '.js'.length) return null;
  const decoded = decodeStrictBase64Url(body.slice(0, -'.js'.length));
  if (decoded === null) return null;
  const key = normalizeStyleAssetRegistryKey(decoded, workspaceRoot);
  if (key === null) return null;
  return `${STYLE_ASSET_VIRTUAL_MODULE_PREFIX}file:${key}`;
}

/** Normalize one virtual id, or `null` when the scheme is unknown/unplaceable. */
function normalizeVirtualModuleIdentity(id: string, workspaceRoot: string): string | null {
  if (id.startsWith(STYLE_ASSET_VIRTUAL_MODULE_PREFIX)) {
    const normalized = normalizeStyleAssetVirtualModuleId(id, workspaceRoot);
    if (normalized === null) return null;
    return isNormalizedBrowserEntryGraphVirtualModuleId(normalized) ? normalized : null;
  }
  return isNormalizedBrowserEntryGraphVirtualModuleId(id) ? id : null;
}

/** The shared absolute-path identity rule (node_modules → workspace → package). */
function normalizePathIdentity(id: string, workspaceRoot: string): string | null {
  const nodeModulesMarker = '/node_modules/';
  if (id.includes(nodeModulesMarker)) {
    const lastIndex = id.lastIndexOf(nodeModulesMarker);
    const suffix = id.slice(lastIndex + nodeModulesMarker.length);
    if (suffix === '') return null;
    const candidate = `node_modules/${stripPnpmStorePrefix(suffix)}`;
    return isNormalizedBrowserEntryGraphRelativePath(candidate) ? candidate : null;
  }

  const workspace = stripTrailingSlash(toPosixPath(workspaceRoot));
  if (workspace !== '' && isAbsolute(id)) {
    const relativePath = toPosixPath(relative(workspace, id));
    if (relativePath !== '' && isNormalizedBrowserEntryGraphRelativePath(relativePath)) {
      return relativePath;
    }
  }

  if (!isAbsolute(id)) {
    // A relative id (rare, but legal for some plugin-supplied modules): accept
    // it only when it is a clean forward-relative spelling.
    return isNormalizedBrowserEntryGraphRelativePath(id) ? id : null;
  }

  const packageRoot = owningPackageRoot(id);
  const packageName = owningPackageName(id);
  if (packageRoot === undefined || packageName === undefined) return null;
  const packageRelative = toPosixPath(relative(packageRoot, id));
  const candidate =
    packageRelative === '' ? `pkg:${packageName}` : `pkg:${packageName}/${packageRelative}`;
  return isNormalizedBrowserEntryGraphRelativePath(candidate) ? candidate : null;
}

/** Strict base64url: a decode/encode round-trip must be byte-identical. */
function decodeStrictBase64Url(payload: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(payload)) return null;
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.toString('base64url') !== payload) return null;
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) return null;
  return decoded;
}

/**
 * A canonical, forward-only relative path: no leading `/` or drive letter, no
 * `./`/`../` prefix, no `.`/`..` segment, no empty segment (`a//b`), no
 * trailing `/`, no backslash, query or control character. The exact-match gate
 * compares strings, so a non-canonical spelling is a bypass attempt by
 * construction (e.g. `packages//element/src/…` would never equal the gate id);
 * the checker rejects the artifact instead of judging a different string.
 */
/**
 * The app-root spelling: a workspace-relative directory, OR `.` when the app IS
 * the workspace root.
 *
 * `.` is the honest value for that case — a published consumer installs the app
 * with no workspace file above it, so `relative(workspaceRoot, root)` is empty
 * and there is no directory name to report. The general path predicate rejects
 * `.` because a MODULE or CHUNK id must name a file; an app root is the one field
 * where "here" is a real location. Without this the capture fails closed as
 * `app-root-outside-workspace` for every installed app, which made P1 undecidable
 * exactly where it matters most.
 */
export function isBrowserEntryGraphAppRoot(value: unknown): value is string {
  if (value === '.') return true;
  return isNormalizedBrowserEntryGraphRelativePath(value);
}

export function isNormalizedBrowserEntryGraphRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  // Control characters (including NUL), backslashes and query suffixes never
  // belong to a canonical artifact path; scan explicitly (a control-character
  // regex is banned repo-wide, and the intent here is a character-class.)
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return false;
  }
  if (value.includes('\\') || value.includes('?')) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return false;
  if (/^[A-Za-z]:/u.test(value)) return false;
  if (value.endsWith('/')) return false;
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  return true;
}

/**
 * Is this a normalized artifact module id — a canonical relative path, or a
 * `\0` virtual id from the frozen machine-independent set (with the known
 * style-asset scheme decoded and canonicalized)? Anything else is malformed.
 */
export function isNormalizedBrowserEntryGraphModuleId(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('\0')) return isNormalizedBrowserEntryGraphVirtualModuleId(value);
  return isNormalizedBrowserEntryGraphRelativePath(value);
}

/**
 * A canonical virtual module id. Unknown `\0` schemes are rejected: a virtual
 * id may embed a machine path (the style-asset scheme does), so publishing an
 * unrecognized one opaque is exactly the leak this contract forbids.
 */
export function isNormalizedBrowserEntryGraphVirtualModuleId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('\0')) return false;
  if (value.startsWith(STYLE_ASSET_VIRTUAL_MODULE_PREFIX)) {
    return isCanonicalStyleAssetVirtualModuleId(value);
  }
  if (VERBATIM_VIRTUAL_MODULES.has(value)) return true;
  if (value.startsWith('\0virtual:')) {
    return VIRTUAL_PLAIN_ID.test(value.slice('\0virtual:'.length));
  }
  for (const root of VIRTUAL_HELPER_ROOTS) {
    if (value.startsWith(root)) {
      return isNormalizedBrowserEntryGraphRelativePath(value.slice(root.length));
    }
  }
  return false;
}

/**
 * The canonical style-asset spelling:
 * `\0oe-style-asset:file:<relative path>[\0<scope tag>]`. The `file:` marker is
 * mandatory: a bare path payload would be indistinguishable from a base64url
 * payload (both are path-safe characters), so an artifact still carrying the
 * bundler's opaque spelling is malformed instead of being read as a path.
 */
function isCanonicalStyleAssetVirtualModuleId(value: string): boolean {
  const body = value.slice(STYLE_ASSET_VIRTUAL_MODULE_PREFIX.length);
  if (!body.startsWith('file:')) return false;
  const key = body.slice('file:'.length);
  if (key === '') return false;
  const separator = key.indexOf('\0');
  if (separator !== key.lastIndexOf('\0')) return false;
  const filePath = separator === -1 ? key : key.slice(0, separator);
  if (!isNormalizedBrowserEntryGraphRelativePath(filePath)) return false;
  if (separator === -1) return true;
  return STYLE_SCOPE_TAG.test(key.slice(separator + 1));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The frozen predicate                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The digest of the frozen executor-entry table. Recorded in every artifact;
 * a checker whose own table hashes differently refuses to judge (UNPROVEN)
 * rather than applying a different claim to the evidence.
 */
export function browserEntryGraphGateListDigest(): string {
  const canonical = JSON.stringify({
    schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
    executorEntry: [...EXECUTOR_ENTRY_RELATIVE_MODULES],
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

/** The executor-entry module ids for a normalized element package root. */
export function executorEntryModuleIds(elementPackageRoot: string): string[] {
  return EXECUTOR_ENTRY_RELATIVE_MODULES.map((modulePath) => `${elementPackageRoot}/${modulePath}`);
}

/**
 * The sibling `@openelement/protocol` package root, derived from the element
 * root's install spelling (both packages sit side by side in the workspace
 * `packages/` directory and in `node_modules/@openelement/`). Only used for
 * the report-only leaf-surface classification; `null` when the layout does not
 * answer, in which case that id simply stays unclassified.
 */
function siblingProtocolPackageRoot(elementPackageRoot: string): string | null {
  const packageRelativeParent = dirname(elementPackageRoot);
  const packageDirectory = elementPackageRoot.slice(elementPackageRoot.lastIndexOf('/') + 1);
  if (packageDirectory !== 'element') return null;
  if (packageRelativeParent === '.' || packageRelativeParent === '') return null;
  return `${toPosixPath(packageRelativeParent)}/protocol`;
}

/**
 * Classify one loaded module id (exact identity against the frozen tables).
 * Report-only categories never gate; `executorEntry` is the only one that can.
 */
export function classifyBrowserEntryGraphModule(
  moduleId: string,
  elementPackageRoot: string,
): BrowserEntryGraphModuleCategory | null {
  if (executorEntryModuleIds(elementPackageRoot).includes(moduleId)) return 'executorEntry';
  const inPackage = (modulePath: string) => moduleId === `${elementPackageRoot}/${modulePath}`;
  if (EXECUTOR_SUPPORT_RELATIVE_MODULES.some((modulePath) => inPackage(modulePath))) {
    return 'executorSupport';
  }
  if (SERVER_PRIVATE_RELATIVE_MODULES.some((modulePath) => inPackage(modulePath))) {
    return 'serverPrivate';
  }
  if (AUTHORING_RELATIVE_MODULES.some((modulePath) => inPackage(modulePath))) return 'authoring';
  if (
    LEAF_SURFACE_RELATIVE_MODULES.some((modulePath) => inPackage(modulePath)) ||
    moduleId.startsWith(`${elementPackageRoot}/${GENERATED_ELEMENT_RELATIVE_PREFIX}`)
  ) {
    return 'leafSurface';
  }
  const protocolRoot = siblingProtocolPackageRoot(elementPackageRoot);
  // The wire grammar is not an executor (M09 boundary, ADR-0174); it is the
  // sanctioned generated path's import target.
  if (protocolRoot !== null && moduleId === `${protocolRoot}/src/part-program.ts`) {
    return 'leafSurface';
  }
  return null;
}

/** Sorted chunk names reachable from `start` over all emitted chunk edges. */
function reachableChunkFiles(
  chunks: readonly BrowserEntryGraphChunk[],
  start: string,
): Set<string> {
  const byFile = new Map<string, BrowserEntryGraphChunk>();
  for (const chunk of chunks) byFile.set(chunk.file, chunk);
  const reached = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    const chunk = byFile.get(file);
    if (chunk === undefined) continue;
    pending.push(...chunk.imports, ...chunk.dynamicImports, ...chunk.implicitlyLoadedBefore);
  }
  return reached;
}

/** Deterministic sort helpers (the artifact is byte-compared across builds). */
function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Recompute the three report sections from a structurally valid core. This is
 * the ONE implementation: the writer stores its result, the evaluator
 * recomputes and compares it, so a drifted summary is caught instead of being
 * trusted.
 */
export function deriveBrowserEntryGraphSummary(
  core: BrowserEntryGraphCore,
): BrowserEntryGraphSummary {
  const reachable = reachableChunkFiles(core.chunks, core.entry.chunkFile);
  const loadedByModule = new Map<string, string>();
  for (const chunk of core.chunks) {
    if (!reachable.has(chunk.file)) continue;
    for (const module of chunk.modules) {
      if (module.renderedLength <= 0) continue;
      loadedByModule.set(module.id, chunk.file);
    }
  }

  const gateIds = new Set(executorEntryModuleIds(core.element.packageRoot));
  const loadedGateIds = [...gateIds].filter((id) => loadedByModule.has(id)).sort(compareStrings);

  const islandClosures = new Map<string, Set<string>>();
  for (const island of core.islands) {
    islandClosures.set(island.tag, reachableChunkFiles(core.chunks, island.chunkFile));
  }

  const loadedViolations: BrowserEntryGraphViolation[] = loadedGateIds.map((moduleId) => {
    const chunkFile = loadedByModule.get(moduleId)!;
    const islands = core.islands
      .filter((island) => islandClosures.get(island.tag)?.has(chunkFile) === true)
      .map((island) => island.tag)
      .sort(compareStrings);
    return { moduleId, chunkFile, islands };
  });

  const parsed = new Set(core.parsedModuleIds);
  const residueSet = new Set<string>();
  for (const gateId of gateIds) {
    if (parsed.has(gateId) && !loadedByModule.has(gateId)) residueSet.add(gateId);
  }

  const diagnostics: BrowserEntryGraphDiagnostics = {
    executorSupport: [],
    serverPrivate: [],
    authoring: [],
    leafSurface: [],
  };
  for (const moduleId of loadedByModule.keys()) {
    const category = classifyBrowserEntryGraphModule(moduleId, core.element.packageRoot);
    if (category === null || category === 'executorEntry') continue;
    diagnostics[category].push(moduleId);
  }
  return {
    loadedViolations,
    parsedOnlyExecutorResidues: sortedUnique(residueSet),
    diagnostics: {
      executorSupport: sortedUnique(diagnostics.executorSupport),
      serverPrivate: sortedUnique(diagnostics.serverPrivate),
      authoring: sortedUnique(diagnostics.authoring),
      leafSurface: sortedUnique(diagnostics.leafSurface),
    },
  };
}

/** Serialize an artifact deterministically (stable JSON, trailing newline). */
export function serializeBrowserEntryGraphArtifact(
  artifact: BrowserEntryGraphArtifact | BrowserEntryGraphIncompleteArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Evaluator                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isNormalizedIdArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => isNormalizedBrowserEntryGraphModuleId(entry))
  );
}

function isNormalizedPathArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => isNormalizedBrowserEntryGraphRelativePath(entry))
  );
}

function unproven(
  reason: BrowserEntryGraphUnprovenReason,
  detail: string,
): BrowserEntryGraphEvaluation {
  return {
    verdict: 'UNPROVEN',
    reason,
    detail,
    violations: [],
    diagnostics: { executorSupport: [], serverPrivate: [], authoring: [], leafSurface: [] },
    parsedOnlyExecutorResidues: [],
    loadedModuleCount: 0,
    chunkCount: 0,
    islandCount: 0,
    gateListDigest: null,
  };
}

/** A bounded human list of normalized ids for a failure detail (never paths). */
function nameIds(ids: readonly string[], limit = 5): string {
  const head = ids.slice(0, limit).join(', ');
  return ids.length > limit ? `${head}, … (${ids.length} total)` : head;
}

interface ParsedChunk {
  file: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports: string[];
  implicitlyLoadedBefore: string[];
  modules: BrowserEntryGraphModule[];
}

interface ParsedIsland {
  tag: string;
  specifier: string;
  moduleId: string;
  strategy: string;
  chunkFile: string;
}

/**
 * Shape validation. Produces the normalized artifact or the first stable
 * UNPROVEN reason. Every rejection is fail-closed: the checker must not judge
 * a document it could not fully understand.
 */
function parseArtifact(
  value: unknown,
):
  | { ok: true; artifact: BrowserEntryGraphArtifact }
  | { ok: false; evaluation: BrowserEntryGraphEvaluation } {
  const malformed = (detail: string) => ({
    ok: false as const,
    evaluation: unproven('malformed-artifact', detail),
  });

  if (!isRecord(value)) {
    return {
      ok: false,
      evaluation: unproven('artifact-not-an-object', 'the artifact is not a JSON object'),
    };
  }
  if (value.schemaVersion !== BROWSER_ENTRY_GRAPH_SCHEMA_VERSION) {
    return {
      ok: false,
      evaluation: unproven(
        'unsupported-schema-version',
        `unsupported schemaVersion (expected ${BROWSER_ENTRY_GRAPH_SCHEMA_VERSION})`,
      ),
    };
  }
  if (value.kind !== BROWSER_ENTRY_GRAPH_KIND) {
    return {
      ok: false,
      evaluation: unproven('foreign-kind', `expected kind "${BROWSER_ENTRY_GRAPH_KIND}"`),
    };
  }
  const status = value.status;
  if (status === 'incomplete') {
    const rawReason = value.reason;
    const reason =
      typeof rawReason === 'string' && /^[A-Za-z0-9._:-]{1,120}$/u.test(rawReason)
        ? rawReason
        : 'unknown-incomplete-reason';
    return {
      ok: false,
      evaluation: unproven(
        'artifact-incomplete',
        `the writer reported an incomplete capture (${reason})`,
      ),
    };
  }
  if (status !== 'complete') return malformed('status must be "complete"');

  const producer = value.producer;
  if (
    !isRecord(producer) ||
    !isNonEmptyString(producer.package) ||
    !isNonEmptyString(producer.version)
  ) {
    return malformed('producer must name a package and a version');
  }
  const app = value.app;
  if (
    !isRecord(app) ||
    !isBrowserEntryGraphAppRoot(app.root) ||
    !isNormalizedBrowserEntryGraphRelativePath(app.outDir) ||
    typeof app.base !== 'string'
  ) {
    return malformed('app must carry a normalized root/outDir and a base string');
  }
  const element = value.element;
  if (
    !isRecord(element) ||
    !isNormalizedBrowserEntryGraphRelativePath(element.packageRoot) ||
    !isNonEmptyString(element.version)
  ) {
    return malformed('element must carry a normalized packageRoot and a version');
  }
  const entry = value.entry;
  if (
    !isRecord(entry) ||
    !isNormalizedBrowserEntryGraphModuleId(entry.moduleId) ||
    !isNormalizedBrowserEntryGraphRelativePath(entry.chunkFile)
  ) {
    return malformed('entry must carry a normalized moduleId and chunkFile');
  }

  const rawIslands = value.islands;
  if (!Array.isArray(rawIslands)) return malformed('islands must be an array');
  const islands: ParsedIsland[] = [];
  const islandTags = new Set<string>();
  for (const item of rawIslands) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.tag) ||
      !isNonEmptyString(item.specifier) ||
      !isNormalizedBrowserEntryGraphModuleId(item.moduleId) ||
      !isNonEmptyString(item.strategy) ||
      !isNormalizedBrowserEntryGraphRelativePath(item.chunkFile)
    ) {
      return malformed('every island needs tag/specifier/moduleId/strategy/chunkFile strings');
    }
    if (islandTags.has(item.tag)) return malformed(`island tag "${item.tag}" is declared twice`);
    islandTags.add(item.tag);
    islands.push({
      tag: item.tag,
      specifier: item.specifier,
      moduleId: item.moduleId,
      strategy: item.strategy,
      chunkFile: item.chunkFile,
    });
  }
  islands.sort(
    (left, right) =>
      compareStrings(left.tag, right.tag) || compareStrings(left.specifier, right.specifier),
  );

  const rawChunks = value.chunks;
  if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
    return malformed('chunks must be a non-empty array');
  }
  const chunks: ParsedChunk[] = [];
  const chunkFiles = new Set<string>();
  for (const item of rawChunks) {
    if (
      !isRecord(item) ||
      !isNormalizedBrowserEntryGraphRelativePath(item.file) ||
      typeof item.isEntry !== 'boolean' ||
      typeof item.isDynamicEntry !== 'boolean' ||
      (item.facadeModuleId !== null &&
        !isNormalizedBrowserEntryGraphModuleId(item.facadeModuleId)) ||
      !isNormalizedPathArray(item.imports) ||
      !isNormalizedPathArray(item.dynamicImports) ||
      !isNormalizedPathArray(item.implicitlyLoadedBefore) ||
      !Array.isArray(item.modules)
    ) {
      return malformed(
        'every chunk needs file/isEntry/isDynamicEntry/facadeModuleId/edges/modules',
      );
    }
    if (chunkFiles.has(item.file)) return malformed(`chunk file "${item.file}" is emitted twice`);
    chunkFiles.add(item.file);
    const modules: BrowserEntryGraphModule[] = [];
    const moduleIds = new Set<string>();
    for (const moduleRecord of item.modules) {
      if (
        !isRecord(moduleRecord) ||
        !isNormalizedBrowserEntryGraphModuleId(moduleRecord.id) ||
        typeof moduleRecord.renderedLength !== 'number' ||
        !Number.isInteger(moduleRecord.renderedLength) ||
        moduleRecord.renderedLength < 0
      ) {
        return malformed(
          'every module needs a normalized id and a non-negative integer renderedLength',
        );
      }
      if (moduleIds.has(moduleRecord.id)) {
        return malformed(`module "${moduleRecord.id}" is listed twice in chunk "${item.file}"`);
      }
      moduleIds.add(moduleRecord.id);
      modules.push({ id: moduleRecord.id, renderedLength: moduleRecord.renderedLength });
    }
    chunks.push({
      file: item.file,
      isEntry: item.isEntry,
      isDynamicEntry: item.isDynamicEntry,
      facadeModuleId: item.facadeModuleId as string | null,
      imports: sortedUnique(item.imports),
      dynamicImports: sortedUnique(item.dynamicImports),
      implicitlyLoadedBefore: sortedUnique(item.implicitlyLoadedBefore),
      modules,
    });
  }
  chunks.sort((left, right) => compareStrings(left.file, right.file));

  if (!isNormalizedIdArray(value.parsedModuleIds)) {
    return malformed('parsedModuleIds must be an array of normalized module ids');
  }
  const parsedModuleIds = sortedUnique(value.parsedModuleIds);

  const predicate = value.predicate;
  if (!isRecord(predicate) || typeof predicate.gateListDigest !== 'string') {
    return malformed('predicate must carry gateListDigest');
  }
  if (
    !Array.isArray(predicate.executorEntry) ||
    !predicate.executorEntry.every(isNormalizedBrowserEntryGraphModuleId)
  ) {
    return malformed('predicate.executorEntry must be an array of normalized module ids');
  }
  if (!Array.isArray(predicate.loadedViolations)) {
    return malformed('predicate.loadedViolations must be an array');
  }
  const loadedViolations: BrowserEntryGraphViolation[] = [];
  for (const violation of predicate.loadedViolations) {
    if (
      !isRecord(violation) ||
      !isNormalizedBrowserEntryGraphModuleId(violation.moduleId) ||
      !isNormalizedBrowserEntryGraphRelativePath(violation.chunkFile) ||
      !Array.isArray(violation.islands) ||
      !violation.islands.every(isNonEmptyString)
    ) {
      return malformed('predicate.loadedViolations entries need moduleId/chunkFile/islands');
    }
    loadedViolations.push({
      moduleId: violation.moduleId,
      chunkFile: violation.chunkFile,
      islands: sortedUnique(violation.islands),
    });
  }
  loadedViolations.sort(
    (left, right) =>
      compareStrings(left.moduleId, right.moduleId) ||
      compareStrings(left.chunkFile, right.chunkFile),
  );
  if (!isNormalizedIdArray(predicate.parsedOnlyExecutorResidues)) {
    return malformed('predicate.parsedOnlyExecutorResidues must be an array of normalized ids');
  }
  const diagnostics = predicate.diagnostics;
  if (
    !isRecord(diagnostics) ||
    !isNormalizedIdArray(diagnostics.executorSupport) ||
    !isNormalizedIdArray(diagnostics.serverPrivate) ||
    !isNormalizedIdArray(diagnostics.authoring) ||
    !isNormalizedIdArray(diagnostics.leafSurface)
  ) {
    return malformed('predicate.diagnostics must carry four normalized id arrays');
  }

  return {
    ok: true,
    artifact: {
      schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
      kind: BROWSER_ENTRY_GRAPH_KIND,
      status: 'complete',
      producer: { package: producer.package, version: producer.version },
      app: { root: app.root, outDir: app.outDir, base: app.base },
      element: { packageRoot: element.packageRoot, version: element.version },
      entry: { moduleId: entry.moduleId, chunkFile: entry.chunkFile },
      islands,
      chunks,
      parsedModuleIds,
      predicate: {
        gateListDigest: predicate.gateListDigest,
        executorEntry: [...predicate.executorEntry],
        loadedViolations,
        parsedOnlyExecutorResidues: sortedUnique(predicate.parsedOnlyExecutorResidues),
        diagnostics: {
          executorSupport: sortedUnique(diagnostics.executorSupport),
          serverPrivate: sortedUnique(diagnostics.serverPrivate),
          authoring: sortedUnique(diagnostics.authoring),
          leafSurface: sortedUnique(diagnostics.leafSurface),
        },
      },
    },
  };
}

/** Do two summary objects claim exactly the same thing (after normalization)? */
function summariesEqual(left: BrowserEntryGraphSummary, right: BrowserEntryGraphSummary): boolean {
  const key = (summary: BrowserEntryGraphSummary) =>
    JSON.stringify({
      loadedViolations: summary.loadedViolations,
      parsedOnlyExecutorResidues: [...summary.parsedOnlyExecutorResidues].sort(compareStrings),
      diagnostics: {
        executorSupport: [...summary.diagnostics.executorSupport].sort(compareStrings),
        serverPrivate: [...summary.diagnostics.serverPrivate].sort(compareStrings),
        authoring: [...summary.diagnostics.authoring].sort(compareStrings),
        leafSurface: [...summary.diagnostics.leafSurface].sort(compareStrings),
      },
    });
  return key(left) === key(right);
}

/**
 * Evaluate one browser-entry-graph artifact (already-parsed JSON value).
 *
 * Returns the P1 verdict for **this artifact alone**:
 * `MET` when no executor-entry module is actually loaded by the emitted
 * entry graph; `VIOLATED` when at least one is; `UNPROVEN` when the artifact
 * cannot carry the claim (missing hook capture, malformed shape, dangling
 * chunk graph, unreachable chunk, ambiguous module identity, drifted gate
 * list, or a self-inconsistent summary). Report-only categories never change
 * the verdict.
 *
 * The evaluator is read-only and never throws for bad input.
 */
export function evaluateBrowserEntryGraphArtifact(value: unknown): BrowserEntryGraphEvaluation {
  const parsed = parseArtifact(value);
  if (!parsed.ok) return parsed.evaluation;
  const artifact = parsed.artifact;

  const chunksByFile = new Map<string, ParsedChunk>();
  for (const chunk of artifact.chunks) chunksByFile.set(chunk.file, chunk);

  const entryChunk = chunksByFile.get(artifact.entry.chunkFile);
  if (entryChunk === undefined) {
    return unproven(
      'entry-chunk-missing',
      `the entry chunk "${artifact.entry.chunkFile}" is not in the emitted chunk list`,
    );
  }
  const entryCandidates = artifact.chunks.filter((chunk) => chunk.isEntry);
  if (entryCandidates.length !== 1) {
    return unproven(
      'entry-chunk-ambiguous',
      `exactly one chunk must be the build entry; found ${entryCandidates.length}`,
    );
  }
  if (entryCandidates[0]!.file !== entryChunk.file) {
    return unproven(
      'entry-facade-mismatch',
      `entry.chunkFile names "${entryChunk.file}" but the build entry is "${entryCandidates[0]!.file}"`,
    );
  }
  if (!entryChunk.isEntry) {
    return unproven(
      'entry-facade-mismatch',
      `entry chunk "${entryChunk.file}" is not flagged isEntry`,
    );
  }
  if (entryChunk.facadeModuleId !== artifact.entry.moduleId) {
    return unproven(
      'entry-facade-mismatch',
      `entry chunk facade "${entryChunk.facadeModuleId ?? '(none)'}" does not match entry.moduleId "${artifact.entry.moduleId}"`,
    );
  }

  const parsedIds = new Set(artifact.parsedModuleIds);
  if (!parsedIds.has(artifact.entry.moduleId)) {
    return unproven(
      'entry-not-parsed',
      `the entry module "${artifact.entry.moduleId}" is absent from parsedModuleIds — the parse capture is incomplete`,
    );
  }
  const unparsedFacades = artifact.chunks
    .map((chunk) => chunk.facadeModuleId)
    .filter((facade): facade is string => facade !== null && !parsedIds.has(facade));
  if (unparsedFacades.length > 0) {
    return unproven(
      'chunk-facade-not-parsed',
      `chunk facade module(s) absent from parsedModuleIds: ${nameIds(sortedUnique(unparsedFacades))}`,
    );
  }

  // Chunk edges must resolve: a dangling edge means the artifact's chunk list
  // is not the emitted graph, so neither reachability nor the loaded set can
  // be trusted.
  const dangling: string[] = [];
  const resolvedEdge = (from: string, to: string) => {
    if (!chunksByFile.has(to)) dangling.push(`${from} -> ${to}`);
  };
  for (const chunk of artifact.chunks) {
    for (const to of chunk.imports) resolvedEdge(chunk.file, to);
    for (const to of chunk.dynamicImports) resolvedEdge(chunk.file, to);
    for (const to of chunk.implicitlyLoadedBefore) resolvedEdge(chunk.file, to);
  }
  for (const island of artifact.islands) resolvedEdge('island', island.chunkFile);
  if (dangling.length > 0) {
    return unproven(
      'chunk-reference-dangling',
      `chunk reference(s) name a chunk that is not in the artifact: ${nameIds(sortedUnique(dangling))}`,
    );
  }

  const reachable = reachableChunkFiles(artifact.chunks, artifact.entry.chunkFile);
  const unreachable = artifact.chunks.filter((chunk) => !reachable.has(chunk.file));
  if (unreachable.length > 0) {
    return unproven(
      'chunk-unreachable',
      `emitted chunk(s) are unreachable from the entry chunk: ${nameIds(unreachable.map((chunk) => chunk.file))}`,
    );
  }

  // One module belongs to exactly one chunk. A module id in two chunks is an
  // ambiguous identity — loaded-set membership would depend on iteration
  // order, so the artifact cannot prove either direction.
  const moduleChunks = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const chunk of artifact.chunks) {
    for (const module of chunk.modules) {
      const existing = moduleChunks.get(module.id);
      if (existing !== undefined && existing !== chunk.file) ambiguous.add(module.id);
      else moduleChunks.set(module.id, chunk.file);
    }
  }
  if (ambiguous.size > 0) {
    return unproven(
      'module-chunk-ambiguous',
      `module id(s) appear in more than one chunk: ${nameIds(sortedUnique(ambiguous))}`,
    );
  }

  // Island attribution must be provable: a declared island whose module is not
  // a rendered module of the chunk the artifact attributes means the writer
  // could not resolve the island identity; report incomplete, never pass.
  const unsureIslands: string[] = [];
  for (const island of artifact.islands) {
    const moduleChunk = moduleChunks.get(island.moduleId);
    const rendered = artifact.chunks
      .find((chunk) => chunk.file === moduleChunk)
      ?.modules.find((module) => module.id === island.moduleId)?.renderedLength;
    if (moduleChunk === undefined || moduleChunk !== island.chunkFile || (rendered ?? 0) <= 0) {
      unsureIslands.push(`${island.tag} (${island.moduleId})`);
    }
  }
  if (unsureIslands.length > 0) {
    return unproven(
      'island-attribution-unsure',
      `island identity could not be confirmed against the emitted graph: ${nameIds(unsureIslands)}`,
    );
  }

  const gateIds = executorEntryModuleIds(artifact.element.packageRoot);
  const digest = browserEntryGraphGateListDigest();
  if (artifact.predicate.gateListDigest !== digest) {
    return unproven(
      'gate-list-drift',
      `the artifact was written against a different executor-entry table (digest mismatch: expected ${digest})`,
    );
  }
  if (
    artifact.predicate.executorEntry.length !== gateIds.length ||
    artifact.predicate.executorEntry.some((id, index) => id !== gateIds[index])
  ) {
    return unproven(
      'gate-list-drift',
      "predicate.executorEntry does not name this revision's executor-entry table for the artifact's element package root",
    );
  }

  const summary = deriveBrowserEntryGraphSummary(artifact);
  const declared: BrowserEntryGraphSummary = {
    loadedViolations: artifact.predicate.loadedViolations,
    parsedOnlyExecutorResidues: artifact.predicate.parsedOnlyExecutorResidues,
    diagnostics: artifact.predicate.diagnostics,
  };
  if (!summariesEqual(summary, declared)) {
    return unproven(
      'predicate-summary-mismatch',
      "the writer's predicate summary disagrees with the one recomputed from the artifact's chunk facts",
    );
  }

  const loadedModuleCount = new Set(
    artifact.chunks.flatMap((chunk) =>
      chunk.modules.filter((module) => module.renderedLength > 0).map((module) => module.id),
    ),
  ).size;

  return {
    verdict: summary.loadedViolations.length > 0 ? 'VIOLATED' : 'MET',
    reason: null,
    detail: null,
    violations: summary.loadedViolations,
    diagnostics: summary.diagnostics,
    parsedOnlyExecutorResidues: summary.parsedOnlyExecutorResidues,
    loadedModuleCount,
    chunkCount: artifact.chunks.length,
    islandCount: artifact.islands.length,
    gateListDigest: digest,
  };
}
