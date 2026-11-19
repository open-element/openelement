/**
 * #1544 — one shared element-runtime chunk per client build.
 *
 * Every island module imports the @openelement/element runtime. Without an
 * explicit group the bundler homes that runtime inside whichever island
 * chunk its import reached first, so the runtime floor rides (and moves
 * with) an unrelated island's chunk — and graph shifts can strand per-entry
 * copies. This module owns the grouping identity: the element package root
 * is derived from a module id the client build's own resolver answered (the
 * same identity pass the island manifest joins on), and the group matches
 * exactly the module ids under that root — segment-boundary containment,
 * never a substring hit.
 *
 * Fail-closed (#1471 semantics): every island chunk statically imports the
 * runtime, and the generated entry imports it too (lazily, since B2 — a
 * dynamic `import()` edge, never a static one, so a page whose island
 * manifest is empty never requests it). A build whose emitted graph groups
 * zero runtime modules is therefore a structural failure — it would silently
 * ship per-island runtime copies — and fails with a coded error.
 *
 * {@linkcode findElementRuntimeChunkFile} is the same identity used by the
 * head projection that modulepreloads the chunk on island-bearing pages.
 *
 * SPLIT (2026-11-19, B1-final): the single group was physically merging the
 * six generic-executor entry modules with the leaf primitives every generated
 * island needs, so a generated-lane island chunk (which statically imports the
 * leaf primitives) made all six executor entries reachable and the P1 checker
 * judged the graph VIOLATED. The grouping identity is now two names over one
 * package root: {@linkcode ELEMENT_EXECUTOR_CHUNK_NAME} for exactly the six
 * entries {@linkcode EXECUTOR_ENTRY_RELATIVE_MODULES} names, and
 * {@linkcode ELEMENT_RUNTIME_CHUNK_NAME} for every other package module. The
 * leaf primitives must never share a chunk with an executor entry, and
 * {@linkcode requireExecutorChunkUnreachableFromIslands} enforces the other
 * half: no page floor (entry or island chunk) may statically import the
 * executor group.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { buildError, ClientBuildErrorCode } from '../../internal/error-codes.ts';
import type { ClientBuildChunk } from '../client-asset-manifest.ts';
import { EXECUTOR_ENTRY_RELATIVE_MODULES } from './browser-entry-graph-artifact.ts';

/** The emitted shared chunk's name (chunkFileNames appends the hash). */
export const ELEMENT_RUNTIME_CHUNK_NAME = 'element-runtime';

/**
 * The dedicated chunk that homes the six generic-executor entry modules (the
 * P1 load surface, {@linkcode EXECUTOR_ENTRY_RELATIVE_MODULES} — imported from
 * the gate's single table, never copied). Kept apart from
 * {@linkcode ELEMENT_RUNTIME_CHUNK_NAME} so leaf primitives never ride the
 * same chunk as an executor entry; see the module header.
 */
export const ELEMENT_EXECUTOR_CHUNK_NAME = 'element-executor';

/**
 * The shared primitives BOTH lanes import — the second reviewed table (the
 * first is {@linkcode EXECUTOR_ENTRY_RELATIVE_MODULES}, imported from the
 * gate's artifact so the physical split and the judged list cannot drift).
 *
 * Why a table at all, when the fallthrough answer is already
 * {@linkcode ELEMENT_RUNTIME_CHUNK_NAME}: the split callback answers for ONE
 * module id at a time, and the bundler homes a module that two groups both
 * reach by the first explicit group to CLAIM it. These three modules are
 * imported by the six executor entries and by the generated (side-effect-free)
 * lane, so with only the executor rule expressed they ride the executor group
 * — measured on the real www build: the island chunk statically imported
 * `element-executor-*.js` through them and the P1 checker judged the graph
 * VIOLATED. Naming them here makes the claim explicit and first, so the
 * executor group can never take them, and a future executor entry that imports
 * a new shared primitive is added HERE, with a rationale line, instead of
 * silently re-merging the two chunks.
 *
 * Package-relative, exact identity, same matching rule as the executor table
 * (`elementRuntimeChunkName` compares the resolved id against these strings
 * after stripping the resolved package root — one rule, two tables).
 */
export const SHARED_PRIMITIVE_RELATIVE_MODULES: readonly string[] = [
  // `property-conversion` — the shell's prop/style normalisation, imported by
  // shell.ts's generate lane and by the executor entries alike.
  'src/internal/core/property-conversion.ts',
  // `security` — the trusted-html / URL policy surface, both lanes.
  'src/internal/core/security.ts',
  // `signal-framework` — the signal core every reactive primitive stands on.
  'src/internal/signal/framework.ts',
];

/**
 * The third reviewed table: the CLASS-SHELL modules — the class-lane's
 * implementation host and the executor resources it is the only browser
 * consumer of. They group into {@linkcode ELEMENT_EXECUTOR_CHUNK_NAME}, NOT
 * the runtime chunk.
 *
 * Why a table at all, and why this direction: these modules are element-package
 * modules that the six executor entries' own dependency closure owns. Naming
 * only the six in the executor group left them claimed by the fallthrough
 * `element-runtime` group, so the emitted runtime chunk imported the executor
 * chunk — measured on the real www build before this table existed:
 * `islands/element-runtime-*.js` statically imported
 * `islands/element-executor-*.js`, which made all six executor entries
 * reachable from every page floor and the P1 checker judged the graph
 * VIOLATED.
 *
 * The claim is behavioural, not stylistic: a class ISLAND is the only browser
 * consumer of this host. `src/open-element-implementation.ts` is the class
 * lane's implementation (`facade-host.ts` + `runtime/kernel.ts` are its :53 and
 * :63 imports); `src/index.ts` is the capital-C `OpenElement` authoring facade
 * whose two side-effect imports (`hydrate-install`, `blocks-install`) install
 * the very resources the executor entries execute; and the five runtime
 * resources below are reached only through those two. So the class shell
 * belongs to the executor side of the split — the side a class island pulls
 * lazily — and must never sit in the chunk every generated-lane island
 * statically imports.
 *
 * Membership is measured, never guessed: every id here was proven, by a
 * scripted walk over the emitted `oe-browser-entry-graph.json` (backward
 * closure over static element-package imports from the six executor entries),
 * to reach an executor entry from INSIDE the runtime chunk. When a new module
 * shows up in that walk it is added here, one line plus one rationale, and
 * never by widening a prefix.
 */
export const CLASS_SHELL_RELATIVE_MODULES: readonly string[] = [
  // `index` — the capital-C `OpenElement` facade (`export *` from
  // `public-surface.ts` plus the claim and Block installers); the class lane's
  // public door, and the reason the installers below ship.
  'src/index.ts',
  // `open-element-implementation` — the class shell itself: facade-host plus
  // the compiled kernel. Imported by `open-element.ts`, i.e. by class islands.
  'src/open-element-implementation.ts',
  // `blocks-install` — `index`'s Block-builder install; pulls `blocks.ts`,
  // which imports the executor's `fresh-dom` and `program-kernel` entries.
  'src/internal/compiled/runtime/blocks-install.ts',
  // `blocks` — the Block builders' execution path (executor resource).
  'src/internal/compiled/runtime/blocks.ts',
  // `hydrate-recovery` — the recovery path for a failed claim; imports the
  // `hydrate` executor entry and `parts`/`program-kernel`.
  'src/internal/compiled/runtime/hydrate-recovery.ts',
  // `parts` — Part-program execution helpers; imports `program-kernel`.
  'src/internal/compiled/runtime/parts.ts',
  // `pre-upgrade-events` — the pre-upgrade capture replay; imports
  // `program-kernel`, and is imported by the class shell itself.
  'src/internal/compiled/runtime/pre-upgrade-events.ts',
  // `revive` — revive/upgrade of a claimed instance; imports `parts` and
  // `program-kernel`.
  'src/internal/compiled/runtime/revive.ts',
  // `hydrate-install` — the side-effect install of the hydration executor
  // (#1416); imports `runtime.ts`, i.e. the six entries. Grouped here so its
  // importer below cannot bridge the executor into the runtime chunk.
  'src/internal/compiled/runtime/hydrate-install.ts',
  // `no-blocks` — the no-Block public entry; its deliberate
  // `hydrate-install` side-effect import (the B2 half-measure) makes it an
  // executor-side consumer, and it was the bridge that kept the six entries
  // statically reachable after every other shell module moved.
  'src/no-blocks.ts',
];

/**
 * The runtime entry the native generated client entry imports — and the
 * package name the identity walk anchors on; they are the same string by
 * the package's own export map.
 */
export const ELEMENT_RUNTIME_ENTRY_SPECIFIER = '@openelement/element';

/** The resolved grouping identity for the element runtime. */
export interface ElementRuntimeIdentity {
  /** Absolute, separator-normalized @openelement/element package root. */
  packageRoot: string;
}

/**
 * Derive the element package root from a module id the client build's
 * resolver answered for {@linkcode ELEMENT_RUNTIME_ENTRY_SPECIFIER}. The
 * walk reads package.json upward until the named package anchors the root —
 * the same realpath for workspace-linked builds (the in-repo element
 * package) and installed ones (`node_modules/@openelement/element`) — and
 * fails closed
 * when no ancestor names the package: a layout the walk cannot anchor would
 * make every later match a guess.
 */
export function resolveElementRuntimeIdentity(resolvedEntryId: string): ElementRuntimeIdentity {
  let dir = dirname(normalizeSeparators(resolvedEntryId.split('?', 1)[0]));
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      let name: unknown;
      try {
        name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name;
      } catch {
        // A malformed manifest is not the anchor; keep walking.
      }
      if (name === ELEMENT_RUNTIME_ENTRY_SPECIFIER) return { packageRoot: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw buildError(
        ClientBuildErrorCode.ELEMENT_RUNTIME_IDENTITY_UNRESOLVED,
        `The client build resolved ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} to ${resolvedEntryId}, ` +
          `but no ancestor directory carries a package.json naming ` +
          `"${ELEMENT_RUNTIME_ENTRY_SPECIFIER}" — the element package root cannot be anchored, ` +
          `so the shared runtime chunk would group by guessing`,
      );
    }
    dir = parent;
  }
}

/**
 * The chunk-grouping decision for one module id: under the resolved package
 * root (query suffixes stripped, separators normalized, prefix boundary exact
 * so a sibling like `element-next/` never matches), the six executor entries
 * {@linkcode EXECUTOR_ENTRY_RELATIVE_MODULES} names and the class shell
 * {@linkcode CLASS_SHELL_RELATIVE_MODULES} names group into
 * {@linkcode ELEMENT_EXECUTOR_CHUNK_NAME}; the primitives both lanes import
 * ({@linkcode SHARED_PRIMITIVE_RELATIVE_MODULES}) and every other package
 * module group into {@linkcode ELEMENT_RUNTIME_CHUNK_NAME}. Outside the root
 * (or with a null identity — the specifier the identity pass never resolved)
 * the answer is undefined, matching nothing by construction.
 *
 * The split is exact-identity on the package-relative path: the executor table
 * is the very list the P1 checker gates on, so the physical chunk boundary and
 * the judged module list cannot drift.
 */
export function elementRuntimeChunkName(
  moduleId: string,
  identity: ElementRuntimeIdentity | null,
): string | undefined {
  if (!identity) return undefined;
  const id = normalizeSeparators(moduleId.split('?', 1)[0]);
  const prefix = `${identity.packageRoot}/`;
  if (!id.startsWith(prefix)) return undefined;
  const packageRelative = id.slice(prefix.length);
  // Order is the whole mechanism, and it is a three-table cascade, each step
  // exact-identity on the same package-relative string so no module is ever
  // claimed by two tables:
  //
  //  1. CLASS_SHELL → executor. The class-lane host and the executor resources
  //     only it (and the six entries) import. Claimed for the EXECUTOR first so
  //     the runtime-chunk import can never pick them up: before this table
  //     existed, `element-runtime` statically imported `element-executor`
  //     through exactly this closure.
  //  2. SHARED_PRIMITIVE → runtime. Primitive modules BOTH lanes import, which
  //     the executor group must never take, or the leaf primitives every
  //     generated island needs would ride the executor chunk again.
  //  3. EXECUTOR entries → executor; every other package module → runtime.
  if ((CLASS_SHELL_RELATIVE_MODULES as readonly string[]).includes(packageRelative)) {
    return ELEMENT_EXECUTOR_CHUNK_NAME;
  }
  if ((SHARED_PRIMITIVE_RELATIVE_MODULES as readonly string[]).includes(packageRelative)) {
    return ELEMENT_RUNTIME_CHUNK_NAME;
  }
  return (EXECUTOR_ENTRY_RELATIVE_MODULES as readonly string[]).includes(packageRelative)
    ? ELEMENT_EXECUTOR_CHUNK_NAME
    : ELEMENT_RUNTIME_CHUNK_NAME;
}

/**
 * The emitted shared chunk's file among a client output file list — build
 * output names (`islands/element-runtime-<hash>.js`) or base-prefixed asset
 * URLs (`/client/islands/element-runtime-<hash>.js`). The grouping name plus
 * the hash `chunkFileNames` appends IS the chunk's identity (#1544): the
 * head projection that modulepreloads the runtime reads its address from the
 * build's own output, never from a hand-maintained list.
 *
 * Exactly one file may carry the identity — a second one is the split layout
 * {@linkcode requireElementRuntimeChunk} rejects, never a first-hit. Zero
 * matches returns undefined: a zero-island build legally emits no runtime
 * chunk, and callers that require the chunk fail closed themselves.
 */
export function findElementRuntimeChunkFile(files: readonly string[]): string | undefined {
  const matches = files.filter((file) => {
    const base = file.slice(file.lastIndexOf('/') + 1);
    return base.startsWith(`${ELEMENT_RUNTIME_CHUNK_NAME}-`) && base.endsWith('.js');
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client output carries ${matches.length} ${ELEMENT_RUNTIME_CHUNK_NAME} chunks ` +
        `(${matches.join(', ')}) — #1544 requires exactly one shared runtime chunk, and the ` +
        `per-page modulepreload projection cannot choose between them`,
    );
  }
  return matches[0];
}

/**
 * #1471's fail-closed posture applied to the shared runtime chunk: every
 * native island chunk statically imports the element runtime (and the
 * generated entry imports it lazily), so the emitted graph must home the
 * runtime modules in exactly one chunk and that chunk must be the shared one
 * the group names (the `element-runtime` identity, hash-appended by
 * chunkFileNames). Zero grouped modules means the
 * group never fired (package-root drift, resolver regression); more than one
 * carrying chunk means the runtime split; a single carrying chunk that is
 * not the `element-runtime` chunk means the runtime homed inside an island.
 * All three layouts ship per-island runtime copies or move the runtime floor
 * with an unrelated island, so each fails instead of shipping. A null
 * identity at this point is the same internal ordering bug
 * {@linkcode ClientBuildErrorCode.PACKAGE_IDENTITY_UNRESOLVED} covers: the
 * identity pass did not run before the verdict.
 */
export function requireElementRuntimeChunk(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
): void {
  if (!identity) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The native client graph requires ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the build's ` +
        `identity pass produced no element runtime identity — the shared ` +
        `element-runtime chunk cannot be verified and the build fails instead of guessing`,
    );
  }
  const carrying = chunks.filter((chunk) =>
    [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
      (rawId) =>
        rawId !== '' && elementRuntimeChunkName(rawId, identity) === ELEMENT_RUNTIME_CHUNK_NAME,
    ),
  );
  if (carrying.length === 0) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The native client graph requires ${ELEMENT_RUNTIME_ENTRY_SPECIFIER}, but the emitted ` +
        `client build groups no module under the resolved package root ` +
        `${identity.packageRoot} — the shared element-runtime chunk never fired, so the build ` +
        `would ship the runtime inline per island instead`,
    );
  }
  if (carrying.length > 1) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client build groups ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} modules across ` +
        `${carrying.length} chunks (${carrying.map((chunk) => chunk.fileName).join(', ')}) — ` +
        `the element runtime must home in exactly one shared chunk, or per-island copies ship ` +
        `and the runtime floor moves with an unrelated island`,
    );
  }
  const shared = carrying[0];
  const base = shared.fileName.slice(shared.fileName.lastIndexOf('/') + 1);
  if (!base.startsWith(`${ELEMENT_RUNTIME_CHUNK_NAME}-`)) {
    throw buildError(
      ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING,
      `The emitted client build groups the ${ELEMENT_RUNTIME_ENTRY_SPECIFIER} modules inside ` +
        `${shared.fileName}, which is not the shared ${ELEMENT_RUNTIME_CHUNK_NAME} chunk — the ` +
        `runtime floor rides an unrelated island chunk and moves with it instead`,
    );
  }
}

/**
 * B2's own property, asserted on the emitted graph: the client entry must not
 * STATICALLY reach the shared element-runtime chunk.
 *
 * The entry is the one client chunk every page loads, island manifest empty or
 * not, so a static edge from it to the runtime makes the runtime an
 * unconditional download for pages that declared no island — the exact bytes
 * B2 removes. `requireElementRuntimeChunk` above proves the runtime is homed
 * correctly; it says nothing about who can reach it, and a correctly homed
 * runtime is still dragged in when the entry acquires a static edge to any
 * chunk that imports it.
 *
 * Static only, by construction: the walk follows `OutputChunk.imports` and
 * never `dynamicImports`, so the entry's own lazy `import()` of the selected
 * `element-services-*` surface — and every island chunk behind it — is
 * invisible here, which is the point. A closure that reaches the runtime
 * statically is a page floor, and fails.
 *
 * Fail-closed on the guard's own inputs: a build whose entry chunk cannot be
 * identified fails rather than passing vacuously, because "no entry found" and
 * "entry proven clean" are not the same fact. Zero-island apps legitimately
 * carry no runtime at all; the walk then finds no runtime file to compare
 * against and passes, which is the honest answer — there is nothing to reach.
 */
export function requireEntryStaticGraphFreeOfRuntime(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
): void {
  const entries = chunks.filter((chunk) => chunk.isEntry === true);
  if (entries.length === 0) {
    throw buildError(
      ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME,
      `The emitted client build reports no entry chunk (isEntry), so B2's entry-graph guard ` +
        `cannot prove the runtime is unreachable from the page floor — the guard fails instead ` +
        `of passing vacuously`,
    );
  }
  const runtimeFiles = new Set(
    chunks
      .filter((chunk) =>
        [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
          (rawId) =>
            rawId !== '' && elementRuntimeChunkName(rawId, identity) === ELEMENT_RUNTIME_CHUNK_NAME,
        ),
      )
      .map((chunk) => chunk.fileName),
  );
  if (runtimeFiles.size === 0) return;
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const queue = entries.map((chunk) => chunk.fileName);
  // Breadth-first parent links, so a failure can name the whole hop sequence
  // that carried the edge instead of only its last hop.
  const parent = new Map<string, string | null>(entries.map((chunk) => [chunk.fileName, null]));
  const pathTo = (file: string): string[] => {
    const path: string[] = [];
    for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) path.unshift(at);
    return path;
  };
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    // The entry chunk itself cannot carry the runtime as a *reached* chunk
    // (that is the same-file case the literal `imports` list never contains),
    // so the comparison starts at the imports.
    for (const imported of byFile.get(file)?.imports ?? []) {
      if (!byFile.has(imported) || seen.has(imported)) continue;
      if (runtimeFiles.has(imported)) {
        throw buildError(
          ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME,
          `The emitted client entry statically reaches the shared element runtime: ` +
            `${[...pathTo(file), imported].join(' -> ')}. ` +
            `A page whose island manifest is empty would download the runtime anyway (B2), so ` +
            `the build fails instead of shipping the pre-B2 floor`,
        );
      }
      parent.set(imported, file);
      queue.push(imported);
    }
  }
}

/**
 * One emitted island chunk's lane, as the client build read it off the island
 * entry (the M11-3 lane fact, `ClientIslandDeliveryEntry.generatedLane`).
 *
 * The distinction is the whole point of the guard's narrowing: a GENERATED-lane
 * island imports the leaf primitives and must never statically reach the
 * executor, while a CLASS-lane island's runtime IS the executor — its static
 * import of the class shell and the executor entries is the legitimate class
 * shape, not an accidental page floor.
 */
export type IslandChunkLane = 'generated' | 'class';

/**
 * B1's own property, asserted on the emitted graph: no page floor statically
 * reaches the dedicated element-executor chunk.
 *
 * The split in {@linkcode elementRuntimeChunkName} homes the six generic-
 * executor entry modules in their own `element-executor` group so the leaf
 * primitives every generated island needs no longer drag the executor entries
 * along. The complementary half — {@linkcode requireElementRuntimeChunk} proves
 * the runtime is homed; this proves no floor can reach the executor — is what
 * keeps the executor a lazy pull: a class island loads it only when a class
 * island actually renders.
 *
 * The floor is every `isEntry` chunk AND every GENERATED-lane `island-*` chunk
 * (the lane is the island entry's M11-3 fact, joined to the emitted chunk file
 * by the caller as {@linkcode islandLaneByChunkFile}). A generated-lane island
 * statically imports the leaf primitives; if that closure reaches the executor
 * group, the executor is on the page floor for pages that declared a class
 * island it never renders — the pre-split shape. A class-lane island chunk is
 * NOT a floor root: the class lane's runtime IS the executor, so its static
 * import of the executor entries and the class shell is the legitimate class
 * shape. Unattributed chunks read as `class` (fail-open there): a join gap must
 * not fail a build on a fact the join could not establish, and the generated
 * side — the side the guard protects — stays fail-closed. Static edges only, by
 * construction: the walk follows `OutputChunk.imports` and never
 * `dynamicImports`, so a lazy `import()` of the executor stays invisible here,
 * which is the point.
 *
 * Fail-closed on the guard's own inputs matches
 * {@linkcode requireEntryStaticGraphFreeOfRuntime}'s posture. Zero executor
 * chunks — a pure generated-lane build with no class island — is the honest
 * answer: there is nothing to reach, and the guard returns.
 */
export function requireExecutorChunkUnreachableFromIslands(
  chunks: readonly ClientBuildChunk[],
  identity: ElementRuntimeIdentity | null,
  islandLaneByChunkFile?: ReadonlyMap<string, IslandChunkLane>,
): void {
  const executorFiles = new Set(
    chunks
      .filter((chunk) =>
        [chunk.facadeModuleId ?? '', ...Object.keys(chunk.modules ?? {})].some(
          (rawId) =>
            rawId !== '' &&
            elementRuntimeChunkName(rawId, identity) === ELEMENT_EXECUTOR_CHUNK_NAME,
        ),
      )
      .map((chunk) => chunk.fileName),
  );
  if (executorFiles.size === 0) return;
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const laneOf = (chunk: ClientBuildChunk): IslandChunkLane =>
    // Fail-open in the only safe direction: a chunk the caller could not
    // attribute is read as the CLASS lane, whose static executor import is the
    // legitimate shape. The generated side — the side this guard protects —
    // stays fail-closed: once the join proves a chunk generated-lane, any
    // static edge from it to the executor fails the build.
    islandLaneByChunkFile?.get(chunk.fileName) ?? 'class';
  const isFloor = (chunk: ClientBuildChunk): boolean => {
    if (chunk.isEntry === true) return true;
    const base = chunk.fileName.slice(chunk.fileName.lastIndexOf('/') + 1);
    if (!base.startsWith('island-')) return false;
    // Only the GENERATED lane is a page floor: a class island's runtime is the
    // executor, so its static import of the executor group is the shape the
    // split gives it, never an accident to fail on.
    return laneOf(chunk) === 'generated';
  };
  const floorFiles = chunks.filter(isFloor).map((chunk) => chunk.fileName);
  // Breadth-first parent links, so a failure can name the whole hop sequence
  // that carried the edge instead of only its last hop — the same parent-chain
  // shape requireEntryStaticGraphFreeOfRuntime uses.
  const parent = new Map<string, string | null>(floorFiles.map((file) => [file, null]));
  const pathTo = (file: string): string[] => {
    const path: string[] = [];
    for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) path.unshift(at);
    return path;
  };
  const seen = new Set<string>();
  const queue = [...floorFiles];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imported of byFile.get(file)?.imports ?? []) {
      if (!byFile.has(imported) || seen.has(imported)) continue;
      if (executorFiles.has(imported)) {
        throw buildError(
          ClientBuildErrorCode.ELEMENT_EXECUTOR_REACHABLE_FROM_ISLANDS,
          `The emitted client graph statically reaches the ${ELEMENT_EXECUTOR_CHUNK_NAME} chunk ` +
            `(the six generic-executor entry modules) from a page floor: ` +
            `${[...pathTo(file), imported].join(' -> ')}. ` +
            `A generated-lane island imports the leaf runtime only; a static edge from the ` +
            `entry or from a generated-lane island chunk makes the executor an unconditional ` +
            `download on pages that declared no class island, so the build fails instead of ` +
            `shipping the pre-split floor`,
        );
      }
      parent.set(imported, file);
      queue.push(imported);
    }
  }
}
