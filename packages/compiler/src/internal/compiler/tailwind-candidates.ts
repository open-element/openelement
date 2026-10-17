/**
 * Tailwind class-candidate channel (alpha15 S lane).
 *
 * The compiler never interprets Tailwind's class grammar: a compiled module's
 * compile-time `class` values are collected as OPAQUE STRINGS by the lowering
 * (static literals, primitive-literal attributes, both branches of an admitted
 * conditional class, `each` item-template literals) and travel to the build
 * layer through this registry — the same one-writer/one-reader shape as the
 * style-edge registry. The build layer hands the list to the OFFICIAL Tailwind
 * compiler as explicit candidates (`@source inline(…)`), which owns candidate
 * syntax, utility generation, theme compilation and optimization.
 *
 * Root scope is part of the fact, because it decides which sheet an engine can
 * use: a light-root component's classes are covered by the document entry's own
 * pipeline when its DOM is the document's DOM ({@linkcode
 * ClassCandidateRegistry.allLight} — the document-sheet input for an engine
 * that generates its own document CSS), while a shadow-root component's
 * classes can only reach its tree through the component stylesheet.
 *
 * The COMPONENT sheet compiles from every admitted candidate
 * ({@linkcode ClassCandidateRegistry.all}), not from the shadow-root subset:
 * a light-root component's DOM does not always end up in the document. The
 * layout convention puts every page inside the layout's shadow template, and a
 * shadow component may render a light-root child, so a document-level class
 * can be rendered inside a shadow tree where only the component sheet reaches
 * it. The sheet is emitted only when a shadow root exists, so an app without
 * one pays nothing for the wider set.
 *
 * OWNERSHIP (defect C): the registry is an explicit object with a lifetime its
 * owner chooses — one per build, one per dev server — instead of a
 * process-global map. Two builds (or two dev servers) in one process therefore
 * cannot inherit each other's facts, and a caller never has to clear shared
 * state another live build owns. Registering a module's CURRENT facts is
 * authoritative: a module that now carries no class token drops its previous
 * facts, so an emptied or edited module cannot leave a stale candidate behind
 * (and a deleted file is forgotten by registering its absence —
 * {@linkcode ClassCandidateRegistry.remove}).
 *
 * The registry only carries FACTS the compiler could prove statically. A
 * `class={this.<field>}` binding contributes nothing — the compiler cannot
 * know its runtime value, and it must not guess. Completeness for such
 * bindings is the author's explicit declaration through Tailwind's own
 * `@source` mechanisms in the app's CSS entry.
 */

interface RegisteredCandidates {
  readonly shadow: boolean;
  readonly tokens: readonly string[];
}

/**
 * One owner's class-candidate facts: the build (or dev server) that created it
 * is the only writer, its stylesheet emitter the only reader.
 */
export interface ClassCandidateRegistry {
  /**
   * Register ONE module's statically admitted class candidates. The call is
   * authoritative for that module: an empty list means the module now carries
   * no statically admitted class token, so its previous facts are dropped
   * rather than left to inflate the next stylesheet.
   */
  register(moduleId: string, candidates: readonly string[], options: { shadow: boolean }): void;
  /** Forget one module (a deleted file, a module that left the graph). */
  remove(moduleId: string): void;
  /** The candidates one module contributed, or an empty list. */
  forModule(moduleId: string): readonly string[];
  /** Every candidate registered so far, first-seen ordered and deduplicated. */
  all(): readonly string[];
  /**
   * The SHADOW-root candidates only. The COMPONENT sheet no longer compiles
   * from this view (a light-root class can render inside a shadow tree, so the
   * sheet takes {@linkcode ClassCandidateRegistry.all}); it stays as the
   * shadow-only view of the facts, for a consumer that wants exactly that.
   */
  allShadow(): readonly string[];
  /**
   * The LIGHT-root candidates only — the document sheet's input for an engine
   * that generates its own document CSS (a shadow component's classes are
   * delivered by the component stylesheet and never inflate the document one).
   */
  allLight(): readonly string[];
  /** True when any module contributed candidates. */
  has(): boolean;
}

/** Create one owner's registry (see the lifetime note above). */
export function createClassCandidateRegistry(): ClassCandidateRegistry {
  const byModule = new Map<string, RegisteredCandidates>();
  const union = (include: (entry: RegisteredCandidates) => boolean): readonly string[] => {
    const seen = new Set<string>();
    for (const entry of byModule.values()) {
      if (!include(entry)) continue;
      for (const candidate of entry.tokens) seen.add(candidate);
    }
    return [...seen];
  };
  return {
    register(moduleId, candidates, options) {
      const id = cleanModuleId(moduleId);
      if (candidates.length === 0) {
        byModule.delete(id);
        return;
      }
      byModule.set(id, { shadow: options.shadow, tokens: [...candidates] });
    },
    remove(moduleId) {
      byModule.delete(cleanModuleId(moduleId));
    },
    forModule(moduleId) {
      return byModule.get(cleanModuleId(moduleId))?.tokens ?? [];
    },
    all() {
      return union(() => true);
    },
    allShadow() {
      return union((entry) => entry.shadow);
    },
    allLight() {
      return union((entry) => !entry.shadow);
    },
    has() {
      return byModule.size > 0;
    },
  };
}

/**
 * The module-id normalization every lookup shares: query suffixes on the module
 * id (dev-time cache busting) are stripped, so the authored and dev-served
 * spellings answer identically.
 */
function cleanModuleId(moduleId: string): string {
  return moduleId.split('?', 1)[0]!;
}
