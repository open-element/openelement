/**
 * The Region builders seam (#1548).
 *
 * The compiled runtime must reach the when/each Region machinery without
 * static value imports of it, or every bundle that merely links the kernel —
 * including one for an app whose Part Programs carry no Region Parts —
 * carries the whole regions module. The seam mirrors the claim executor seam
 * (#1416): `regions.ts` stays the single definition and single
 * owner of the builders; this seam only decides where a given graph gets them
 * from:
 *
 * - the default `@openelement/element` entry and the `./client-only` entry
 *   import `runtime/regions-install.ts`, whose evaluation installs the
 *   builders (a client-only page still builds fresh when/each Regions from
 *   client state, so `./client-only` keeps them);
 * - the `./no-regions` and `./base` entries do not, and a bundler then drops
 *   the regions cluster as unreferenced.
 *
 * The builders are a module-level binding rather than a global: installation
 * is an ordinary module side effect, so it happens before any element can
 * connect (the entry module evaluates first) and no host global is written.
 */

import type { ProgramEachPart, ProgramWhenPart } from '@openelement/protocol/part-program';
import { OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type { MountContext } from './program-kernel.ts';
import type { EachRegion, WhenRegion } from './regions.ts';

/**
 * The when/each Region machinery's surface, local to this seam so neither the
 * callers nor this module need a value import of the implementation. The
 * region record/slot types ride as type-only imports (erased at emit), so
 * they create no module-graph edge.
 */
export interface RegionBuilders {
  buildWhen(
    ctx: MountContext,
    parentScope: LifetimeScope,
    doc: Document,
    part: ProgramWhenPart,
    item: unknown,
    itemPart?: ProgramEachPart,
    parent?: Node,
  ): Node[];
  buildEach(
    ctx: MountContext,
    parentScope: LifetimeScope,
    doc: Document,
    part: ProgramEachPart,
    parent?: Node,
  ): Node[];
  updateWhen(region: WhenRegion, value: unknown): void;
  updateEach(region: EachRegion, value: unknown): void;
  whenActive(part: ProgramWhenPart, value: unknown): boolean;
  expectsArrayMessage(where: string, part: ProgramEachPart, value: unknown): string;
}

let installed: RegionBuilders | undefined;

/** Install the one set of Region builders. Called by the installing entries' module. */
export function installRegionBuilders(builders: RegionBuilders): void {
  installed = builders;
}

/** The installed builders, or `undefined` on a regions-free graph. */
export function regionBuilders(): RegionBuilders | undefined {
  return installed;
}

/**
 * The installed builders, or a fail-closed error naming the entries that
 * install them. A regions-free graph reaching a when/each Part means the
 * bundle was built from an entry that omits the builders while the program —
 * or another compiled module in its graph — carries Region Parts: a build
 * selection bug, never a silent mis-render (the #1416 asymmetry applied to
 * the regions axis).
 */
export function regionBuildersOrFail(): RegionBuilders {
  if (!installed) {
    throw new OpenElementError(
      '[compiled-runtime] the program carries when/each Region Parts, but this entry does not ' +
        "install the Region builders. Import '@openelement/element' (the default entry) or " +
        "'@openelement/element/client-only' for any element whose Part Program uses " +
        'conditional or list Regions.',
      { code: RuntimeErrorCode.REGION_BUILDERS_MISSING, phase: 'render' },
    );
  }
  return installed;
}
