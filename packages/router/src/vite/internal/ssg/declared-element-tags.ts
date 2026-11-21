/**
 * The declared-tag provider for the generated-element site resolver.
 *
 * An island's tag is its file path's (`pathToTagName`) and a package
 * component's is its manifest declaration. A page-local component under a
 * directory neither convention owns — `app/site-ui/open-artifact-panel.tsx` is
 * the reference case — had no tag source at all, so
 * `createGeneratedElementSiteResolver` declined it and the lane never emitted
 * an element.
 *
 * The authored fix is the sidecar's explicit `tag`
 * (`export const openElement = defineIslandConfig({ tag: 'open-artifact-panel' })`).
 * This module turns those declarations into the `moduleId -> tag` map the
 * resolver takes as its second source.
 *
 * NO NEW TRAVERSAL: the reachability walk is `walkModuleGraph`, the same
 * resolver-driven walk the static-component discovery, the package-admission
 * derivation and the route style-link pass already use. And no new sidecar
 * reader: each candidate source is read with `readIslandConfig`, the one static
 * parser the island scan owns, so the two readers cannot disagree about the
 * accepted shape or the accepted tag spelling.
 *
 * Bounded on purpose:
 *
 * - only modules inside the application root contribute. A package module's
 *   identity is its manifest declaration, which outranks every local source; an
 *   intra-package sidecar tag is not this provider's business.
 * - island modules do not need an entry: the path convention already derives
 *   their tag, and `scanIslandMeta` refuses a declared tag that disagrees with
 *   it. Adding them here would be a second parse of a file the scan just read.
 * - a module whose sidecar cannot be read or parsed contributes nothing and is
 *   REPORTED (a note, never a silent drop). The transform stays the
 *   authoritative reporter for a malformed sidecar it actually compiles.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative, isAbsolute } from 'pathe';
import { stableModuleId } from '@openelement/compiler';
import {
  walkModuleGraph,
  type ModuleWalkDiagnostic,
  type ModuleWalkResolver,
} from '../module-graph-walk.ts';
import { readComponentDeclaration } from '../component-declaration.ts';
import { resolveGeneratedElementHost } from './generated-element-host-metadata.ts';

/** Stable code for a note this pass owns (a malformed sidecar it skipped). */
export const DeclaredElementTagScanCode = {
  /** A module carrying the sidecar marker could not be parsed by the scan. */
  SIDECAR_UNREADABLE: 'OE_DECLARED_TAG_SIDECAR_UNREADABLE',
  /** The discovery walk stopped at its module bound (a partial map). */
  MODULE_BOUND_EXCEEDED: 'OE_DECLARED_TAG_MODULE_BOUND_EXCEEDED',
} as const;

export interface ScanDeclaredElementTagsInput {
  /**
   * The application root (absolute) — the stable-module-id anchor AND the
   * containment bound: only modules under it are candidates.
   */
  readonly root: string;
  /** The workspace root used as the second identity anchor. */
  readonly workspaceRoot?: string;
  /** The BUNDLER's resolver, as every other discovery pass uses. */
  readonly resolve: ModuleWalkResolver;
  /** Absolute seed module paths (page routes, islands, layout modules). */
  readonly seeds: Iterable<string>;
  /**
   * The discovery walk's module bound, forwarded to `walkModuleGraph`; the
   * explicit field exists so a truncated walk is testable.
   */
  readonly maxModules?: number;
}

export interface ScanDeclaredElementTagsResult {
  /** The declared tags, keyed by the same stable id the transform derives. */
  readonly tags: ReadonlyMap<string, string>;
  /**
   * The compiler-emitted SSR host producer export name, for the declared
   * modules the generated lane actually emits one for (`<Name>__ssrHost`), keyed
   * by the same stable module id.
   *
   * A module that declares a tag but emits no host producer (a LIGHT root: no
   * DSD wrapper by design) has no entry here — absence is the law, not an
   * error. The name is the compiler's return value, never a `${X}__ssrHost`
   * convention: re-deriving it is the drift ADR-0182 forbids.
   */
  readonly hostExports: ReadonlyMap<string, string>;
  /**
   * What the walk or the sidecar read could not do, in walk order. Every entry
   * is reported through the build-diagnostics envelope by the caller.
   */
  readonly notes: ReadonlyArray<ModuleWalkDiagnostic>;
}

/** Is `candidate` inside `root`? (Same containment rule the class scanners use.) */
function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * Read every reachable in-project `.tsx` module's declared sidecar tag into one
 * `moduleId -> tag` map. Nothing is imported or executed: the walk asks the
 * bundler for edges and the sidecar parser reads literal text.
 */
export async function scanDeclaredElementTags(
  input: ScanDeclaredElementTagsInput,
): Promise<ScanDeclaredElementTagsResult> {
  const { root } = input;
  // A seed the app no longer has on disk is not this pass's failure to report:
  // the route/island scan already owns that verdict, and a walk over a missing
  // seed would add a second, less precise unreadable note for the same file.
  const seeds = [...input.seeds].filter((seed) => existsSync(seed));
  const walk = await walkModuleGraph(input.resolve, seeds, {
    maxModules: input.maxModules,
  });
  const notes: ModuleWalkDiagnostic[] = [];
  if (walk.truncated) {
    notes.push({
      code: DeclaredElementTagScanCode.MODULE_BOUND_EXCEEDED,
      message:
        'The declared-tag scan stopped at its module bound; some page-local components may ' +
        'be missing from the map (reported, never silent).',
    });
  }
  notes.push(...walk.diagnostics);
  const tags = new Map<string, string>();
  const hostExports = new Map<string, string>();
  for (const file of walk.files) {
    // The generated lane is a TSX lane (`compileGeneratedElementIfAdmitted`
    // refuses a non-TSX id), and a package module's identity is its manifest.
    if (!file.endsWith('.tsx')) continue;
    if (!inside(root, file)) continue;
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      notes.push({
        code: DeclaredElementTagScanCode.SIDECAR_UNREADABLE,
        file,
        message: `the module could not be read (${
          error instanceof Error ? error.message : String(error)
        }), so a sidecar tag it may declare is not admitted`,
      });
      continue;
    }
    // ONE reader for the authored sidecar (component-declaration.ts): the same
    // answer the island scan, the static-component scan and the style walk get,
    // so a module cannot be a component for one pass and a plain module for
    // another. The reader owns the text prefilter too.
    const reading = readComponentDeclaration(source);
    if (reading.kind === 'absent') continue;
    if (reading.kind === 'invalid') {
      notes.push({
        code: DeclaredElementTagScanCode.SIDECAR_UNREADABLE,
        file,
        message:
          `the sidecar could not be read (${reading.reason}), so its declared tag is not ` +
          'admitted; the transform reports the authored diagnostic when it compiles this module',
      });
      continue;
    }
    const declaration = reading.declaration;
    if (declaration.tag === undefined) continue;
    const moduleId = stableModuleId(file, root, input.workspaceRoot);
    tags.set(moduleId, declaration.tag);
    // The generated-host identity is resolved from the SAME source this loop
    // already read, through the SAME compiler entry the island scan uses. A
    // refusal or a lane decline is not this pass's diagnostic to report (the
    // transform owns the authored refusal); it simply contributes no host.
    const identity = resolveGeneratedElementHost({
      source,
      moduleId,
      filePath: file,
      root: declaration.root,
      site: { tag: declaration.tag },
    });
    if (identity.kind === 'producer') hostExports.set(moduleId, identity.ssrHostExport);
  }
  return { tags, hostExports, notes };
}
