/**
 * Protocol-owned module-descriptor contracts (#1557 package split): the
 * binding-identity descriptors both the compiler's semantic core and the
 * router build consume without depending on each other. Plain data — the
 * scan consumes the descriptors without learning the caller's package
 * vocabulary. The compiler facade re-exports these exact identities
 * (`semantic-core/module-analysis.ts`); the router's admission constants
 * (`ISLAND_ADMISSION`, `ROUTER_MODULE_VOCABULARY`) type against them.
 */

/**
 * One static-sidecar descriptor the host injects into the element
 * compiler: the admission granted is a colocated static policy statement
 * (#1473 item 3, the static-sidecar admission pattern).
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
