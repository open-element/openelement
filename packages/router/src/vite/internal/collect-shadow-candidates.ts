/**
 * Shadow candidate collection (alpha15 S lane; defect C ownership).
 *
 * A component's statically admitted class candidates are a COMPILER fact: the
 * lowering collects the tokens, and the host build forwards them to the
 * official Tailwind compiler as explicit candidates. This module is the one
 * home for "a module's source → its registry facts", shared by both writers —
 * the dev channel (a changed file is re-registered directly, because the SSR
 * graph may not have re-transformed it yet) and the client build's
 * resolver-driven discovery pass (which compiles every module the server
 * renders and registers the same way).
 *
 * There is no second parser here and no class grammar of our own. The lanes are
 * tried in the order the transform tries them, because each lane's admission is
 * its own: a generated island is admitted by its island declaration, a page or
 * layout by the server function frontend, a shipped package by its embedded
 * artifact facts. A module the classifier cannot place registers its absence.
 *
 * A module that fails to compile is skipped by design: this pass only feeds the
 * component stylesheet's candidate set, and the authoritative compile (the SSR
 * pass, which transforms every module) is the one that reports its diagnostics
 * and fails the build. Skipping is therefore never a silent acceptance of
 * broken source.
 *
 * Every registration is AUTHORITATIVE for its module, including "none" — an
 * emptied module drops its previous facts (defect C) — and every write goes
 * into the CALLER'S registry, so no two builds share facts.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  type ClassCandidateRegistry,
  compileGeneratedElementIfAdmitted,
  compileServerComponentIfAdmitted,
  compiledArtifactClassCandidates,
  prepareServerComponentImports,
} from '@openelement/compiler';
import { join, resolve } from 'pathe';
import { readComponentDeclaration } from './component-declaration.ts';
import { islandStyleDeclarationFor } from './island-style-declarations.ts';
import {
  createServerComponentSourceResolver,
  resolveViteServerComponentSource,
} from './server-component-host.ts';
import type { ModuleWalkResolver } from './module-graph-walk.ts';

/** One module the collection pass should compile. */
export interface CandidateModule {
  /**
   * Project-relative POSIX path of the module source — or, with
   * `resolve: true`, a bare package specifier the pass resolves from the app
   * root (the packed/linked component-library case).
   */
  readonly path: string;
  /** Resolve `path` as a package specifier from the app root. */
  readonly resolve?: boolean;
  /**
   * The caller's convention-derived tag, when the caller knows it (an island's
   * path tag).
   *
   * It is only the declaration reader's FALLBACK identity: a generated island
   * carries no `tag` in its sidecar (its tag comes from its path), so without
   * this the reader answers `absent` for the module, it falls through to the
   * server function lane, and a SHADOW island with TSX-only utilities registers
   * its tokens as LIGHT facts — the wrong sheet (F16). A page-local component
   * pins its own tag and needs no fallback; omitting the field keeps every
   * existing caller's behaviour byte-identical.
   */
  readonly tag?: string;
}

export interface CollectShadowCandidatesOptions {
  /** Project root; module paths resolve against it. */
  readonly root: string;
  /** The modules to compile, in any order (registration is per module). */
  readonly modules: readonly CandidateModule[];
  /** The owner's registry — never a shared one. */
  readonly candidates: ClassCandidateRegistry;
  /**
   * The admitted static component tags (alpha15 server lane): a server
   * function component module compiles through the lane so its LIGHT class
   * candidates register exactly like a generated component's. Omitted: the lane
   * still compiles (with no `__ssr`-routed nested hosts).
   */
  readonly serverComponentTags?: readonly string[];
  readonly viteResolver?: ModuleWalkResolver | undefined;
}

/**
 * Register a SHIPPED (already compiled) module's candidates: proven at pack
 * time and travelling in the module (S5-B), so the packed form is admitted
 * exactly like the authored one — no second parser over the shipped markup. A
 * module that carries none registers its absence.
 */
export function registerArtifactCandidates(
  source: string,
  file: string,
  candidates: ClassCandidateRegistry,
): boolean {
  const recovered = compiledArtifactClassCandidates(source, file);
  candidates.register(file, recovered ?? [], { shadow: true });
  return recovered !== undefined;
}

/**
 * Compile every listed module and register its admitted class candidates in the
 * caller's registry. Returns how many modules contributed candidates
 * (diagnostics for the pass's own module set are the SSR pass's to report).
 */
export async function collectShadowClassCandidates(
  options: CollectShadowCandidatesOptions,
): Promise<number> {
  let contributed = 0;
  const seen = new Set<string>();
  for (const entry of options.modules) {
    let file: string;
    if (entry.resolve === true) {
      try {
        file = createRequire(join(options.root, 'package.json')).resolve(entry.path);
      } catch {
        // The authoritative compile reports an unresolvable specifier.
        continue;
      }
    } else {
      file = resolve(options.root, entry.path);
    }
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    // No local "is this a component?" prefilter: each lane below carries its own
    // admission, and a hand-written spelling test here is how this pass once
    // grew a second, wrong copy of the `@element(` gate. A config-declared
    // module list is small enough to pay one admission attempt per module.
    //
    // The GENERATED lane comes FIRST (P-1, 2026-11-21). A generated island is
    // also an exported JSX-returning function, so the server component lane
    // below would claim it as a LIGHT page component and register its tokens in
    // the wrong scope — measured: the fixture's shadow island registered 15
    // tokens as light and the shadow sheet compiled empty. The island
    // declaration is the authoritative site fact (tag + root), so the lane is
    // asked only for a module that has one.
    // The gate is the SIDECAR, not the style-declaration registry (F16): that
    // registry only carries islands that declare `styles`, so using it here skipped
    // every generated component with class tokens but no authored sheet — its tokens
    // still compile into the shared component sheet and it still needs them in the
    // shadow scope. The declaration reader answers "is this a generated component,
    // and which root", which is exactly the admission question.
    // The style-declaration registry is preferred when it HAS an entry: it is the
    // authoritative tag+root the scan already resolved, and using it keeps every
    // styled island's registration byte-identical. The SIDECAR READER is the
    // fallback, and it exists because that registry only carries islands declaring
    // `styles` — without the fallback a generated component with class tokens but no
    // authored sheet was skipped entirely, so its tokens never reached the scope
    // that compiles them (F16).
    const declaration = islandStyleDeclarationFor(file);
    const reading =
      declaration === undefined ? readComponentDeclaration(source, entry.tag) : undefined;
    const declaredRoot =
      declaration !== undefined
        ? declaration.root
        : reading?.kind === 'declared'
          ? (reading.declaration.root ?? 'light')
          : undefined;
    const declaredTag =
      declaration !== undefined
        ? declaration.tagName
        : reading?.kind === 'declared'
          ? reading.declaration.tag
          : undefined;
    if (declaredTag !== undefined) {
      let generated: ReturnType<typeof compileGeneratedElementIfAdmitted> = null;
      try {
        generated = compileGeneratedElementIfAdmitted(source, file, {
          site: { tag: declaredTag },
        });
      } catch {
        // The authoritative compile reports diagnostics; see the module header.
        continue;
      }
      if (generated !== null) {
        options.candidates.register(file, generated.classCandidates, {
          shadow: declaredRoot === 'shadow',
        });
        if (generated.classCandidates.length > 0) contributed += 1;
        continue;
      }
    }
    // The server function component lane (alpha15): a route module carrying
    // an exported JSX-returning function. Its classes are LIGHT facts (no
    // element class, no shadow root) — the same registry, the same
    // authoritative registration.
    let serverCompiled: ReturnType<typeof compileServerComponentIfAdmitted>;
    try {
      const resolver = options.viteResolver;
      const resolveModule =
        resolver === undefined
          ? (specifier: string) =>
              createServerComponentSourceResolver({ root: options.root })(specifier, file) ??
              undefined
          : await prepareServerComponentImports(source, file, (specifier) =>
              resolveViteServerComponentSource(specifier, (target) =>
                resolver.resolve(target, file),
              ),
            );
      serverCompiled = compileServerComponentIfAdmitted(source, file, {
        ...(resolveModule === undefined ? {} : { resolveModule }),
        ...(options.serverComponentTags === undefined
          ? {}
          : { compiledTags: options.serverComponentTags }),
      });
    } catch {
      // The authoritative compile reports diagnostics; see the module header.
      continue;
    }
    if (serverCompiled !== null) {
      const tokens = serverCompiled.classCandidates ?? [];
      options.candidates.register(file, tokens, { shadow: false });
      if (tokens.length > 0) contributed += 1;
      continue;
    }
    if (registerArtifactCandidates(source, file, options.candidates)) contributed += 1;
  }
  return contributed;
}
