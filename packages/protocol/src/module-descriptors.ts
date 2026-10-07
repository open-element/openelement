/**
 * Cross-system compiler admission contracts (#1557).
 *
 * The semantic core and the module scan accept host-supplied admission
 * extensions as plain data. The types live here — in the zero-dependency
 * contract package — because both sides of the seam consume them: the
 * compiler package (which produces the descriptors' admission behavior) and
 * the router build (which injects its own descriptors) must share one
 * definition without depending on each other.
 */

/**
 * A compile-time binding a host application teaches the semantic core beyond
 * the built-in element intrinsics. Admission stays a binding identity: the
 * export must arrive as a runtime named import from the canonical specifier
 * (aliases followed); namespace, default, type-only, conflicting and
 * relative-re-export provenance is never admitted.
 */
export interface StaticSidecarDescriptor {
  /** Canonical module specifier the sidecar export must be imported from. */
  readonly moduleSpecifier: string;
  /** Exported name of the sidecar factory binding. */
  readonly exportName: string;
  /** The admission granted: a colocated static policy statement. */
  readonly kind: 'static-sidecar';
}

/**
 * One module-scan vocabulary entry the host admits: a binding identity
 * (module specifier + exported name, aliases followed) plus the fact a
 * canonical call of that binding contributes. Plain data — the scan consumes
 * the descriptors without learning the caller's package vocabulary, the
 * same direction as the compiler's
 * {@link StaticSidecarDescriptor} admission (#1473 item 3).
 */
export interface ModuleVocabularyDescriptor {
  /** Canonical module specifier the factory must be imported from. */
  readonly moduleSpecifier: string;
  /** Exported name of the factory binding. */
  readonly exportName: string;
  /** What a canonical call of the binding contributes to the scan. */
  readonly kind: 'page-definition' | 'element-registration';
}
