/**
 * Style-edge request channel (#1558).
 *
 * The compiler never writes files (three-owner seam split, #1553 §1): a
 * compiled module's `.css` imports become registered style edges, and the
 * host build's style-asset plugin intercepts those edges and owns the emitted
 * `.css` artifacts — `emitFile`, content hash, adapter. The sheet's bytes live
 * in exactly one place, the authored file (P6): no registry entry carries CSS
 * text. This registry is how an edge travels from the compiled-element
 * transform (the one writer) to the intercepting plugin (the one reader)
 * within a build process — keyed by the edge's resolved module id (the
 * importing module's directory plus the sheet's file name, plus the
 * component's light-root scope tag when it has one), the same id the
 * bundler's resolver lands on. A `.css` import from a module with no
 * registered edges is a plain app stylesheet and rides vite's own CSS
 * channel; a `.css` import from a tracked module with no edge entry is a
 * defect and fails closed at the intercept.
 */

/** One registered style edge: the authored import's build-graph coordinates. */
export interface RegisteredStyleRequest {
  /** Resolved edge module id — the registry key, and what resolveId answers. */
  readonly moduleId: string;
  /** The importing module's id as the build graph tracks it. */
  readonly importer: string;
  /** The authored `.css` specifier the generated module imports verbatim. */
  readonly specifier: string;
  /** The sheet file's absolute path — where the intercepting build reads the bytes. */
  readonly file: string;
  /**
   * The light-root component tag this edge's emitted asset is scoped to
   * (alpha15 S lane, S-C1.2). A light root has no shadow boundary, so its
   * sheets leave the build wrapped in native `@scope (<tag>)`; the tag is
   * therefore part of the edge's identity, not a detail of its bytes — two
   * components sharing one sheet file are two resources with two scopes.
   * Absent for a shadow-root edge, whose bytes ship exactly as authored.
   */
  readonly scopeTag?: string;
}

const requests = new Map<string, RegisteredStyleRequest>();
/** Second index: which importing modules carry edges (the intercept's gate). */
const importers = new Set<string>();
/**
 * Third index: the light-root scope tag an importing module's edges carry.
 * The intercept resolves a `.css` import from `(importer, specifier)` alone,
 * so the scope must be readable from the importer — the registry key and the
 * intercept's key derivation would otherwise disagree.
 */
const importerScopes = new Map<string, string>();

/** Register one generated edge (idempotent per module id — recompiles overwrite). */
export function registerStyleRequest(request: RegisteredStyleRequest): void {
  requests.set(request.moduleId, request);
  const importer = cleanImporterId(request.importer);
  importers.add(importer);
  // One fact per importer: a module compiles one component, so a recompile
  // that stops being a light root must drop the stale scope rather than keep
  // scoping its sheets.
  if (request.scopeTag === undefined) importerScopes.delete(importer);
  else importerScopes.set(importer, request.scopeTag);
}

/** The edge a resolved sheet module id carries, if any. */
export function getStyleRequest(moduleId: string): RegisteredStyleRequest | undefined {
  return requests.get(moduleId);
}

/** True when the importing module has registered edges (query suffixes ignored). */
export function hasStyleImporter(importerId: string): boolean {
  return importers.has(cleanImporterId(importerId));
}

/** Every edge whose sheet file is the given path — the dev HMR reverse lookup. */
export function styleEdgesForFile(file: string): RegisteredStyleRequest[] {
  const clean = file.split('?', 1)[0]!;
  // The sheet file, not the registry key: a light-root edge's key carries the
  // scope tag, and an HMR lookup for the edited sheet must still find it.
  return [...requests.values()].filter((request) => request.file === clean);
}

/**
 * Every edge one importing module declared. The host build uses it to emit the
 * style resources of modules it admitted for their edges alone (S-C1.4: a Page
 * or Layout the server renders and no island imports).
 */
export function styleRequestsForImporter(importerId: string): RegisteredStyleRequest[] {
  const clean = importerId.split('?', 1)[0]!;
  return [...requests.values()].filter((request) => request.importer === clean);
}

/** Drop every registered edge (a build's bookkeeping is its own lifetime). */
export function clearStyleRequests(): void {
  requests.clear();
  importers.clear();
  importerScopes.clear();
}

function cleanImporterId(importerId: string): string {
  return importerId.split('?', 1)[0]!;
}

/**
 * The separator between a sheet file and the light-root scope tag in one
 * edge's registry key. `\0` can never appear in a path or a tag name, so a
 * scoped key can never collide with a plain file key.
 */
const SCOPE_KEY_SEPARATOR = '\0';

/**
 * The registry key for one authored edge: the sheet file's resolved path,
 * plus the importing component's light-root scope tag when it has one. Query
 * suffixes on the importer id (dev-time cache busting) are stripped, so
 * recompiles re-register under one key; the full relative path keeps
 * same-named sheets in sibling subdirectories distinct edges. The scope
 * tag rides the key because the emitted asset is a different resource per
 * scope: a light root's sheet is served wrapped in `@scope (<tag>)`.
 *
 * Registering an edge passes the tag explicitly (the caller is the compile
 * that just proved it); the intercept resolves a `.css` import from
 * `(importer, specifier)` alone, so it reads the same fact back through the
 * importer index. Both paths land on one key for one edge, and a disagreement
 * can only fail closed at the intercept — never emit an unscoped asset.
 */
export function styleRequestModuleId(
  importerId: string,
  specifier: string,
  scopeTag?: string,
): string {
  // The key must carry the specifier's full relative path. The former
  // directory-plus-filename form collapsed `./a/style.css` and
  // `./b/style.css` from one importer onto a single key, so the later edge
  // silently overwrote the first in the registry and both virtual edges
  // resolved to the last-registered file.
  const file = styleRequestFile(importerId, specifier);
  const scope = scopeTag ?? importerScopes.get(cleanImporterId(importerId));
  return scope === undefined ? file : `${file}${SCOPE_KEY_SEPARATOR}${scope}`;
}

/**
 * The light-root scope tag of a compiled Part Program — undefined for a
 * shadow-root program, whose sheets ship exactly as authored (they already
 * have a boundary). One reader for the fact, shared by both host bindings of
 * the compiled-element transform (the build plugin and the dev/HMR plugin)
 * and by the compiled-artifact read.
 */
export function lightRootScopeTag(program: unknown): string | undefined {
  const candidate = program as { tag?: unknown; root?: { kind?: unknown } } | null | undefined;
  const tag = candidate?.tag;
  if (typeof tag !== 'string' || tag === '') return undefined;
  return candidate?.root?.kind === 'light' ? tag : undefined;
}

/**
 * The sheet file's absolute path for one authored edge: the importing
 * module's directory joined with the authored specifier. Relative specifiers
 * only (the compiler refuses bare ones), so the join is total. Parent
 * segments (`../theme.css`) resolve lexically against the directory — the key
 * must be the path the bundler's resolver lands on, never a verbatim `..`
 * id no lookup can match.
 */
export function styleRequestFile(importerId: string, specifier: string): string {
  const clean = cleanImporterId(importerId);
  const segments = clean.slice(0, clean.lastIndexOf('/')).split('/');
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}
