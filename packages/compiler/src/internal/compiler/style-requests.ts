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
 * importing module's directory plus the sheet's file name), the same id the
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
}

const requests = new Map<string, RegisteredStyleRequest>();
/** Second index: which importing modules carry edges (the intercept's gate). */
const importers = new Set<string>();

/** Register one generated edge (idempotent per module id — recompiles overwrite). */
export function registerStyleRequest(request: RegisteredStyleRequest): void {
  requests.set(request.moduleId, request);
  importers.add(cleanImporterId(request.importer));
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
  return [...requests.values()].filter((request) => request.moduleId === clean);
}

/** Drop every registered edge (a build's bookkeeping is its own lifetime). */
export function clearStyleRequests(): void {
  requests.clear();
  importers.clear();
}

function cleanImporterId(importerId: string): string {
  return importerId.split('?', 1)[0]!;
}

/**
 * The registry key for one authored edge: the importing module's directory
 * plus the specifier's file name — the sheet file's own path. Query suffixes
 * on the importer id (dev-time cache busting) never change the directory, so
 * recompiles re-register under one key.
 */
export function styleRequestModuleId(importerId: string, specifier: string): string {
  const clean = cleanImporterId(importerId);
  const directory = clean.slice(0, clean.lastIndexOf('/'));
  const file = specifier.slice(specifier.lastIndexOf('/') + 1);
  return `${directory}/${file}`;
}

/**
 * The sheet file's absolute path for one authored edge: the importing
 * module's directory joined with the authored specifier. Relative specifiers
 * only (the compiler refuses bare ones), so the join is total.
 */
export function styleRequestFile(importerId: string, specifier: string): string {
  const clean = cleanImporterId(importerId);
  const directory = clean.slice(0, clean.lastIndexOf('/'));
  return `${directory}/${specifier.replace(/^\.\//, '')}`;
}
