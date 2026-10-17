/**
 * The Block builders seam (#1548).
 *
 * The compiled runtime must reach the when/each Block machinery without
 * static value imports of it, or every bundle that merely links the kernel —
 * including one for an app whose Part Programs carry no Block Parts —
 * carries the whole blocks module. The seam mirrors the hydration executor seam
 * (#1416): `blocks.ts` stays the single definition and single
 * owner of the builders; this seam only decides where a given graph gets them
 * from:
 *
 * - the default `@openelement/element` entry and the `./client-only` entry
 *   import `runtime/blocks-install.ts`, whose evaluation installs the
 *   builders (a client-only page still builds fresh when/each Blocks from
 *   client state, so `./client-only` keeps them);
 * - the `./no-blocks` and `./base` entries do not, and a bundler then drops
 *   the blocks cluster as unreferenced.
 *
 * The builders are a module-level binding rather than a global: installation
 * is an ordinary module side effect, so it happens before any element can
 * connect (the entry module evaluates first) and no host global is written.
 */

import type { ProgramEachPart, ProgramWhenPart } from '@openelement/protocol/part-program';
import { OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type { MountContext } from './program-kernel.ts';
import type { EachBlock, WhenBlock } from './blocks.ts';

/**
 * The when/each Block machinery's surface, local to this seam so neither the
 * callers nor this module need a value import of the implementation. The
 * block record/slot types ride as type-only imports (erased at emit), so
 * they create no module-graph edge.
 */
export interface BlockBuilders {
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
  updateWhen(block: WhenBlock, value: unknown): void;
  updateEach(block: EachBlock, value: unknown): void;
  whenActive(part: ProgramWhenPart, value: unknown): boolean;
  expectsArrayMessage(where: string, part: ProgramEachPart, value: unknown): string;
  /**
   * Per-item event wiring, re-run by a reconnect so a revived list reinstates
   * exactly the listeners its entries had (revive.ts) without importing the
   * blocks module into a blocks-free graph.
   */
  attachItemEvents(
    ctx: MountContext,
    part: ProgramEachPart,
    nodes: Node[],
    scope: LifetimeScope,
    itemBox: { item: unknown },
  ): void;
}

let installed: BlockBuilders | undefined;

/**
 * Per-item event re-wiring for a revived list (revive.ts): the seam's own
 * accessor, so a blocks-free graph never imports the blocks module. Reaching
 * this with no builders installed means the same build-selection bug the
 * builders themselves report.
 */
export function attachItemEvents(
  ctx: MountContext,
  part: ProgramEachPart,
  nodes: Node[],
  scope: LifetimeScope,
  itemBox: { item: unknown },
): void {
  blockBuildersOrFail().attachItemEvents(ctx, part, nodes, scope, itemBox);
}

/** Install the one set of Block builders. Called by the installing entries' module. */
export function installBlockBuilders(builders: BlockBuilders): void {
  installed = builders;
}

/** The installed builders, or `undefined` on a blocks-free graph. */
export function blockBuilders(): BlockBuilders | undefined {
  return installed;
}

/**
 * The installed builders, or a fail-closed error naming the entries that
 * install them. A blocks-free graph reaching a when/each Part means the
 * bundle was built from an entry that omits the builders while the program —
 * or another compiled module in its graph — carries Block Parts: a build
 * selection bug, never a silent mis-render (the #1416 asymmetry applied to
 * the blocks axis).
 */
export function blockBuildersOrFail(): BlockBuilders {
  if (!installed) {
    throw new OpenElementError(
      '[compiled-runtime] the program carries when/each Block Parts, but this entry does not ' +
        "install the Block builders. Import '@openelement/element' (the default entry) or " +
        "'@openelement/element/client-only' for any element whose Part Program uses " +
        'conditional or list Blocks.',
      { code: RuntimeErrorCode.BLOCK_BUILDERS_MISSING, phase: 'render' },
    );
  }
  return installed;
}
