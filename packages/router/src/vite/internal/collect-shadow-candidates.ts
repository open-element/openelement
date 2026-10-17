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
 * There is no second parser here and no class grammar of our own.
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
  compileElementModule,
  compileServerComponentIfAdmitted,
  compiledArtifactClassCandidates,
} from '@openelement/compiler';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';
import { join, resolve } from 'pathe';
import { createServerComponentSourceResolver } from './server-component-host.ts';

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
   * candidates register exactly like a class module's. Omitted: the lane
   * still compiles (with no `__ssr`-routed nested hosts).
   */
  readonly serverComponentTags?: readonly string[];
}

/**
 * Register one already-compiled module's candidates. The root scope is part of
 * the fact: only a shadow-root component's classes need the component
 * stylesheet (light-root classes live in document DOM, where the document
 * entry's own pipeline already covers them).
 */
export function registerCandidatesFromCompiled(
  file: string,
  compiled: { classCandidates?: readonly string[]; program: { root: { kind: string } } },
  candidates: ClassCandidateRegistry,
): boolean {
  candidates.register(file, compiled.classCandidates ?? [], {
    shadow: compiled.program.root.kind !== 'light',
  });
  return (compiled.classCandidates ?? []).length > 0;
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
    // No local prefilter: `compileElementModule` carries the one admission
    // gate, and duplicating it here is how this pass grew its own copy of the
    // `@element(` substring bug — a module whose decorator arrives through an
    // alias (`import { element as defineElement }`) skipped the compiler
    // entirely and registered as an already-compiled artifact instead. The
    // gate is cheap enough to run for a config-declared module list.
    let compiled: ReturnType<typeof compileElementModule>;
    try {
      compiled = compileElementModule(source, file, { staticSidecars: [ISLAND_ADMISSION] });
    } catch {
      // The authoritative compile reports diagnostics; see the module header.
      continue;
    }
    if (compiled === null) {
      // The server function component lane (alpha15): a route module carrying
      // an exported JSX-returning function. Its classes are LIGHT facts (no
      // element class, no shadow root) — the same registry, the same
      // authoritative registration.
      let serverCompiled: ReturnType<typeof compileServerComponentIfAdmitted>;
      try {
        serverCompiled = compileServerComponentIfAdmitted(source, file, {
          resolveModule: (specifier) =>
            createServerComponentSourceResolver({ root: options.root })(specifier, file) ??
            undefined,
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
      continue;
    }
    if (registerCandidatesFromCompiled(file, compiled, options.candidates)) contributed += 1;
  }
  return contributed;
}
