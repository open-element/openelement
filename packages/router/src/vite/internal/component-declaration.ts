/**
 * ONE reader for "is this module a component, and what did it declare?".
 *
 * WHY THIS MODULE EXISTS. The sidecar (`export const openElement =
 * defineIslandConfig({...})`) is the authored identity of a generated component.
 * Before this module, four build passes each called the parser themselves and
 * each interpreted the result differently:
 *
 *   - the island scan (path-derived tag, authored root, styles admission),
 *   - the static-component scan (page-local components: tag, host producer),
 *   - the declared-tag scan (page-local tags for the site resolver),
 *   - the style-edge walk (page-local components' declared sheets).
 *
 * Eight call sites, four interpretations, one fact. That is how the same module
 * came to be classified as a class page by one pass and compiled as a generated
 * element by another (P-4), and how a page-local component's sheets were
 * registered twice under two spellings (P-2b).
 *
 * THE RULE, STATED ONCE. A module is a generated component when it carries the
 * sidecar and the sidecar names a tag (explicit `tag`, or a tag the caller
 * DERIVES from a convention). The islands directory is a TAG SOURCE, not an
 * admission gate: an island's tag comes from its path, a page-local component's
 * from its sidecar. Every pass asks this module for the identity and then uses
 * the fields it needs; none re-reads the sidecar.
 *
 * The parser is still `readIslandConfig` — the ONE static parser, which the
 * island scan owns. This module adds no second grammar; it adds one answer.
 */

import { readIslandConfig, type StaticIslandConfig } from './ssg/island-scanner.ts';

/** The descriptor root a component declares, as the site fact spells it. */
export type DeclaredRoot = 'light' | 'shadow';

/** What a module's authored sidecar declares. */
export interface ComponentDeclaration {
  /** True: the module carries the sidecar at all. */
  readonly declared: true;
  /**
   * The tag the sidecar pins, or undefined when it pins none (an island: its tag
   * is its path's; a page-local component without `tag` has no identity at all,
   * which is why the caller's derived tag is required in that case).
   */
  readonly tag: string | undefined;
  /**
   * The descriptor root the author pinned, or undefined when they pinned none
   * (the shell applies its light default).
   */
  readonly root: DeclaredRoot | undefined;
  /** The authored `.css` specifiers, in authored order (validated by the scan). */
  readonly styles: readonly string[];
  /** The raw sidecar record, for a caller that needs a field this type omits. */
  readonly config: StaticIslandConfig;
}

/**
 * The result of asking. Three states, because the three CFM outcomes are
 * genuinely different and every consumer must handle each one explicitly:
 *
 * - `absent` — no sidecar: the module belongs to another lane (class page, page,
 *   plain module). Never an error, never a note.
 * - `invalid` — the sidecar is there but unreadable: the authored diagnostic is
 *   the TRANSFORM's to report on the modules it compiles, so a scan reports a
 *   note and moves on instead of aborting route discovery for the whole app.
 * - `declared` — a usable identity.
 */
export type ComponentDeclarationReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'declared'; readonly declaration: ComponentDeclaration };

/**
 * A cheap, SOUND prefilter: almost every module has no sidecar, and the parser
 * builds a full `SourceFile` per call.
 *
 * It is only sound while `readIslandConfig` requires the callee to be spelled
 * literally `defineIslandConfig` (it does, and it does not follow import
 * aliases). If that parser ever learns aliases this predicate must move onto the
 * same rule, or an aliased sidecar is skipped here while the transform admits it
 * and the module silently loses its identity.
 */
export function mayDeclareComponent(source: string): boolean {
  return source.includes('defineIslandConfig');
}

/**
 * Read one module's component declaration.
 *
 * `fallbackTag` is the caller's convention-derived tag (an island's path tag).
 * It is only a FALLBACK: a sidecar that pins `tag` wins, and a module with no
 * fallback and no pinned tag is `absent` — it has no identity to admit.
 */
export function readComponentDeclaration(
  source: string,
  fallbackTag?: string,
): ComponentDeclarationReading {
  if (!mayDeclareComponent(source)) return { kind: 'absent' };
  let config: StaticIslandConfig;
  try {
    const parsed = readIslandConfig(source);
    if (parsed === null) return { kind: 'absent' };
    config = parsed;
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
  const tag = config.tag ?? fallbackTag;
  if (tag === undefined) return { kind: 'absent' };
  return {
    kind: 'declared',
    declaration: {
      declared: true,
      tag,
      root: config.root === 'shadow' ? 'shadow' : config.root === 'light' ? 'light' : undefined,
      styles: config.styles ?? [],
      config,
    },
  };
}
