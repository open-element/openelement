/**
 * @openelement/router — the generated Native Custom Element site fact (M09-1b).
 *
 * The compiler transform runs at `enforce: 'pre'`, before this package's island
 * transform (`island-transform.ts`), so the compiler cannot see `__tagName` and
 * cannot derive a tag. The host therefore supplies the one site fact the
 * generated-element lane needs: the tag the island pipeline will register.
 *
 * This module is the ONE producer of that fact, and it resolves the tag from
 * three sources in explicit-identity-first order: a package manifest's
 * declaration, the sidecar's authored `tag` (the declared-tag provider built by
 * the island scan, `internal/ssg/declared-element-tags.ts`), then the islands
 * directory. The first two are authored identities — a package manifest is the
 * most explicit published one, and a declared tag is the author stating the
 * fact — while the third is the path convention. A module no convention owns
 * (a page-local component under `app/site-ui/`) is therefore admitted only
 * through its own sidecar, never through a second path-identity rule.
 *
 * Where the path source comes from: it reuses the island transform's own path
 * admission and tag derivation (`transformIslandSource`, which uses
 * `normalizeSeparators` + `pathToTagName`) instead of re-deriving a second tag
 * source, so an emitted element and its client entry can never disagree about
 * the tag. The layout admission is deliberately NOT included: the layout tag is
 * the router constant `CONVENTION_LAYOUT_TAG`, not a `pathToTagName`
 * derivation, and the layout is outside the M09-1 site (design §2.4).
 *
 * The site fact only admits a module to the lane, and it carries the TAG ONLY.
 * The lane itself still requires the island sidecar
 * (`export const openElement = defineIslandConfig({…})`), a local
 * default-exported function component, and reads the platform facts from that
 * same sidecar — the descriptor root, `delegatesFocus`, `formAssociated` and
 * the `properties` table (D-root-source / M09-2a / M09-2d) — so this host fact
 * can never pin a root the source no longer declares. The lane fails closed on
 * a props parameter that no declared `properties` table replaces, and on a
 * required host binding; those gates live in the compiler's generated-element
 * site admission, not here.
 *
 * Call-site map — exactly three real sites, do not add a fourth:
 *
 * 1. `cli/build-client.ts` — the inline client build's `compiledElementPlugin`.
 * 2. `cli/build-ssg.ts` — the inline SSG build's `compiledElementPlugin`.
 * 3. `vite/plugin-hmr.ts` — the dev transform (`createCompilerHooks`) and its
 *    HMR shape comparison; the dev host calls the lane entry directly because
 *    it is not the Vite plugin.
 *
 * The two scanners that compile modules only to read class facts
 * (`internal/collect-shadow-candidates.ts`, `internal/style-assets.ts`)
 * intentionally do not run the generated lane: the function lane's CE output
 * carries no class program to scan.
 */

import { createRequire } from 'node:module';
import {
  normalizeSeparators,
  pathToTagName,
  transformIslandSource,
} from '@openelement/element/build-utils';
import { basename, relative, resolve } from 'pathe';
import { mdxVirtualSourcePath } from './internal/component-declaration.ts';
import { stableModuleId, type GeneratedElementSite } from '@openelement/compiler';
import type { IslandDecl } from '@openelement/protocol/ssg';
import { islandStyleDeclarationFor } from './internal/island-style-declarations.ts';

/** One island module's registration site, or null when the module is not one. */
export type GeneratedElementSiteResolver = (moduleId: string) => GeneratedElementSite | null;

/**
 * The package-side facts this module needs: the declaration's tag and the
 * `openElement.module` specifier the island pipeline already ships.
 */
export type PackageIslandSiteDeclaration = Pick<IslandDecl, 'tagName' | 'modulePath' | 'source'>;

export interface PackageIslandSiteOptions {
  /** The app root the host anchors stable module ids on. */
  readonly root: string;
  /** The workspace root used as the second identity anchor. */
  readonly workspaceRoot?: string;
}

/**
 * Resolve the `source: 'package'` island declarations to the host's own stable
 * module ids (`stableModuleId` of the Node-resolved module file), so the
 * generated-element site fact can admit a workspace/installed package module.
 *
 * This is the package half of the site fact and it stays a CONSUMER of the
 * declaration list: the tag still comes from the package manifest declaration
 * (`buildPackageIslandDecls`), never from a path derivation, so a package
 * module and its local counterpart cannot produce two different tags.
 *
 * Resolution is Node's (the package's own `exports` map), anchored on the app
 * root: a specifier the host cannot resolve is skipped rather than guessed —
 * an unresolvable package island is already a coded failure in the island
 * pipeline, and the generated lane must not invent a tag for it.
 */
export function collectPackageIslandModuleSites(
  declarations: readonly PackageIslandSiteDeclaration[],
  options: PackageIslandSiteOptions,
): ReadonlyMap<string, string> {
  const requireFromRoot = createRequire(`${options.root}/package.json`);
  const sites = new Map<string, string>();
  for (const declaration of declarations) {
    if (declaration.source !== 'package') continue;
    const specifier = declaration.modulePath;
    if (specifier === undefined || specifier === '') continue;
    let resolved: string;
    try {
      resolved = requireFromRoot.resolve(specifier);
    } catch {
      continue;
    }
    sites.set(stableModuleId(resolved, options.root, options.workspaceRoot), declaration.tagName);
  }
  return sites;
}

/** A precomputed map, or a lazy provider the dev host re-reads after its scan. */
export type PackageIslandSiteFacts =
  | ReadonlyMap<string, string>
  | (() => ReadonlyMap<string, string> | undefined);

/**
 * Build the site closure once per host (one build, one dev server), over the
 * resolved `islandsDir`.
 *
 * `moduleId` is the host's stable module id — the same id the compiler plugin
 * derives with `stableModuleId` — so a project-relative path like
 * `app/islands/profile-card.tsx` answers `{ tag: 'profile-card' }`. An absolute
 * id is admitted only when it still carries the `islandsDir` segment, exactly
 * as the island transform would admit it. A workspace/installed package module
 * is admitted through `packageSites` (see `collectPackageIslandModuleSites`),
 * keyed by the same stable id.
 *
 * Resolution order is explicit-identity-first:
 *
 * 1. `packageSites` — a package manifest's declaration. The most explicit
 *    published identity: the package's own build and its consumers both read
 *    that one declaration, so it must never lose to a local convention.
 * 2. `declaredSites` — the sidecar's authored `tag` (`openElement.tag`, read by
 *    the island scan into one module-id map). An explicit authored fact
 *    outranks a path convention: a page-local component under `app/site-ui/`
 *    has no path-derived identity at all, and a module that declares its tag
 *    has stated the fact the convention would otherwise guess.
 * 3. the islands directory — `transformIslandSource`'s path derivation, the
 *    convention for modules whose identity no author declared.
 *
 * `declaredSites` has the same shape as `packageSites` so a dev host can re-read
 * it after a rescan (a fresh map replaces a stale one) without a second
 * mechanism.
 *
 * The answer is the tag only. The descriptor root (and `delegatesFocus`,
 * `formAssociated`, `properties`, and the M09-2e `styles` presence) is read by
 * the compiler lane from the authored island sidecar, so an authored
 * `root: 'shadow'` reaches the lane without a host fact and a stale host scan
 * cannot override it.
 */
/**
 * The tag an MDX route compiles under: derived from its route-relative path.
 *
 * The SAME derivation `plugin-mdx-lower.ts` performs, and it must be: the lowering pins
 * this tag in the sidecar it emits, and the compiler writes `site.tag` into the emitted
 * descriptor. Two derivations that disagreed would register the class under one tag and
 * render it under another.
 */
function mdxRouteTag(sourcePath: string, routesDir: string | undefined): string | undefined {
  const posix = sourcePath.replaceAll('\\', '/');
  const relativePath =
    routesDir === undefined ? posix : relative(resolve(process.cwd(), routesDir), posix);
  const derived = relativePath.startsWith('..')
    ? pathToTagName(basename(posix))
    : pathToTagName(normalizeSeparators(relativePath));
  return derived === '' ? undefined : derived;
}

export function createGeneratedElementSiteResolver(
  islandsDir: string,
  packageSites?: PackageIslandSiteFacts,
  declaredSites?: PackageIslandSiteFacts,
  /**
   * The routes directory, needed for ONE case: an `.mdx` route's virtual module id.
   *
   * Its tag derives from the route-RELATIVE path — the same rule the lowering applies —
   * and this resolver has no other way to spell it: the id is virtual, so no filesystem
   * convention can anchor it.
   */
  routesDir?: string,
): GeneratedElementSiteResolver {
  const normalizedIslandsDir = normalizeSeparators(islandsDir);
  const readPackageSites = typeof packageSites === 'function' ? packageSites : () => packageSites;
  const readDeclaredSites =
    typeof declaredSites === 'function' ? declaredSites : () => declaredSites;
  return (moduleId: string) => {
    // An `.mdx` route is remapped to a virtual id before any transform sees it, so
    // none of the path sources below can answer for it: the islands convention needs
    // the module to live under `islandsDir`, and the declared-tag map is keyed by a
    // stable module id this resolver cannot recompute. Answering here is what lets the
    // generated transform ADMIT the lowered module, without which the SSR entry asked
    // for `<Name>__ssrHost` that the module never exported.
    const mdxSource = mdxVirtualSourcePath(moduleId);
    if (mdxSource !== undefined) {
      const mdxTag = mdxRouteTag(mdxSource, routesDir);
      return mdxTag === undefined ? null : { tag: mdxTag };
    }
    const packageTag = readPackageSites()?.get(moduleId);
    if (packageTag !== undefined) return { tag: packageTag };
    const declaredTag = readDeclaredSites()?.get(moduleId);
    if (declaredTag !== undefined) return { tag: declaredTag };
    // The island transform is the authority for admission AND tag: it strips
    // query/hash, rejects non-script paths, anchors the islands segment on its
    // last occurrence and derives the tag with `pathToTagName`. Calling it with
    // empty source keeps the derivation identical while producing no marker
    // text (the returned code is intentionally ignored).
    const { islands } = transformIslandSource('', {
      islandsDir: normalizedIslandsDir,
      filePath: moduleId,
    });
    const island = islands[0];
    if (island === undefined) return null;
    // The ROOT comes from the island's own style declaration (the same fact the
    // DSD link list reads). Only a shadow declaration is stated here: absent
    // keeps the pre-P-1 light assumption, so a module with no declaration is
    // admitted exactly as before.
    const declaration = islandStyleDeclarationFor(moduleId);
    return declaration === undefined
      ? { tag: island.tagName }
      : {
          tag: island.tagName,
          // Three states survive to the site fact (F16): a closed root must not
          // arrive at the compiler spelled as an open one.
          root:
            declaration.root === 'closed'
              ? 'closed'
              : declaration.root === 'shadow'
                ? 'shadow'
                : 'light',
        };
  };
}
