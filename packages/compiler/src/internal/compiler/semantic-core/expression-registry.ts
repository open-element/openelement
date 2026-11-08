/**
 * M03-I-2 — ExpressionRegistry sidecar (Alpha16a, compiler-private).
 *
 * Design authority: `docs/architecture/m03-expression-identity.md` (M03-B §4):
 * the registry is a **sidecar**, separate from the semantic IR.
 *
 * - IR: `ExprId` references, binding references, tracking semantics (`mode`,
 *   `dependencies`), recipe relationships, authored spans.
 * - Registry (this module): `ExprId` → lowered JS text, lexical captures,
 *   source-map segments, lowering provenance (TypeScript version, transformer
 *   version), plus the A1 `reads`/`dependencies` contract the IR will reference.
 *
 * Hard rules implemented here:
 * - **per compilation**: one registry per module/compilation, created by the
 *   caller; there is no module-level mutable state, no cache and no singleton.
 * - **never serialized**: records are plain in-memory data; the registry has no
 *   wire/serialization API and nothing writes it to disk or the browser.
 * - **released after codegen**: the registry holds no `ts.Node` and no
 *   `TransformationResult`; A4/M05 drop the object when codegen is done.
 * - **compiler-private**: not exported from the package entry, excluded from the
 *   packed payload (see `package.json.files`).
 *
 * A1 is the authority for binding identity, reads, captures and dependencies.
 * This module never re-derives the scope semantics: it resolves the authored
 * expression through `ResolvedModule.resolveExpression` and keeps the result.
 * The one adjustment is a boundary fact: reads that live *inside* a JSX subtree
 * move into that JSX's recipe record when the JSX is replaced by a recipe
 * reference (M03-B §6 — the expression only produces a recipe value, the recipe
 * props are evaluated by the recipe). Those reads, and diagnostics located
 * inside the replaced JSX range, are filtered out of this expression's record;
 * the recipe's own expressions are resolved where the recipe is built.
 */

import ts from 'typescript';
import {
  EXPRESSION_LOWERING_TRANSFORM_VERSION,
  anchorsToSegments,
  isJsxNode,
  lowerExpressionText,
  type LoweredAnchor,
  type RecipeReference,
  type ReplacedJsxSpan,
} from './expression-lowering.ts';
import type { EmissionSegment } from './source-map.ts';
import { bindingKey } from './scope-resolution.ts';
import type {
  BindingId,
  EvaluationMode,
  ExpressionResolution,
  ResolvedModule,
  ResolvedRead,
  ScopeDiagnostic,
  SourceSpan,
  UnresolvedRead,
} from './scope-resolution.ts';

/** Expression identity: unique within one compilation, never serialized. */
export type ExprId = string;

/** Lowering provenance recorded for reproducibility (M03-B §9 risk table). */
export interface LoweringProvenance {
  readonly typescriptVersion: string;
  readonly transformerVersion: string;
}

/** One registry record: what the expression becomes (M03-B §4 sidecar). */
export interface LoweredExpressionRecord {
  /** Unique within this compilation; the IR will hold references to it. */
  readonly id: ExprId;
  /** Marker-free, JSX-free lowered JavaScript text (A3 completes erasure). */
  readonly lowered: string;
  /** Authored span of the expression this record was lowered from. */
  readonly authoredSpan: SourceSpan;
  /** Evaluation mode of the expression (M03-A §5 / M03-B §4). */
  readonly mode: EvaluationMode;
  /** A1 reads outside replaced JSX (binding identity, not names). */
  readonly reads: readonly ResolvedRead[];
  /** Subset of `reads`; the lowered text's free lexical captures. */
  readonly captures: readonly BindingId[];
  /** Subset of `reads`; the reactive reads a tracked slot subscribes to. */
  readonly dependencies: readonly BindingId[];
  /** A1 unresolved reads outside replaced JSX (always empty when a record exists). */
  readonly unresolvedReads: readonly UnresolvedRead[];
  /** Node-start anchors used to build the source-map segments. */
  readonly anchors: readonly LoweredAnchor[];
  /** Source-map segments in the shared `EmissionSegment` convention. */
  readonly segments: readonly EmissionSegment[];
  readonly provenance: LoweringProvenance;
}

/** One lowering attempt: a record, or the source-located reasons it was refused. */
export interface ExpressionLoweringResult {
  readonly record: LoweredExpressionRecord | null;
  readonly diagnostics: readonly ScopeDiagnostic[];
}

/** Host wiring for one registry: the A1 module plus recipe identity. */
export interface ExpressionRegistryOptions {
  readonly module: ResolvedModule;
  /**
   * Supplies the recipe reference for a JSX node inside the expression.
   * Returning `undefined` fails that expression closed (M03-B §6: JSX is never
   * inlined; the recipe identity comes from the same walk that created it).
   */
  readonly recipeReference: (jsx: ts.Node) => RecipeReference | undefined;
}

/** One per compilation; compiler-private and not serializable. */
export interface ExpressionRegistry {
  readonly moduleId: string;
  readonly typescriptVersion: string;
  readonly transformerVersion: string;
  /** Number of lowered records (refused expressions add none). */
  readonly size: number;
  /** Records in deterministic creation order. */
  readonly expressions: readonly LoweredExpressionRecord[];
  /** Look up a record by `ExprId`; `undefined` for unknown or refused ids. */
  get(id: ExprId): LoweredExpressionRecord | undefined;
  /**
   * Lower one authored expression. `node` must belong to the registry module's
   * `sourceFile`. Refused expressions return `record: null` plus diagnostics and
   * never add a record/id.
   */
  lower(node: ts.Node, mode: EvaluationMode): ExpressionLoweringResult;
}

function sourceSpan(sourceFile: ts.SourceFile, node: ts.Node): SourceSpan {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: sourceFile.fileName,
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function isInsideRange(
  span: { readonly start: number },
  ranges: readonly ReplacedJsxSpan[],
): boolean {
  return ranges.some((range) => span.start >= range.start && span.start < range.end);
}

interface FilteredResolution {
  readonly reads: readonly ResolvedRead[];
  readonly captures: readonly BindingId[];
  readonly dependencies: readonly BindingId[];
  readonly unresolvedReads: readonly UnresolvedRead[];
  readonly diagnostics: readonly ScopeDiagnostic[];
}

/** Keep only the resolution facts that belong to the lowered text's own site. */
function filterResolution(
  resolution: ExpressionResolution,
  replacedJsxSpans: readonly ReplacedJsxSpan[],
): FilteredResolution {
  if (replacedJsxSpans.length === 0) {
    return {
      reads: resolution.reads,
      captures: resolution.captures,
      dependencies: resolution.dependencies,
      unresolvedReads: resolution.unresolvedReads,
      diagnostics: resolution.diagnostics,
    };
  }
  const reads = resolution.reads.filter((read) => !isInsideRange(read.span, replacedJsxSpans));
  const readKeys = new Set(reads.map((read) => bindingKey(read.binding)));
  const keep = (ids: readonly BindingId[]): BindingId[] =>
    ids.filter((id) => readKeys.has(bindingKey(id)));
  return {
    reads,
    captures: keep(resolution.captures),
    dependencies: keep(resolution.dependencies),
    unresolvedReads: resolution.unresolvedReads.filter(
      (read) => !isInsideRange(read.span, replacedJsxSpans),
    ),
    diagnostics: resolution.diagnostics.filter(
      (diagnostic) => !isInsideRange(diagnostic.span, replacedJsxSpans),
    ),
  };
}

/**
 * Create the expression registry for one module/compilation.
 *
 * The returned object owns its records; no global state is shared with any
 * other registry. Records are assigned deterministic ids in lowering order.
 */
export function createExpressionRegistry(options: ExpressionRegistryOptions): ExpressionRegistry {
  const { module } = options;
  const sourceFile = module.sourceFile;
  const records: LoweredExpressionRecord[] = [];
  const byId = new Map<ExprId, LoweredExpressionRecord>();
  let ordinal = 0;

  const foreign = (): ScopeDiagnostic => ({
    severity: 'error',
    code: 'OEIR_EXPRESSION_FOREIGN',
    message: 'the expression node does not belong to this registry module',
    span: {
      file: sourceFile.fileName,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    },
    origin: 'module',
  });

  const lower = (node: ts.Node, mode: EvaluationMode): ExpressionLoweringResult => {
    if (node.getSourceFile() !== sourceFile) {
      return { record: null, diagnostics: [foreign()] };
    }
    if (!ts.isExpression(node) && !isJsxNode(node)) {
      return {
        record: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'OEIR_EXPRESSION_INVALID',
            message: 'only an expression or a JSX node can be lowered into an expression record',
            span: sourceSpan(sourceFile, node),
            origin: 'source',
          },
        ],
      };
    }
    const lowered = lowerExpressionText(sourceFile, node, {
      recipeReference: options.recipeReference,
    });
    if (lowered.diagnostics.length > 0) {
      return { record: null, diagnostics: lowered.diagnostics };
    }
    // A1 is the authority for reads/captures/dependencies; never re-derive it.
    const resolved = filterResolution(
      module.resolveExpression(node, mode),
      lowered.replacedJsxSpans,
    );
    if (resolved.diagnostics.length > 0) {
      return { record: null, diagnostics: resolved.diagnostics };
    }
    const segments = anchorsToSegments(lowered.anchors, lowered.text, sourceFile);
    const id: ExprId = `${module.moduleId}#expr${ordinal}`;
    ordinal += 1;
    const record: LoweredExpressionRecord = {
      id,
      lowered: lowered.text,
      authoredSpan: sourceSpan(sourceFile, node),
      mode,
      reads: resolved.reads,
      captures: resolved.captures,
      dependencies: resolved.dependencies,
      unresolvedReads: resolved.unresolvedReads,
      anchors: lowered.anchors,
      segments,
      provenance: {
        typescriptVersion: ts.version,
        transformerVersion: EXPRESSION_LOWERING_TRANSFORM_VERSION,
      },
    };
    records.push(record);
    byId.set(id, record);
    return { record, diagnostics: [] };
  };

  return {
    moduleId: module.moduleId,
    typescriptVersion: ts.version,
    transformerVersion: EXPRESSION_LOWERING_TRANSFORM_VERSION,
    get size(): number {
      return records.length;
    },
    get expressions(): readonly LoweredExpressionRecord[] {
      return records;
    },
    get(id: ExprId): LoweredExpressionRecord | undefined {
      return byId.get(id);
    },
    lower,
  };
}
