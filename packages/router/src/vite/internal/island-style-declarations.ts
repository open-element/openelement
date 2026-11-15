/**
 * island-style-declarations.ts — the build-time carrier for the generated-island
 * `styles` declaration (`IslandConfig.styles`, GH issue #1800).
 *
 * WHO WRITES IT: the island scan (`ssg/island-scanner.ts` `scanIslandMeta`) is
 * the ONE producer. It already reads every island source for its static sidecar
 * facts and resolves the generated-element lane identity in the same pass; an
 * accepted `styles` list is recorded here with the island's derived tag, the
 * islands directory and the module's absolute path.
 *
 * WHO READS IT: the client build's style-edge discovery
 * (`style-assets.ts` `serverRenderedStyleEdgesPlugin`) is the ONE consumer. It
 * turns every record into a registered style edge in the SAME compiler style
 * registry the class lane's authored `.css` imports ride (`registerStyleEdges`
 * with the island's tag as the light-root scope tag), so the sheet travels the
 * existing plan end to end: Vite's CSS pipeline → content-addressed emitted
 * `.css` asset → `StyleAssetRecord` → client asset manifest `styles` field.
 * There is no second style pipeline, no second hash and no second emitter.
 *
 * WHY A CARRIER AND NOT A DIRECT REGISTRATION AT SCAN TIME: the client build
 * clears the compiler's style-edge registry (`clearStyleRequests()`) after the
 * island scan has run, so a scan-time registration would be dropped before the
 * build that owns the emission state even starts. The declaration outlives that
 * reset without a second sidecar read, exactly like the scanned island metadata
 * the build context already carries.
 *
 * ROOT MODE. The record carries the root the compiler resolved for the island
 * (the generated-element host identity): a LIGHT root's sheet is a document
 * resource, while a SHADOW root's sheet is declared INSIDE its DSD template as
 * the canonical marked `<link>` prefix (M09-2e / #1803). The client style-edge
 * registry already distinguishes the two (`RegisteredStyleRequest.scopeTag`):
 * a light edge is wrapped in its island tag's native `@scope`, a shadow edge
 * ships the authored bytes verbatim. One registry, no second pipeline.
 *
 * WHAT THIS SLICE DOES NOT DO (recorded gap, GH issue #1800, Alpha17):
 *
 * - a LIGHT-root generated island's declared sheets are admitted and emitted,
 *   but the generated-element render path does not declare them in the document
 *   yet (the class lane's light-root `<link>` channel is not wired to it). The
 *   asset and the client asset manifest record are this slice's delivery; the
 *   document application is the Alpha17 adoption slice.
 */

import { realpathSync } from 'node:fs';
import { normalizeSeparators } from '@openelement/element/build-utils';

/**
 * One admitted generated-island style declaration, as the island scan resolved
 * it. The specifiers are already validated (`island-style-specifiers.ts`) and
 * stay in authored order.
 */
export interface IslandStyleDeclaration {
  /** The island's derived delivery tag — also the light-root `@scope` identity. */
  readonly tagName: string;
  /**
   * The compiler-resolved host root (M09-2e / #1803). A light root's sheet is a
   * document resource; a shadow root's sheet is declared inside its DSD
   * template by the canonical marked `<link>` prefix.
   */
  readonly root: 'light' | 'shadow';
  /**
   * The island module's absolute path as the bundler spells it (the importing
   * side of every style edge). Separator-normalized; queries stripped.
   */
  readonly moduleId: string;
  /** The islands-dir-relative source path (`posts/card.tsx`). */
  readonly filePath: string;
  /** The resolved islands directory (absolute, separator-normalized). */
  readonly islandsDir: string;
  /** The authored relative `.css` specifiers, validated, in authored order. */
  readonly specifiers: readonly string[];
}

/** moduleId → declaration. Module ids are unique per island module. */
const declarations = new Map<string, IslandStyleDeclaration>();

/**
 * Drop every record. The scan calls it first so the carrier is AUTHORITATIVE
 * for the scan that just ran: an island whose `styles` declaration was removed
 * cannot leave a stale record behind (the same rule the class-candidate
 * registry applies to its own facts).
 */
export function resetIslandStyleDeclarations(): void {
  declarations.clear();
}

/** Record one accepted declaration (idempotent per module id — rescans replace). */
export function registerIslandStyleDeclaration(declaration: IslandStyleDeclaration): void {
  const moduleId = normalizeModuleId(declaration.moduleId);
  declarations.set(moduleId, { ...declaration, moduleId });
}

/** Every record, in registration order (the build consumer's iteration source). */
export function islandStyleDeclarations(): readonly IslandStyleDeclaration[] {
  return [...declarations.values()];
}

/**
 * The declaration for one module the build graph is processing, or undefined.
 *
 * The bundler can spell one file through a different root than the island scan
 * did (a symlinked project root: the scan host's `cwd` spelling versus Vite's
 * resolved root). The lookup therefore falls back to the real path — but only
 * for a candidate whose tail already matches the recorded islands-relative
 * path, so a build with declarations pays no filesystem probe per ordinary
 * module.
 */
export function islandStyleDeclarationFor(moduleId: string): IslandStyleDeclaration | undefined {
  if (declarations.size === 0) return undefined;
  const normalized = normalizeModuleId(moduleId);
  const direct = declarations.get(normalized);
  if (direct !== undefined) return direct;
  const real = realPathOf(normalized);
  if (real === undefined) return undefined;
  for (const declaration of declarations.values()) {
    if (!normalized.endsWith(`/${declaration.filePath}`)) continue;
    if (realPathOf(declaration.moduleId) === real) return declaration;
  }
  return undefined;
}

/** The one module-id spelling the registry keys on. */
function normalizeModuleId(moduleId: string): string {
  return normalizeSeparators(moduleId.split('?', 1)[0] ?? moduleId);
}

/** The real path of an absolute module id, or undefined when it cannot be read. */
function realPathOf(moduleId: string): string | undefined {
  try {
    return normalizeSeparators(realpathSync(moduleId));
  } catch {
    return undefined;
  }
}
