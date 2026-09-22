/**
 * The claim executor seam (#1416).
 *
 * The compiled kernel must reach the existing-DOM claim without a static
 * import of it, or every bundle that merely links the kernel — including one
 * for a page where no island can hydrate server DOM — carries the whole claim
 * machinery. `claimExistingDom` stays the single definition and single owner
 * (`runtime.ts`, the one module that implements it); this seam only decides
 * where a given graph gets it from:
 *
 * - the default `@openelement/element` entry imports
 *   `runtime/claim-install.ts`, whose evaluation installs the executor;
 * - the `@openelement/element/client-only` entry does not, and a bundler then
 *   drops the claim cluster as unreferenced (measured: 9.4 KB on the JFB
 *   keyed-table harness).
 *
 * The executor is a module-level binding rather than a global: installation is
 * an ordinary module side effect, so it happens before any element can
 * connect (the entry module evaluates first) and no host global is written.
 */

import type { PartProgramV1 } from '../../protocol/part-program.ts';
import type {
  CompiledClaimOptions,
  CompiledProgramInstance,
  CompiledRuntimeHost,
} from '../runtime.ts';

/**
 * The claim entry point's signature. Local to this seam so neither the kernel
 * nor this module needs a value import of the claim implementation.
 */
export type ClaimExecutor = (
  program: PartProgramV1,
  host: CompiledRuntimeHost,
  root: Node,
  options?: CompiledClaimOptions,
) => CompiledProgramInstance;

let installed: ClaimExecutor | undefined;

/** Install the one claim executor. Called by the full entry's install module. */
export function installClaimExecutor(executor: ClaimExecutor): void {
  installed = executor;
}

/** The installed executor, or `undefined` on a client-only graph. */
export function claimExecutor(): ClaimExecutor | undefined {
  return installed;
}
