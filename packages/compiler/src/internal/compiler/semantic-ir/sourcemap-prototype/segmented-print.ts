/**
 * M03-I-0 source-map prototype (spike): segmented print via synthetic comment
 * markers.
 *
 * The question this answers: with **public TypeScript APIs only**, can we obtain
 * the generated-output offset of every sub-expression we print — without a
 * `ts.Program`, without a second AST, and without a hand-written printer?
 *
 * Method (M1):
 *   1. transform JSX nodes into recipe-reference calls, keeping the authored
 *      range on the replacement node;
 *   2. attach a unique synthetic comment marker before and after every node we
 *      want a segment for;
 *   3. print once with `ts.createPrinter().printNode`;
 *   4. scan the output for markers, strip them, and build a linear mapping from
 *      marked-text offsets to stripped-text offsets;
 *   5. emit segments in authored offsets ↔ generated offsets.
 *
 * This is a measurement spike: it is not the production printer, it has no
 * error recovery, and it is excluded from the published package.
 */

import ts from 'typescript';

export interface PrototypeSegment {
  /** Offset of the segment start in the generated text (after marker stripping). */
  readonly generatedStart: number;
  /** Offset one past the segment end in the generated text. */
  readonly generatedEnd: number;
  /** Authored offset of the first character. */
  readonly authoredStart: number;
  /** Authored offset one past the last character. */
  readonly authoredEnd: number;
  /** Node kind name, for debugging only. */
  readonly kind: string;
  /** True when this segment came from a JSX node replaced by a recipe call. */
  readonly fromJsx: boolean;
}

export interface PrintWithSegmentsResult {
  /** Lowered JavaScript with every marker removed. */
  readonly js: string;
  readonly segments: readonly PrototypeSegment[];
  /** Number of marker pairs attached (diagnostic for the spike). */
  readonly markerCount: number;
  /** Errors the prototype detected (it never silently drops a node). */
  readonly diagnostics: readonly string[];
}

const MARKER_PREFIX = '__oe_marker_';

interface MarkedNode {
  readonly node: ts.Node;
  readonly id: number;
  readonly fromJsx: boolean;
}

/** Nodes worth a segment: every expression plus JSX containers. */
function isSegmentTarget(node: ts.Node): boolean {
  return (
    ts.isExpression(node) ||
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

/**
 * Replace JSX nodes with `__oe_recipe_ref("id")` calls so the printed text is
 * JavaScript. The replacement keeps the authored range.
 */
function replaceJsx(sf: ts.SourceFile, root: ts.Node): { root: ts.Node; replaced: Set<ts.Node> } {
  const replaced = new Set<ts.Node>();
  let counter = 0;
  const transformer: ts.TransformerFactory<ts.Node> = (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        const id = `r${counter++}`;
        const call = ts.factory.createCallExpression(
          ts.factory.createIdentifier('__oe_recipe_ref'),
          undefined,
          [ts.factory.createStringLiteral(id)],
        );
        const positioned = ts.setTextRange(call, node);
        replaced.add(positioned);
        return positioned;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as ts.Node;
  };
  const result = ts.transform(root, [transformer]);
  const transformed = result.transformed[0] ?? root;
  // The transformed tree keeps the same authored positions; the original tree is
  // not released here because the caller still owns the SourceFile.
  return { root: transformed, replaced };
}

/** Attach one marker pair per target node, outside the node's own text. */
function attachMarkers(root: ts.Node, replaced: Set<ts.Node>): MarkedNode[] {
  const marked: MarkedNode[] = [];
  let id = 0;
  const visit = (node: ts.Node): void => {
    // Synthesized nodes (the recipe call we just created) carry no real position
    // and cannot be mapped back; only nodes with a real authored range get markers.
    const hasRealPosition = node.pos >= 0 && node.end >= 0;
    if (hasRealPosition && isSegmentTarget(node)) {
      const markerId = id++;
      marked.push({ node, id: markerId, fromJsx: replaced.has(node) });
      ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${MARKER_PREFIX}s${markerId}`,
        false,
      );
      ts.addSyntheticTrailingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${MARKER_PREFIX}e${markerId}`,
        false,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return marked;
}

const MARKER_PATTERN = /\/\*__oe_marker_[se]\d+\*\/[ \t]?/g;

interface StrippedMap {
  readonly text: string;
  /** Maps an offset in the marked text to an offset in the stripped text. */
  toStripped(markedOffset: number): number;
}

/** Remove markers and keep a linear offset mapping. */
function stripMarkers(markedText: string): StrippedMap {
  const removed: Array<{ start: number; end: number }> = [];
  for (const match of markedText.matchAll(MARKER_PATTERN)) {
    const start = match.index ?? 0;
    removed.push({ start, end: start + match[0].length });
  }
  let text = '';
  let cursor = 0;
  for (const range of removed) {
    text += markedText.slice(cursor, range.start);
    cursor = range.end;
  }
  text += markedText.slice(cursor);
  const toStripped = (markedOffset: number): number => {
    let shift = 0;
    for (const range of removed) {
      if (markedOffset <= range.start) break;
      shift += Math.min(markedOffset, range.end) - range.start;
    }
    return markedOffset - shift;
  };
  return { text, toStripped };
}

/**
 * Print one expression (or JSX subtree) with JSX lowered to recipe references,
 * returning the JavaScript text and a segment per expression/JSX node.
 */
export function printExpressionWithSegments(
  sf: ts.SourceFile,
  expression: ts.Node,
  kindName: (node: ts.Node) => string = (node) => ts.SyntaxKind[node.kind],
): PrintWithSegmentsResult {
  const diagnostics: string[] = [];
  const { root, replaced } = replaceJsx(sf, expression);
  const marked = attachMarkers(root, replaced);
  const printer = ts.createPrinter();
  const markedText = printer.printNode(ts.EmitHint.Expression, root, sf);
  const stripped = stripMarkers(markedText);

  const segments: PrototypeSegment[] = [];
  for (const entry of marked) {
    const startMarker = `/*${MARKER_PREFIX}s${entry.id}*/`;
    const endMarker = `/*${MARKER_PREFIX}e${entry.id}*/`;
    const startAt = markedText.indexOf(startMarker);
    const endAt = markedText.indexOf(endMarker);
    if (startAt === -1 || endAt === -1 || endAt < startAt) {
      diagnostics.push(`marker ${entry.id} missing from printed output`);
      continue;
    }
    let generatedStart = stripped.toStripped(startAt + startMarker.length);
    let generatedEnd = stripped.toStripped(endAt);
    // Markers sit outside the node's text, but the printer may have emitted
    // separating whitespace around them. Authored positions never start or end
    // with trivia, so trimming whitespace at both ends restores the node's own
    // generated extent.
    while (generatedStart < generatedEnd && /\s/.test(stripped.text[generatedStart] ?? ''))
      generatedStart += 1;
    while (generatedEnd > generatedStart && /\s/.test(stripped.text[generatedEnd - 1] ?? ''))
      generatedEnd -= 1;
    segments.push({
      generatedStart,
      generatedEnd,
      authoredStart: entry.node.getStart(sf),
      authoredEnd: entry.node.getEnd(),
      kind: kindName(entry.node),
      fromJsx: entry.fromJsx,
    });
  }

  return { js: stripped.text, segments, markerCount: marked.length, diagnostics };
}

/**
 * Simulate codegen placement: the expression text is inserted after `prefix`
 * characters of generated output. Returns the shifted segments.
 */
export function rebaseSegments(
  segments: readonly PrototypeSegment[],
  prefixLength: number,
): readonly PrototypeSegment[] {
  return segments.map((segment) => ({
    ...segment,
    generatedStart: segment.generatedStart + prefixLength,
    generatedEnd: segment.generatedEnd + prefixLength,
  }));
}

/** Resolve a generated offset to an authored offset using the innermost segment. */
export function resolveAuthoredOffset(
  segments: readonly PrototypeSegment[],
  generatedOffset: number,
): number | undefined {
  let best: PrototypeSegment | undefined;
  for (const segment of segments) {
    if (generatedOffset < segment.generatedStart || generatedOffset > segment.generatedEnd)
      continue;
    if (
      best === undefined ||
      segment.generatedEnd - segment.generatedStart < best.generatedEnd - best.generatedStart
    ) {
      best = segment;
    }
  }
  if (best === undefined) return undefined;
  return best.authoredStart + (generatedOffset - best.generatedStart);
}

/** Authored line/column for an offset (1-based line, 0-based column, Source Map v3). */
export function authoredPosition(
  sf: ts.SourceFile,
  offset: number,
): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(Math.min(offset, sf.text.length));
  return { line: lc.line + 1, column: lc.character };
}

/** Generated line/column for an offset in a generated text (1-based / 0-based). */
export function generatedPosition(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const clamped = Math.min(offset, text.length);
  for (let index = 0; index < clamped; index++) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: clamped - lineStart };
}
