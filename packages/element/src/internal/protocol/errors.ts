/**
 * errors.ts — the single declaration site of the openElement error contract
 * (#1386 item 3).
 *
 * Four error conventions used to coexist in this package: OEC structured
 * compiler diagnostics, `OpenElementError` with codes, ~40 bare `Error`s
 * carrying `[compiled-*]` string prefixes, and dedicated exception classes
 * (`PartProgramClaimError`, `CompiledProgramValidationError`, `EachKeyError`).
 * A consumer could not catch a failure by code without importing three classes
 * and reading message text for the rest. Now every failure raised by this
 * package is an {@linkcode OpenElementError} carrying `code`, `severity`,
 * `phase` and `recoverable`; the dedicated classes below only ADD their own
 * provenance fields on top of that contract.
 *
 * The class lives here, not in `../core/errors.ts`, because this module is
 * import-free: the semantic core and the canonical Part Program protocol may
 * import it without gaining host, bundler, or mutable module state, and
 * `../core/errors.ts` re-exports it for the rest of the package.
 *
 * ## Code families
 *
 * `ErrorCode` is the legacy documented set that the documentation site's error
 * catalog reads by name (the generated error-code and error-reference pages).
 * The `*ErrorCode` tables below are the completed dialect's catalogue, one
 * table per failure surface — the shape `@openelement/router` already uses in
 * `src/internal/error-codes.ts`. Codes are stable: `OPEN_ELEMENT_COMPILED_*`
 * values shipped in 1.0.0-alpha.3 and are kept verbatim so a consumer matching
 * on them keeps working; every new code uses the `OE_` prefix.
 */

// ─── Well-known error codes ─────────────────────────────────────────

/** Well-known error code constants for reference. String values are always accepted. */
export const ErrorCode = {
  SSR_RENDER_ERROR: 'SSR_RENDER_ERROR',
  BOUNDARY_CAUGHT: 'BOUNDARY_CAUGHT',
  UNKNOWN: 'UNKNOWN',
} as const;

/**
 * Default code for {@linkcode RenderError}. Deliberately NOT a member of
 * {@linkcode ErrorCode}: that object is the scan target of the documentation
 * site's error catalog, which requires every member to carry a phase/severity
 * family rule. `RENDER_ERROR` is the pre-dialect
 * value `RenderError` has always defaulted to — kept verbatim so callers that
 * observe it keep working, and kept out of the catalogue because it is not a
 * failure this package classifies, only a constructor default a caller may
 * override.
 */
export const DEFAULT_RENDER_ERROR_CODE = 'RENDER_ERROR';

/** Error message prefix for all openElement errors. */
export const ERROR_PREFIX = '[openElement]';

// ─── Types ──────────────────────────────────────────────────────────

export type ErrorSeverity = 'error' | 'warning';
export type ErrorPhase =
  | 'render'
  | 'ssr'
  | 'csr'
  | 'build'
  | 'navigation'
  | 'validation'
  | 'unknown';

/** Constructor options for {@linkcode OpenElementError}; every field is defaulted. */
export interface OpenElementErrorOptions {
  cause?: Error;
  code?: string;
  statusCode?: number;
  severity?: ErrorSeverity;
  phase?: ErrorPhase;
  recoverable?: boolean;
}

/** Framework error carrying a stable code, severity, phase and recoverability contract. */
export class OpenElementError extends Error {
  public readonly code: string;
  public readonly severity: ErrorSeverity;
  public readonly phase: ErrorPhase;
  public readonly recoverable: boolean;
  public readonly statusCode?: number;

  constructor(message: string, options: OpenElementErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OpenElementError';
    this.code = options.code ?? ErrorCode.UNKNOWN;
    this.severity = options.severity ?? 'error';
    this.phase = options.phase ?? 'unknown';
    this.recoverable = options.recoverable ?? false;
    this.statusCode = options.statusCode;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      phase: this.phase,
      recoverable: this.recoverable,
      statusCode: this.statusCode,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/** Callback receiving every reported {@linkcode OpenElementError} for telemetry. */
export type ErrorTelemetryHook = (error: OpenElementError) => void;

// ─── Code catalogue ─────────────────────────────────────────────────

/**
 * Program-shape failures: a Part Program (or one of its records) is malformed,
 * or carries a value the wire format cannot express. Phase `validation`: these
 * reject data before any DOM work starts.
 */
export const ProgramErrorCode = {
  /** A Part Program v1 failed structural validation. */
  INVALID_PROGRAM: 'OE_PROGRAM_INVALID',
  /** A Part Program cannot be serialized to JSON, so it is not a wire artifact. */
  NOT_SERIALIZABLE: 'OE_PROGRAM_NOT_SERIALIZABLE',
  /** A compiled server/claim slot names a field the contract does not define. */
  INVALID_SLOT: 'OE_PROGRAM_INVALID_SLOT',
  /** A source-map segment carries a non-integer or out-of-range position. */
  INVALID_SOURCE_SEGMENT: 'OE_PROGRAM_INVALID_SOURCE_SEGMENT',
  /** A `when` test carries a threshold that is not a numeric literal. */
  NON_NUMERIC_CONDITION: 'OE_PROGRAM_NON_NUMERIC_CONDITION',
} as const;

/**
 * Keyed-list identity failures. Shared by the server serializer and the client
 * runtime (see `internal/compiled/each-key.ts`), so both executors reject the
 * same data with the same code.
 */
export const EachKeyErrorCode = {
  /** A keyed list item is not an object carrying the declared key field. */
  ITEM_NOT_A_RECORD: 'OE_EACH_ITEM_NOT_A_RECORD',
  /** A key value cannot round-trip (an object, function or symbol has no stable identity). */
  KEY_NOT_ROUND_TRIPPABLE: 'OE_EACH_KEY_NOT_ROUND_TRIPPABLE',
  /** Two items in one list Region derived the same key. */
  DUPLICATE_KEY: 'OE_EACH_KEY_DUPLICATE',
} as const;

/**
 * Runtime execution failures raised while a compiled program is serialized,
 * built into fresh DOM, or re-read on a signal write (phase `render`).
 */
export const RuntimeErrorCode = {
  /** A list Region's signal does not hold an array. */
  LIST_VALUE_NOT_ARRAY: 'OE_RUNTIME_LIST_VALUE_NOT_ARRAY',
  /** render() reads a signal that is not registered on the host. */
  HOST_SIGNAL_MISSING: 'OE_RUNTIME_HOST_SIGNAL_MISSING',
  /** An event Part names a handler the host does not provide. */
  HOST_HANDLER_MISSING: 'OE_RUNTIME_HOST_HANDLER_MISSING',
  /** A ref Part names a ref the host does not provide. */
  HOST_REF_MISSING: 'OE_RUNTIME_HOST_REF_MISSING',
  /** A signal's `subscribe` returned something that is not an unsubscribe function. */
  SUBSCRIPTION_INVALID: 'OE_RUNTIME_SUBSCRIPTION_INVALID',
  /** A Part index in the program has no Part record. */
  PART_MISSING: 'OE_RUNTIME_PART_MISSING',
  /** A fixed Part was used where a dynamic anchor is required. */
  FIXED_PART_AS_ANCHOR: 'OE_RUNTIME_FIXED_PART_AS_ANCHOR',
  /** A compiled node path does not resolve in the DOM. */
  PATH_UNRESOLVED: 'OE_RUNTIME_PATH_UNRESOLVED',
  /** A compiled node path resolved to a non-element node. */
  PATH_NOT_ELEMENT: 'OE_RUNTIME_PATH_NOT_ELEMENT',
  /** An item value/attribute slot appears outside an `each` Region. */
  ITEM_SLOT_OUTSIDE_REGION: 'OE_RUNTIME_ITEM_SLOT_OUTSIDE_REGION',
  /** An item slot found no owning `each` Region. */
  ITEM_SLOT_WITHOUT_REGION: 'OE_RUNTIME_ITEM_SLOT_WITHOUT_REGION',
  /** An item slot has no owner document to create nodes from. */
  ITEM_SLOT_WITHOUT_DOCUMENT: 'OE_RUNTIME_ITEM_SLOT_WITHOUT_DOCUMENT',
  /** The mount root has no ownerDocument. */
  ROOT_WITHOUT_DOCUMENT: 'OE_RUNTIME_ROOT_WITHOUT_DOCUMENT',
  /** Fresh-DOM creation was handed a root that is not empty. */
  FRESH_ROOT_NOT_EMPTY: 'OE_RUNTIME_FRESH_ROOT_NOT_EMPTY',
  /** A fixed Part has no serialized anchor to bind. */
  SERIALIZED_ANCHOR_MISSING: 'OE_RUNTIME_SERIALIZED_ANCHOR_MISSING',
} as const;

/** Element-lifecycle failures: the kernel was driven outside its contract (phase `csr`). */
export const KernelErrorCode = {
  /** The kernel was used after `destroy()`. */
  DISPOSED: 'OE_KERNEL_DISPOSED',
  /** `__partProgram.tag` does not match the host element's tag. */
  TAG_MISMATCH: 'OE_KERNEL_TAG_MISMATCH',
  /** Existing DOM needs the claim executor, which this entry does not install. */
  CLAIM_EXECUTOR_MISSING: 'OE_KERNEL_CLAIM_EXECUTOR_MISSING',
  /** A supplied root is not owned by the element it was passed for. */
  ROOT_NOT_OWNED: 'OE_KERNEL_ROOT_NOT_OWNED',
  /** The requested root mode needs `attachShadow()`, which the host lacks. */
  ATTACH_SHADOW_REQUIRED: 'OE_KERNEL_ATTACH_SHADOW_REQUIRED',
} as const;

/** Community-context service lifecycle failures (phase `csr`). */
export const ContextErrorCode = {
  /** The compiled element's context service was used after disconnect disposal. */
  SERVICE_DISPOSED: 'OE_CONTEXT_SERVICE_DISPOSED',
} as const;

/** Compiled-style application failures (phase `csr`). */
export const StyleErrorCode = {
  /** The shadow root has no `adoptedStyleSheets` support. */
  ADOPTED_STYLES_UNSUPPORTED: 'OE_STYLES_ADOPTED_SHEETS_UNSUPPORTED',
  /** A light-DOM style sink needs an owner document with a usable head. */
  LIGHT_SINK_WITHOUT_DOCUMENT: 'OE_STYLES_LIGHT_SINK_WITHOUT_DOCUMENT',
} as const;

/**
 * Claim failures: the existing DOM does not match the program that would own
 * it. The value shipped in 1.0.0-alpha.3 and is kept verbatim; consumers match
 * on it, and `PartProgramClaimError` is its only raiser.
 */
export const ClaimErrorCode = {
  /** Claimed DOM structure or node identity drifted from the compiled program. */
  STRUCTURE_MISMATCH: 'OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH',
  /** A pre-upgrade event capture argument was neither an array nor a capture object. */
  PRE_UPGRADE_EVENTS_INVALID: 'OE_CLAIM_PRE_UPGRADE_EVENTS_INVALID',
  /** Bounded recovery met a dynamic node inside a static Region. */
  DYNAMIC_NODE_IN_STATIC_REGION: 'OE_CLAIM_DYNAMIC_NODE_IN_STATIC_REGION',
  /** An each item template carries Part anchors, which cannot be rebuilt statically. */
  ITEM_TEMPLATE_ANCHOR: 'OE_CLAIM_ITEM_TEMPLATE_ANCHOR',
} as const;

/**
 * Compiled server/claim validation failures. The value shipped in
 * 1.0.0-alpha.3 and is kept verbatim; `CompiledProgramValidationError` is its
 * only raiser.
 */
export const ServerErrorCode = {
  /** A Part Program failed the compiled server/claim grammar. */
  PROGRAM_INVALID: 'OPEN_ELEMENT_COMPILED_PROGRAM_INVALID',
  /** A Part Program was refused for a security-relevant reason. */
  SINK_REFUSED: 'OE_SERVER_SINK_REFUSED',
} as const;

/**
 * Compiler (build-time) failures. The per-diagnostic `OEC####` codes stay on
 * each diagnostic; these classify the family so a build failure is catchable
 * as one thing.
 */
export const CompilerErrorCode = {
  /** One or more source-located diagnostics stopped the compile. */
  DIAGNOSTICS: 'OE_COMPILER_DIAGNOSTICS',
  /** A compile step was handed source it cannot analyse. */
  INVALID_SOURCE: 'OE_COMPILER_INVALID_SOURCE',
} as const;

/** Attribute/authoring-surface failures (phase `validation`). */
export const AuthoringErrorCode = {
  /** A tag name is not a valid custom element name. */
  INVALID_TAG_NAME: 'OE_INVALID_TAG_NAME',
  /** A `wrapInDocument` meta entry uses an attribute name HTML forbids. */
  UNSAFE_META_ATTRIBUTE: 'OE_UNSAFE_META_ATTRIBUTE',
  /** A `wrapInDocument` structuredData entry is not a JSON-LD document. */
  INVALID_STRUCTURED_DATA: 'OE_INVALID_STRUCTURED_DATA',
  /** An `html` sink received a string that was not marked trusted. */
  UNTRUSTED_HTML_SINK: 'OE_UNTRUSTED_HTML_SINK',
  /** The `params` attribute exceeds the documented size limit. */
  PARAMS_ATTRIBUTE_TOO_LARGE: 'OE_PARAMS_ATTRIBUTE_TOO_LARGE',
} as const;

/** SSR/bootstrap failures raised by the public entries (phase `ssr` / `csr`). */
export const FacadeErrorCode = {
  /**
   * No usable compiled Part Program for the requested class or tag: an
   * uncompiled class, an unregistered tag, or a tag that disagrees with the
   * compiled program's own tag. One code because it is one condition from the
   * caller's side — the class and the program do not describe the same
   * element — and because this value shipped in 1.0.0-alpha.3.
   */
  PROGRAM_MISSING: 'OE_PROGRAM_MISSING',
  /** Nested element expansion exceeded the depth bound (cyclic composition). */
  COMPOSITION_DEPTH: 'OE_SSR_COMPOSITION_DEPTH',
  /** A compiled property is marked computed but has no `__computedFields` factory. */
  COMPUTED_FACTORY_MISSING: 'OE_COMPUTED_FACTORY_MISSING',
  /** A computed property is read-only and was assigned to. */
  COMPUTED_READONLY: 'OE_COMPUTED_READONLY',
  /** The compiled class names a handler the instance does not implement. */
  HANDLER_MISSING: 'OE_HANDLER_MISSING',
  /** JSX ran outside the compiler pipeline, where the factory was removed. */
  JSX_OUTSIDE_COMPILER: 'OE_JSX_OUTSIDE_COMPILER',
  /** An `HTMLElement` member was reached during SSR, where no DOM exists. */
  SSR_DOM_ACCESS_UNSUPPORTED: 'SSR_DOM_ACCESS_UNSUPPORTED',
} as const;

/**
 * One framework failure: {@linkcode OpenElementError} with the caller's code
 * and the phase/severity/recoverability that phase implies. Every throw site in
 * this package goes through this factory (or the `*ErrorCode` tables above) so
 * a code, a phase and a recoverability answer cannot drift per site.
 */
export function frameworkError(
  code: string,
  message: string,
  options: Omit<OpenElementErrorOptions, 'code'> = {},
): OpenElementError {
  return new OpenElementError(message, {
    severity: 'error',
    recoverable: false,
    phase: 'render',
    ...options,
    code,
  });
}
