/**
 * Semantic IR — a compiler-private feasibility spike (Alpha16a M02).
 *
 * This module defines the **minimum** IR needed to express the five approved
 * worked examples in `docs/architecture/compiler-ir-and-abi-boundary.md` §11.
 * It is deliberately not:
 *
 * - a public API (nothing here is exported from the package entry),
 * - a wire format (never serialized to a browser),
 * - a JavaScript AST (expressions are stored as authored **source slices** with
 *   a span and a resolved read list — never a re-parsed node tree),
 * - a codegen input yet (no backend consumes it in this milestone).
 *
 * The spike exists to answer one question: can a small, composable IR carry the
 * semantics the approved TSX contract requires? If a case cannot be expressed,
 * that is the finding — extending the node set is a later decision, not a
 * default.
 */

/** A half-open source range in the authored file. */
export interface IrSpan {
  readonly file: string;
  /**
   * UTF-16 code-unit offset of the first character (the TypeScript position
   * unit). Not a byte offset: converting to bytes requires re-encoding, and any
   * Source Map work must keep this unit.
   */
  readonly start: number;
  /** UTF-16 code-unit offset one past the last character. */
  readonly end: number;
  /** 1-based line of `start`. */
  readonly line: number;
  /** 1-based column of `start`. */
  readonly column: number;
}

/**
 * How an expression participates in evaluation. This is the distinction the
 * owner called out explicitly: an ordinary local, an explicit computed value and
 * an inline JSX expression are three different things and must never collapse
 * into one "reactive expression" bucket.
 */
export type IrExpressionKind =
  /** authored literal or JSX value; no reactive meaning */
  | 'literal'
  /** ordinary local read, evaluated once where it appears (a snapshot) */
  | 'local'
  /** explicit `computed(...)` derivation */
  | 'computed'
  /** read performed directly inside a dynamic JSX position (tracked there) */
  | 'tracked'
  /** event-handler body */
  | 'handler'
  /** list-key expression, evaluated at plan time, not per item render */
  | 'key';

/** How a resolved identifier is bound in the authored scope. */
export type IrBindingKind = 'local' | 'signal' | 'computed' | 'prop' | 'unknown';

/** One identifier an expression reads, resolved against the component scope. */
export interface IrRead {
  readonly name: string;
  readonly binding: IrBindingKind;
}

/** An expression, stored as authored source plus provenance — never as an AST. */
export interface IrExpression {
  readonly kind: IrExpressionKind;
  /** The authored slice (trimmed). No AST, no reparse, no evaluation. */
  readonly source: string;
  readonly span: IrSpan;
  readonly reads: readonly IrRead[];
}

/** The three value tiers a component may declare. */
export type IrResourceKind = 'signal' | 'computed' | 'local';

/** One component-scope value declaration. */
export interface IrResource {
  readonly name: string;
  readonly kind: IrResourceKind;
  /** Initializer / derivation; absent for a resource with no initializer. */
  readonly expression?: IrExpression;
  readonly span: IrSpan;
}

/** An owner in the logical ownership tree. */
export interface IrOwner {
  readonly id: string;
  readonly parent: string | null;
  readonly reason: 'component' | 'insertion' | 'list-item';
}

/** A JSX element (intrinsic or host element). */
export interface IrElement {
  readonly kind: 'element';
  readonly id: string;
  readonly tag: string;
  readonly attributes: readonly IrAttribute[];
  readonly children: readonly IrNode[];
  readonly span: IrSpan;
}

/** Ordered children with no host element (multi-root / fragment). */
export interface IrFragment {
  readonly kind: 'fragment';
  readonly id: string;
  readonly children: readonly IrNode[];
  readonly span: IrSpan;
}

/** Static text. */
export interface IrText {
  readonly kind: 'text';
  readonly id: string;
  readonly value: string;
  readonly span: IrSpan;
}

/**
 * A dynamic JSX child. `tracked` records whether the compiler established
 * reactivity here: an inline expression reading a signal is tracked, an
 * interpolated ordinary local is a snapshot.
 */
export interface IrDynamicText {
  readonly kind: 'dynamic-text';
  readonly id: string;
  readonly expression: IrExpression;
  readonly tracked: boolean;
  readonly span: IrSpan;
}

/** A static attribute value. */
export interface IrStaticAttribute {
  readonly kind: 'static-attribute';
  readonly name: string;
  readonly value: string;
  readonly span: IrSpan;
}

/** A dynamic attribute / property / event / key binding. */
export interface IrDynamicAttribute {
  readonly kind: 'dynamic-attribute';
  readonly name: string;
  readonly channel: 'property' | 'attribute' | 'event' | 'key' | 'ref';
  readonly expression: IrExpression;
  readonly tracked: boolean;
  readonly span: IrSpan;
}

export type IrAttribute = IrStaticAttribute | IrDynamicAttribute;

/** A reference to another component used as a child (hostless composition). */
export interface IrComponentRef {
  readonly kind: 'component-ref';
  readonly id: string;
  readonly name: string;
  readonly props: readonly IrAttribute[];
  readonly span: IrSpan;
}

/** Conditional rendering: one test, one or two branches. */
export interface IrCondition {
  readonly kind: 'condition';
  readonly id: string;
  readonly test: IrExpression;
  readonly consequent: readonly IrNode[];
  readonly alternate: readonly IrNode[] | null;
  readonly span: IrSpan;
}

/** One list, keyed or positional, with an item template. */
export interface IrList {
  readonly kind: 'list';
  readonly id: string;
  /** Region owner for the list itself. */
  readonly ownerId: string;
  /** Each entry owns its own subtree; the IR states that as a fact, not a hope. */
  readonly itemOwner: 'per-entry';
  readonly items: IrExpression;
  /** `null` means the list is positional (unkeyed) and says so explicitly. */
  readonly key: IrExpression | null;
  readonly template: readonly IrNode[];
  readonly span: IrSpan;
}

/**
 * A value-position JSX expression lowered to a reusable insertion recipe.
 * A recipe is created once and consumed by one or more `IrInsertionSite`s; each
 * site gets its own owner and therefore its own instance.
 */
export interface IrRecipe {
  readonly kind: 'recipe';
  readonly id: string;
  readonly target: IrComponentRef | IrElement;
  readonly span: IrSpan;
}

/** One consumption of a recipe — the projection-site owner is assigned here. */
export interface IrInsertionSite {
  readonly kind: 'insertion-site';
  readonly id: string;
  readonly recipeId: string;
  readonly ownerId: string;
  readonly span: IrSpan;
}

/** `{props.children}` projected into the output. */
export interface IrChildrenProjection {
  readonly kind: 'children-projection';
  readonly id: string;
  /** The owner that will own the projected subtree. */
  readonly ownerId: string;
  readonly span: IrSpan;
}

export type IrNode =
  | IrElement
  | IrFragment
  | IrText
  | IrDynamicText
  | IrComponentRef
  | IrCondition
  | IrList
  | IrInsertionSite
  | IrChildrenProjection;

/** One function component. */
export interface IrComponent {
  readonly kind: 'component';
  readonly id: string;
  readonly name: string;
  readonly file: string;
  /** The authored props parameter name, when the component takes one. */
  readonly propsParam: string | null;
  readonly resources: readonly IrResource[];
  /** Recipes declared in value position (created, not mounted). */
  readonly recipes: readonly IrRecipe[];
  /** Every owner created for this component (component, insertions, list items). */
  readonly owners: readonly IrOwner[];
  /** Multiple roots are legal: hostless components have no host element. */
  readonly roots: readonly IrNode[];
  readonly owner: IrOwner;
  readonly span: IrSpan;
}

/**
 * Where a diagnostic can be located.
 *
 * - `source`    — points at an authored expression or node; a reader can jump there.
 * - `ir-object` — points at an IR object whose span is the best available anchor.
 * - `module`    — no single authored site exists (missing component, syntax
 *                 failure, IR-wide invariant); the span is the module fallback
 *                 and must not be presented as a source location.
 */
export type IrDiagnosticOrigin = 'source' | 'ir-object' | 'module';

/** A diagnostic produced while building or validating the IR. */
export interface IrDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly span: IrSpan;
  readonly origin: IrDiagnosticOrigin;
}

/** The result of one build: the component plus any diagnostics. */
export interface IrBuildResult {
  readonly component: IrComponent | null;
  readonly diagnostics: readonly IrDiagnostic[];
}
