/**
 * M03-I-2 — expression lowering text mechanics (Alpha16a, compiler-private).
 *
 * Design authority: `docs/architecture/m03-expression-identity.md` (M03-B) and
 * `docs/architecture/m03-i0-sourcemap-prototype.md` (M03-I-0, adopted M1
 * mechanism). This module is the **production** transform behind Route 3:
 *
 *   1. transform the existing SourceFile (no reparse): every JSX node in the
 *      expression is replaced 1:1 by a caller-supplied recipe **reference**
 *      call at the same authored position (`setTextRange`);
 *   2. attach a namespaced synthetic comment around every expression/JSX node
 *      so the public printer can report one **anchor** (node start) per node;
 *   3. print once with `ts.createPrinter().printNode(EmitHint.Expression)`;
 *   4. index the markers in one pass, strip them through prefix sums + binary
 *      search, trim at anchor boundaries, and resolve generated offsets;
 *   5. restore the temporarily-attached synthetic comments and dispose the
 *      `TransformationResult` in a `finally` — no transformed tree survives the
 *      call.
 *
 * Deliberate boundaries:
 *
 * - **Erasure is integrated (M03-I-3, A3).** `type-erasure.ts` strips the
 *   admitted TypeScript-only syntax inside the same transform (before/with JSX
 *   replacement); anything outside that set still fails closed
 *   (`OEIR_ERASURE_UNSUPPORTED` for class authoring, plus the context matrix).
 *   The differential `ts.transpileModule` erasure oracle lives in tests only.
 * - **No production compile-path wiring.** A4 owns the component frontend; the
 *   registry is a sidecar M05 consumes, not a stage in the current pipeline.
 * - **No runtime recipe naming.** The recipe-reference call shape is supplied by
 *   the caller (`RecipeReference`); this module invents no runtime identifier.
 * - **End-to-end module source map is M05.** This module produces expression
 *   segments in the existing `EmissionSegment` convention and supports codegen
 *   rebasing; composing them into the generated module's map is M05's job.
 *
 * Diagnostics reuse the A1 resolver's source-located shape (`ScopeDiagnostic`,
 * `SourceSpan`), so one module's diagnostics aggregate without translation.
 */

import ts from 'typescript';
import type { ScopeDiagnostic, SourceSpan } from './scope-resolution.ts';
import type { EmissionSegment } from './source-map.ts';
import { collectErasureBoundaryRefusals, eraseTypeScriptSyntax } from './type-erasure.ts';

/** Bump when the marker/print/erasure pipeline changes; recorded in the registry. */
export const EXPRESSION_LOWERING_TRANSFORM_VERSION = 'alpha16a-m03-i3.1';

/** Prefix of the synthetic marker namespace (derived from the source hash). */
const MARKER_PREFIX = '__oe_lm_';

/** A recipe reference supplied by the caller: `callee("id")` replaces the JSX. */
export interface RecipeReference {
  /** A valid JavaScript identifier (validated; the caller owns the naming). */
  readonly callee: string;
  /** Recipe identity (M02 `IrRecipe.id`), emitted as the string argument. */
  readonly id: string;
}

/** One mapped node: generated start/end and authored start/end. */
export interface LoweredAnchor {
  readonly generatedStart: number;
  readonly generatedEnd: number;
  readonly authoredStart: number;
  readonly authoredEnd: number;
  /** AST depth from the printed expression root (0 = root). */
  readonly depth: number;
  readonly kind: string;
  /** True when this anchor is a JSX node replaced by a recipe reference. */
  readonly fromJsx: boolean;
  /** Authored identifier text, when this anchor is an identifier. */
  readonly name?: string;
}

/** A half-open authored range of one replaced JSX node. */
export interface ReplacedJsxSpan {
  readonly start: number;
  readonly end: number;
}

export interface LowerExpressionTextOptions {
  /**
   * Supplies the recipe reference for a JSX node in the expression. Returning
   * `undefined` refuses the expression (fail closed): the caller must not ship a
   * lowered text whose JSX has no recipe identity.
   */
  readonly recipeReference: (jsx: ts.Node) => RecipeReference | undefined;
  /**
   * Internal test seam: observes the `TransformationResult` lifecycle. The
   * production registry never passes it. `created`/`disposed` are called exactly
   * once per transform when the pipeline reached the transform at all.
   */
  readonly lifecycle?: LoweringLifecycle;
}

/** Internal test seam for the transform/dispose contract. */
export interface LoweringLifecycle {
  readonly created?: () => void;
  readonly disposed?: () => void;
}

/** The lowered text plus everything the registry needs to build its record. */
export interface LoweredExpressionText {
  /** Marker-free, JSX-free printed JavaScript (A3 completes TS-only erasure). */
  readonly text: string;
  readonly anchors: readonly LoweredAnchor[];
  /** Authored ranges of the JSX nodes that were replaced by recipe references. */
  readonly replacedJsxSpans: readonly ReplacedJsxSpan[];
  readonly diagnostics: readonly ScopeDiagnostic[];
}

/** One observed synthetic marker occurrence (internal test seam). */
export interface MarkerOccurrence {
  readonly kind: 's' | 'e';
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

/** The result of one marker scan (internal test seam). */
export interface MarkerScan {
  readonly occurrences: readonly MarkerOccurrence[];
  readonly diagnostics: readonly string[];
}

/** `true` for the JSX nodes M03 replaces with recipe references. */
export function isJsxNode(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

// ─── Spans / diagnostics ────────────────────────────────────────────────────

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

function refusal(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
): ScopeDiagnostic {
  return { severity: 'error', code, message, span: sourceSpan(sourceFile, node), origin: 'source' };
}

// ─── Fail-closed refusal facts (context matrix + erasure boundary) ──────────

/** Whether `node` is an identifier occurrence evaluated as a value. */
function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isPropertyAssignment(parent)) return parent.name !== node;
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node;
  if (ts.isBindingElement(parent)) return false;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) return false;
  if (
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent)
  ) {
    return false;
  }
  if (
    ts.isImportClause(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isNamespaceExport(parent)
  ) {
    return false;
  }
  if (ts.isLabeledStatement(parent)) return false;
  if (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
  if (ts.isJsxAttribute(parent) || ts.isJsxNamespacedName(parent) || ts.isMetaProperty(parent)) {
    return false;
  }
  return true;
}

/** Collect the M03-B §6 context-sensitive constructs (JSX interiors excluded). */
function collectContextRefusals(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  diagnostics: ScopeDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    // JSX subtrees are recipe interiors (separate expressions owned by the
    // recipe walk), not part of the lowered expression's own evaluation.
    if (isJsxNode(node)) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_UNSUPPORTED_THIS',
          'a function component has no `this`; use the props parameter',
        ),
      );
      return;
    }
    if (node.kind === ts.SyntaxKind.SuperKeyword) {
      diagnostics.push(
        refusal(sourceFile, node, 'OEIR_UNSUPPORTED_SUPER', '`super` is not part of the model'),
      );
      return;
    }
    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.NewKeyword &&
      node.name.text === 'target'
    ) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_UNSUPPORTED_NEW_TARGET',
          '`new.target` is not part of the function-component model',
        ),
      );
      return;
    }
    if (ts.isAwaitExpression(node)) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_AWAIT_OUTSIDE_ASYNC',
          '`await` is only admitted inside an async server component (M14); not in M03',
        ),
      );
      return;
    }
    if (ts.isYieldExpression(node)) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_UNSUPPORTED_GENERATOR',
          'generators are not part of the function-component model',
        ),
      );
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'arguments' && isValueIdentifier(node)) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_UNSUPPORTED_ARGUMENTS',
          '`arguments` is not part of the function-component model',
        ),
      );
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'eval' && isValueIdentifier(node)) {
      diagnostics.push(
        refusal(
          sourceFile,
          node,
          'OEIR_DYNAMIC_SCOPE',
          'eval introduces dynamic scope; forbidden by the static resolution model',
        ),
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

// ─── JSX → recipe reference replacement (1:1, same authored position) ──────

interface ReplacementResult {
  readonly root: ts.Node;
  readonly replaced: ReadonlySet<ts.Node>;
  readonly spans: ReplacedJsxSpan[];
  readonly diagnostics: readonly ScopeDiagnostic[];
  readonly dispose: () => void;
}

const JAVASCRIPT_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function replaceJsxReferences(
  sourceFile: ts.SourceFile,
  root: ts.Node,
  options: LowerExpressionTextOptions,
): ReplacementResult {
  const replaced = new Set<ts.Node>();
  const spans: ReplacedJsxSpan[] = [];
  const diagnostics: ScopeDiagnostic[] = [];
  const transformer: ts.TransformerFactory<ts.Node> = (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (isJsxNode(node)) {
        const reference = options.recipeReference(node);
        if (reference === undefined) {
          diagnostics.push(
            refusal(
              sourceFile,
              node,
              'OEIR_RECIPE_REFERENCE_MISSING',
              'the JSX node has no recipe reference: the caller must create the recipe in the same walk',
            ),
          );
          return node;
        }
        if (!JAVASCRIPT_IDENTIFIER.test(reference.callee)) {
          diagnostics.push(
            refusal(
              sourceFile,
              node,
              'OEIR_RECIPE_CALLEE_INVALID',
              `recipe reference callee '${reference.callee}' is not a valid JavaScript identifier`,
            ),
          );
          return node;
        }
        spans.push({ start: node.getStart(sourceFile), end: node.getEnd() });
        const call = ts.factory.createCallExpression(
          ts.factory.createIdentifier(reference.callee),
          undefined,
          [ts.factory.createStringLiteral(reference.id)],
        );
        // The replacement keeps the authored range: provenance points at the
        // JSX node, never at an "authored offset + delta" inside the call.
        const positioned = ts.setTextRange(call, node);
        replaced.add(positioned);
        return positioned;
      }
      // Erasure runs in the same traversal/print as the JSX substitution, so
      // one transform + one printer pass covers both (M03-B Route 3).
      const erased = eraseTypeScriptSyntax(node, visit);
      if (erased !== undefined) return erased;
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as ts.Node;
  };
  const result = ts.transform(root, [transformer]);
  options.lifecycle?.created?.();
  return {
    root: result.transformed[0] ?? root,
    replaced,
    spans,
    diagnostics,
    dispose: () => {
      try {
        result.dispose();
      } finally {
        options.lifecycle?.disposed?.();
      }
    },
  };
}

// ─── Marker printing (adopted M1, production port of M03-I-0) ───────────────

/** FNV-1a over the authored text; only makes the marker namespace compile-specific. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The marker namespace for one source file. Namespace is extended while it
 * occurs in the authored text, so an author comment can never collide with a
 * synthetic marker (I-0 rule; regression-tested by the prototype).
 */
export function markerNamespaceFor(sourceFile: ts.SourceFile): string {
  let namespace = `${MARKER_PREFIX}${hashText(sourceFile.text)}_`;
  while (sourceFile.text.includes(namespace)) namespace += 'x';
  return namespace;
}

/** One pass over the printed text; anything that is not a namespace marker is untouched. */
export function scanLoweringMarkers(
  markedText: string,
  namespace: string,
  expectedIds: ReadonlySet<number>,
): MarkerScan {
  const diagnostics: string[] = [];
  const occurrences: MarkerOccurrence[] = [];
  const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`/\\*${escaped}([se])(\\d+)\\*/`, 'g');
  for (const match of markedText.matchAll(pattern)) {
    const start = match.index ?? 0;
    occurrences.push({
      kind: match[1] as 's' | 'e',
      id: Number(match[2]),
      start,
      end: start + match[0].length,
    });
  }
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (!expectedIds.has(occurrence.id)) {
      diagnostics.push(`unknown marker id ${occurrence.id} in the printed output`);
      continue;
    }
    const key = `${occurrence.kind}${occurrence.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) diagnostics.push(`marker ${key} appears ${count} times (expected exactly once)`);
  }
  for (const id of expectedIds) {
    if (!counts.has(`s${id}`)) diagnostics.push(`start marker ${id} is missing`);
    if (!counts.has(`e${id}`)) diagnostics.push(`end marker ${id} is missing`);
  }
  const starts = new Set(
    occurrences.filter((occurrence) => occurrence.kind === 's').map((o) => o.id),
  );
  const ends = new Set(
    occurrences.filter((occurrence) => occurrence.kind === 'e').map((o) => o.id),
  );
  for (const id of starts) if (!ends.has(id)) diagnostics.push(`marker ${id} is unpaired (no end)`);
  for (const id of ends)
    if (!starts.has(id)) diagnostics.push(`marker ${id} is unpaired (no start)`);
  return { occurrences, diagnostics };
}

interface StrippedMap {
  readonly text: string;
  toStripped(markedOffset: number): number;
}

/** Remove marker ranges and build a prefix-sum index for O(log n) lookups. */
function stripMarkers(
  markedText: string,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): StrippedMap {
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  const removed: Array<{ start: number; end: number; removedBefore: number }> = [];
  let removedTotal = 0;
  for (const range of ordered) {
    removed.push({ start: range.start, end: range.end, removedBefore: removedTotal });
    removedTotal += range.end - range.start;
  }
  let text = '';
  let cursor = 0;
  for (const range of ordered) {
    text += markedText.slice(cursor, range.start);
    cursor = range.end;
  }
  text += markedText.slice(cursor);
  const toStripped = (markedOffset: number): number => {
    let low = 0;
    let high = removed.length - 1;
    let index = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (removed[middle]!.start < markedOffset) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (index < 0) return markedOffset;
    const range = removed[index]!;
    const inside = Math.min(markedOffset, range.end) - range.start;
    return markedOffset - range.removedBefore - inside;
  };
  return { text, toStripped };
}

interface MarkedTarget {
  readonly node: ts.Node;
  readonly id: number;
  readonly depth: number;
  readonly fromJsx: boolean;
}

/** `true` when the printed node has an authored position to map back to. */
function hasRealPosition(node: ts.Node): boolean {
  return node.pos >= 0 && node.end >= 0;
}

interface MarkedTree {
  readonly root: ts.Node;
  readonly marked: readonly MarkedTarget[];
}

interface SyntheticCommentSnapshot {
  readonly restore: () => void;
}

/**
 * Capture the synthetic-comment state of every node in the expression before the
 * transform runs. The transform and `TransformationResult.dispose()` clear the
 * emit-node state of authored nodes, so pre-existing synthetic metadata is
 * reinstated from this snapshot after disposal.
 */
function snapshotSyntheticComments(root: ts.Node): SyntheticCommentSnapshot {
  const saved: Array<{
    node: ts.Node;
    leading: ReturnType<typeof ts.getSyntheticLeadingComments>;
    trailing: ReturnType<typeof ts.getSyntheticTrailingComments>;
  }> = [];
  const visit = (node: ts.Node): void => {
    const leading = ts.getSyntheticLeadingComments(node);
    const trailing = ts.getSyntheticTrailingComments(node);
    if (leading !== undefined || trailing !== undefined) saved.push({ node, leading, trailing });
    ts.forEachChild(node, visit);
  };
  visit(root);
  return {
    restore: () => {
      for (const entry of saved) {
        ts.setSyntheticLeadingComments(entry.node, entry.leading);
        ts.setSyntheticTrailingComments(entry.node, entry.trailing);
      }
    },
  };
}

/**
 * Attach synthetic markers to one node start per expression/JSX node. The
 * authored AST may be touched here (identity transforms keep authored nodes),
 * so the caller MUST call `restore()`; it reinstates the exact previous
 * synthetic-comment state and is safe when the printer throws.
 */
function markAnchorTargets(
  root: ts.Node,
  replaced: ReadonlySet<ts.Node>,
  namespace: string,
): MarkedTree {
  const marked: MarkedTarget[] = [];
  let nextId = 0;
  const visit = (node: ts.Node, depth: number): void => {
    if (hasRealPosition(node) && (ts.isExpression(node) || isJsxNode(node))) {
      const id = nextId++;
      marked.push({ node, id, depth, fromJsx: replaced.has(node) });
      ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${namespace}s${id}`,
        false,
      );
      ts.addSyntheticTrailingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${namespace}e${id}`,
        false,
      );
    }
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return { root, marked };
}

interface PrintedWithAnchors {
  readonly text: string;
  readonly anchors: LoweredAnchor[];
  readonly diagnostics: ScopeDiagnostic[];
}

/** Print the marked tree once and resolve every marker anchor. */
function printWithAnchors(
  sourceFile: ts.SourceFile,
  markedTree: MarkedTree,
  expressionSpan: SourceSpan,
): PrintedWithAnchors {
  const namespace = markerNamespaceFor(sourceFile);
  {
    const printer = ts.createPrinter();
    const markedText = printer.printNode(ts.EmitHint.Expression, markedTree.root, sourceFile);
    const expected = new Set(markedTree.marked.map((entry) => entry.id));
    const scan = scanLoweringMarkers(markedText, namespace, expected);
    if (scan.diagnostics.length > 0) {
      return {
        text: markedText,
        anchors: [],
        diagnostics: [
          {
            severity: 'error',
            code: 'OEIR_LOWERING_MARKER',
            message: `internal lowering marker failure: ${scan.diagnostics.join('; ')}`,
            span: expressionSpan,
            origin: 'source',
          },
        ],
      };
    }
    const starts = new Map<number, MarkerOccurrence>();
    const ends = new Map<number, MarkerOccurrence>();
    for (const occurrence of scan.occurrences) {
      (occurrence.kind === 's' ? starts : ends).set(occurrence.id, occurrence);
    }
    const stripped = stripMarkers(
      markedText,
      scan.occurrences.map((occurrence) => ({ start: occurrence.start, end: occurrence.end })),
    );
    const anchors: LoweredAnchor[] = [];
    for (const entry of markedTree.marked) {
      const startMarker = starts.get(entry.id);
      const endMarker = ends.get(entry.id);
      if (startMarker === undefined || endMarker === undefined) continue;
      let generatedStart = stripped.toStripped(startMarker.end);
      let generatedEnd = stripped.toStripped(endMarker.start);
      while (generatedStart < generatedEnd && /\s/.test(stripped.text[generatedStart] ?? '')) {
        generatedStart += 1;
      }
      while (generatedEnd > generatedStart && /\s/.test(stripped.text[generatedEnd - 1] ?? '')) {
        generatedEnd -= 1;
      }
      anchors.push({
        generatedStart,
        generatedEnd,
        authoredStart: entry.node.getStart(sourceFile),
        authoredEnd: entry.node.getEnd(),
        depth: entry.depth,
        kind: ts.SyntaxKind[entry.node.kind],
        fromJsx: entry.fromJsx,
        ...(ts.isIdentifier(entry.node) ? { name: entry.node.text } : {}),
      });
    }
    return { text: stripped.text, anchors, diagnostics: [] };
  }
}

/** Generated line/column for an offset (1-based line, 0-based column). */
function generatedPosition(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const clamped = Math.min(Math.max(offset, 0), text.length);
  for (let index = 0; index < clamped; index++) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: clamped - lineStart };
}

/** Authored line/column for an offset (1-based line, 0-based column). */
function authoredPosition(
  sourceFile: ts.SourceFile,
  offset: number,
): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(
    Math.min(Math.max(offset, 0), sourceFile.text.length),
  );
  return { line: position.line + 1, column: position.character };
}

/**
 * Merge anchors into source-map segments (deepest node wins at one generated
 * position — M03-I-0 rule 3) in the existing `EmissionSegment` convention.
 */
export function anchorsToSegments(
  anchors: readonly LoweredAnchor[],
  loweredText: string,
  sourceFile: ts.SourceFile,
): EmissionSegment[] {
  const byPosition = new Map<string, LoweredAnchor>();
  for (const anchor of anchors) {
    const position = generatedPosition(loweredText, anchor.generatedStart);
    const key = `${position.line}:${position.column}`;
    const existing = byPosition.get(key);
    if (existing === undefined || anchor.depth > existing.depth) byPosition.set(key, anchor);
  }
  return [...byPosition.values()]
    .sort((left, right) => left.generatedStart - right.generatedStart)
    .map((anchor) => {
      const generated = generatedPosition(loweredText, anchor.generatedStart);
      const authored = authoredPosition(sourceFile, anchor.authoredStart);
      return {
        generatedLine: generated.line,
        generatedColumn: generated.column,
        sourceLine: authored.line,
        sourceColumn: authored.column,
        ...(anchor.name === undefined ? {} : { name: anchor.name }),
      };
    });
}

/** Where a lowered text is placed in the generated module. */
export interface SegmentPlacement {
  /** 1-based line where the lowered text starts. */
  readonly generatedLine: number;
  /** 0-based column where the lowered text starts on that line. */
  readonly generatedColumn: number;
}

/**
 * Codegen placement rebase (M03-B §5): segments are never recomputed
 * downstream; the placement offset is added once. Only the first generated line
 * is column-shifted; every later line keeps its column and shifts by line only.
 */
export function rebaseSegments(
  segments: readonly EmissionSegment[],
  placement: SegmentPlacement,
): EmissionSegment[] {
  if (
    !Number.isInteger(placement.generatedLine) ||
    placement.generatedLine < 1 ||
    !Number.isInteger(placement.generatedColumn) ||
    placement.generatedColumn < 0
  ) {
    throw new RangeError(
      `invalid segment placement ${JSON.stringify(placement)}: expected 1-based line, 0-based column`,
    );
  }
  return segments.map((segment) => ({
    ...segment,
    generatedLine: placement.generatedLine + (segment.generatedLine - 1),
    generatedColumn:
      segment.generatedLine === 1
        ? placement.generatedColumn + segment.generatedColumn
        : segment.generatedColumn,
  }));
}

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Lower one authored expression to JavaScript text with JSX replaced by recipe
 * references, returning node-start anchors and the replaced JSX authored spans.
 *
 * Fail-closed: any refusal (needs erasure, context-sensitive construct, missing
 * recipe reference, marker failure) yields diagnostics and empty text/anchors;
 * the caller must not emit anything for it. The `TransformationResult` is always
 * disposed, and synthetic comment state is always restored.
 */
export function lowerExpressionText(
  sourceFile: ts.SourceFile,
  expression: ts.Node,
  options: LowerExpressionTextOptions,
): LoweredExpressionText {
  const diagnostics: ScopeDiagnostic[] = [];
  const expressionSpan = sourceSpan(sourceFile, expression);
  collectContextRefusals(sourceFile, expression, diagnostics);
  collectErasureBoundaryRefusals(sourceFile, expression, diagnostics);
  if (diagnostics.length > 0) {
    return { text: '', anchors: [], replacedJsxSpans: [], diagnostics };
  }
  const comments = snapshotSyntheticComments(expression);
  const replacement = replaceJsxReferences(sourceFile, expression, options);
  let markedTree: MarkedTree | undefined;
  try {
    if (replacement.diagnostics.length > 0) {
      return {
        text: '',
        anchors: [],
        replacedJsxSpans: [],
        diagnostics: [...replacement.diagnostics],
      };
    }
    markedTree = markAnchorTargets(
      replacement.root,
      replacement.replaced,
      markerNamespaceFor(sourceFile),
    );
    const printed = printWithAnchors(sourceFile, markedTree, expressionSpan);
    return {
      text: printed.text,
      anchors: printed.anchors,
      replacedJsxSpans: replacement.spans,
      diagnostics: printed.diagnostics,
    };
  } finally {
    // Dispose first: TransformationResult.dispose() clears the emitNode state on
    // the transformed (possibly authored) nodes, so the pre-transform snapshot
    // must be reinstated after it, not before.
    replacement.dispose();
    comments.restore();
  }
}
