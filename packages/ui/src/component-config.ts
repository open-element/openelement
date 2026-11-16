/**
 * The @openelement/ui authoring face for a generated component's platform facts.
 *
 * The compiler's generated-element lane reads the literal statement
 * `export const openElement = <call>({ ... })` from the authored AST and takes
 * the platform facts (root, delegatesFocus, formAssociated, styles, properties)
 * from that object. The callee's binding provenance is the host's admission
 * decision, and this package must not depend on the router's island config, so
 * the identity helper lives here.
 *
 * It validates nothing at runtime: the build is the authority, and a shape this
 * type cannot express is refused by the compiler rather than silently ignored.
 */
export interface ComponentConfig {
  readonly root?: 'light' | 'shadow';
  readonly delegatesFocus?: boolean;
  readonly formAssociated?: boolean;
  /** Authored package-relative `.css` files the shadow template declares. */
  readonly styles?: readonly string[];
  readonly properties?: Readonly<
    Record<
      string,
      {
        readonly default?: string | number | boolean;
        readonly reflect?: boolean;
        readonly attribute?: string | false;
      }
    >
  >;
}

/** Identity helper: returns the config unchanged so the authored statement keeps its literal shape. */
export function defineComponentConfig<T extends ComponentConfig>(config: T): T {
  return config;
}
