/**
 * ./errors.ts — the package's error façade (#1386 item 3).
 *
 * The contract itself (the {@linkcode OpenElementError} class, the code
 * catalogue, and the phase/severity types) is declared once in
 * `../protocol/errors.ts`, which is import-free so the semantic core and the
 * canonical Part Program protocol can raise framework errors. This module
 * re-exports that contract and adds only the pieces that need the rest of the
 * package: the `SsrRenderError`/`RenderError` subclasses and the telemetry
 * hook plumbing.
 */

import type { RenderError as ProtocolRenderError } from '../protocol/render.ts';
import { DEFAULT_RENDER_ERROR_CODE, ErrorCode, OpenElementError } from '../protocol/errors.ts';
import type { ErrorTelemetryHook } from '../protocol/errors.ts';

// ─── Well-known error codes / prefix (authoritative source in protocol) ───────

export {
  AuthoringErrorCode,
  ClaimErrorCode,
  CompilerErrorCode,
  ContextErrorCode,
  DEFAULT_RENDER_ERROR_CODE,
  EachKeyErrorCode,
  ERROR_PREFIX,
  ErrorCode,
  FacadeErrorCode,
  frameworkError,
  KernelErrorCode,
  OpenElementError,
  ProgramErrorCode,
  RuntimeErrorCode,
  ServerErrorCode,
  StyleErrorCode,
} from '../protocol/errors.ts';
export type {
  ErrorPhase,
  ErrorSeverity,
  ErrorTelemetryHook,
  OpenElementErrorOptions,
} from '../protocol/errors.ts';

// ─── Error formatting helper ────────────────────────────────────────

/** Format an unknown thrown value as a human-readable string. */
export function formatError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  let cause: unknown = e.cause;
  const seen = new Set<unknown>([e]);
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(': ');
}

// ─── SsrRenderError ──────────────────────────────────────────────────
// Thrown by the SSG build pipeline (Router cli/build-ssg.ts) when the
// SSR bundle fails to load or the pipeline throws; re-exported via build-utils.ts.

/**
 * Thrown by the SSG build pipeline when the SSR bundle fails to load or the
 * pipeline throws; re-exported via `@openelement/element/build-utils`. Carries
 * the failing component path plus the original error as `cause`.
 */
export class SsrRenderError extends OpenElementError {
  public readonly componentPath: string;
  public readonly sourceError: Error;

  constructor(componentPath: string, sourceError: Error) {
    super(`SSR render failed: ${componentPath}`, {
      code: ErrorCode.SSR_RENDER_ERROR,
      severity: 'error',
      phase: 'ssr',
      recoverable: false,
      cause: sourceError,
    });
    this.name = 'SsrRenderError';
    this.componentPath = componentPath;
    this.sourceError = sourceError;
  }
}

// ─── Error classes ──────────────────────────────────────────────────

/** Recoverable render-phase error carrying the failing component path and tag. */
export class RenderError extends OpenElementError implements ProtocolRenderError {
  public readonly componentPath: string;
  public readonly tagName: string;

  constructor(
    componentPath: string,
    message: string,
    // Annotated `string` on purpose: the default moved from an inline literal
    // to the catalogue constant, and an inferred literal type would narrow this
    // parameter and reject the caller-supplied codes the signature accepts.
    code: string = DEFAULT_RENDER_ERROR_CODE,
    tagName = '',
    cause?: Error,
  ) {
    super(message, {
      code,
      severity: 'error',
      phase: 'render',
      recoverable: true,
      cause,
    });
    this.name = 'RenderError';
    this.componentPath = componentPath;
    this.tagName = tagName;
  }
}

// ─── Error Telemetry ────────────────────────────────────────────────

let _telemetryHook: ErrorTelemetryHook | undefined;

/** Install the process-wide error telemetry hook (replaceable for tests, HMR, multi-app pages). */
export function setErrorTelemetryHook(hook: ErrorTelemetryHook): void {
  // Reconfiguration is intentional (#1099): tests, HMR, and multi-app pages
  // must be able to replace a stale hook without restarting the process.
  _telemetryHook = hook;
}

/** @internal Test isolation only. Not exported from the package public facade. */
export function resetErrorTelemetryHookForTests(): void {
  _telemetryHook = undefined;
}

/** Report an {@linkcode OpenElementError} to the telemetry hook, or console.error when none is installed. */
export function reportError(error: OpenElementError): void {
  if (_telemetryHook) {
    try {
      _telemetryHook(error);
    } catch { /* must not throw */ }
  } else {
    console.error(`[openElement:${error.code}] ${error.message}`);
  }
}
