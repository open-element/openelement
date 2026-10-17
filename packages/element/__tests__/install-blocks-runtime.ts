/**
 * Element-project vitest bootstrap (#1548).
 *
 * The when/each Block builders reach the compiled runtime through the
 * blocks seam (internal/compiled/runtime/blocks-seam.ts): a bundle gets
 * them from its entry's install import, not from a static import inside the
 * runtime. Tests that drive the runtime internals directly
 * (`src/internal/compiled/runtime.ts` and friends) therefore mirror what a
 * real consumer graph does — import the install once, the way
 * `src/index.ts` and `src/client-only.ts` do — and this setup does it for
 * every test file in the project.
 *
 * The fail-closed half of the seam is NOT covered here (an installed seam
 * cannot observe its own absence): `blocks-entry-split.test.ts` pins it in
 * entry-less subprocesses, the same pattern the claim seam's
 * `hydrate-entry-split.test.ts` uses.
 */
import '../src/internal/compiled/runtime/blocks-install.ts';
