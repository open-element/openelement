/**
 * M03-I-0 source-map prototype (spike): **anchor-based** marker printing.
 *
 * Corrections in this revision:
 *  - one pass builds the marker index (missing / duplicate / unknown / unpaired
 *    markers fail closed; author comments are never stripped);
 *  - anchors are merged deterministically for Source Map output (deepest wins),
 *    because a consumer must not see two segments at one generated position;
 *  - the offset index is prefix sums + binary search (O(L + n) setup, O(log n) query).
 *
 * Still a spike: no error recovery, excluded from the published package.
 */

import ts from 'typescript';

/** One mapping anchor: a node's start in generated text and in authored text. */
export interface PrintAnchor {
  readonly generatedStart: number;
  readonly generatedEnd: number;
  readonly authoredStart: number;
  readonly authoredEnd: number;
  readonly depth: number;
  readonly kind: string;
  readonly fromJsx: boolean;
}

/** One merged mapping point, ready for `SourceMapSegmentBuilder`. */
export interface MappingPoint {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
  readonly name?: string;
}

export interface PrintWithAnchorsResult {
  readonly js: string;
  readonly anchors: readonly PrintAnchor[];
  readonly namespace: string;
  readonly diagnostics: readonly string[];
}

interface MarkedNode {
  readonly node: ts.Node;
  readonly id: number;
  readonly depth: number;
  readonly fromJsx: boolean;
}

const MARKER_HINT = '__oe_m_';

/** FNV-1a, used only to make the marker namespace compile-specific. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Internal test seam: extend a candidate namespace until it does not occur in the
 * authored text. Not a public API — the package never exports this module.
 */
export function extendNamespace(sourceText: string, candidate: string): string {
  let namespace = candidate;
  while (sourceText.includes(namespace)) namespace += 'x';
  return namespace;
}

/** A namespace that cannot collide with the authored text. */
export function markerNamespaceFor(sf: ts.SourceFile): string {
  return extendNamespace(sf.text, `${MARKER_HINT}${hashText(sf.text)}_`);
}

/** Nodes worth an anchor: expressions currently covered by the prototype. */
function isAnchorTarget(node: ts.Node): boolean {
  return (
    ts.isExpression(node) ||
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

/** Replace JSX with `__oe_recipe_ref("id")`, keeping the authored range. */
function replaceJsx(
  sf: ts.SourceFile,
  root: ts.Node,
): { root: ts.Node; replaced: Set<ts.Node>; dispose: () => void } {
  const replaced = new Set<ts.Node>();
  let counter = 0;
  const transformer: ts.TransformerFactory<ts.Node> = (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        const call = ts.factory.createCallExpression(
          ts.factory.createIdentifier('__oe_recipe_ref'),
          undefined,
          [ts.factory.createStringLiteral(`r${counter++}`)],
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
  return {
    root: result.transformed[0] ?? root,
    replaced,
    dispose: () => result.dispose(),
  };
}

/** Attach one marker pair per node, using the compile-specific namespace. */
function attachMarkers(root: ts.Node, replaced: Set<ts.Node>, namespace: string): MarkedNode[] {
  const marked: MarkedNode[] = [];
  let id = 0;
  const visit = (node: ts.Node, depth: number): void => {
    const hasRealPosition = node.pos >= 0 && node.end >= 0;
    if (hasRealPosition && isAnchorTarget(node)) {
      const markerId = id++;
      marked.push({ node, id: markerId, depth, fromJsx: replaced.has(node) });
      ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${namespace}s${markerId}`,
        false,
      );
      ts.addSyntheticTrailingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `${namespace}e${markerId}`,
        false,
      );
    }
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  visit(root, 0);
  return marked;
}

/** Internal test seam: one observed marker occurrence. */
export interface MarkerOccurrence {
  readonly kind: 's' | 'e';
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

/** Internal test seam: the result of one marker scan. */
export interface MarkerScan {
  readonly occurrences: readonly MarkerOccurrence[];
  readonly diagnostics: readonly string[];
}

/** One pass over the printed text; anything that is not a namespace marker is untouched. */
/** Internal test seam: one pass over the printed text builds the marker index. */
export function scanMarkers(
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
  const starts = new Set(occurrences.filter((o) => o.kind === 's').map((o) => o.id));
  const ends = new Set(occurrences.filter((o) => o.kind === 'e').map((o) => o.id));
  for (const id of starts) if (!ends.has(id)) diagnostics.push(`marker ${id} is unpaired (no end)`);
  for (const id of ends)
    if (!starts.has(id)) diagnostics.push(`marker ${id} is unpaired (no start)`);
  return { occurrences, diagnostics };
}

interface StrippedMap {
  readonly text: string;
  toStripped(markedOffset: number): number;
}

/** Remove marker ranges and build a prefix-sum index for binary-search lookups. */
function stripMarkers(
  markedText: string,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): StrippedMap {
  const ordered = [...ranges].sort((a, b) => a.start - b.start);
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

/** Print one expression with JSX lowered, returning JavaScript plus anchors. */
export function printExpressionWithAnchors(
  sf: ts.SourceFile,
  expression: ts.Node,
  kindName: (node: ts.Node) => string = (node) => ts.SyntaxKind[node.kind],
): PrintWithAnchorsResult {
  const namespace = markerNamespaceFor(sf);
  const replacedTree = replaceJsx(sf, expression);
  try {
    const marked = attachMarkers(replacedTree.root, replacedTree.replaced, namespace);
    const printer = ts.createPrinter();
    const markedText = printer.printNode(ts.EmitHint.Expression, replacedTree.root, sf);

    const scan = scanMarkers(markedText, namespace, new Set(marked.map((entry) => entry.id)));
    if (scan.diagnostics.length > 0) {
      return { js: markedText, anchors: [], namespace, diagnostics: scan.diagnostics };
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

    const anchors: PrintAnchor[] = [];
    for (const entry of marked) {
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
        authoredStart: entry.node.getStart(sf),
        authoredEnd: entry.node.getEnd(),
        depth: entry.depth,
        kind: kindName(entry.node),
        fromJsx: entry.fromJsx,
      });
    }
    return { js: stripped.text, anchors, namespace, diagnostics: [] };
  } finally {
    replacedTree.dispose();
  }
}

/** Resolve a generated offset to the nearest preceding anchor (deepest on ties). */
export function resolveAnchor(
  anchors: readonly PrintAnchor[],
  generatedOffset: number,
): PrintAnchor | undefined {
  let best: PrintAnchor | undefined;
  for (const anchor of anchors) {
    if (anchor.generatedStart > generatedOffset) continue;
    if (
      best === undefined ||
      anchor.generatedStart > best.generatedStart ||
      (anchor.generatedStart === best.generatedStart && anchor.depth > best.depth)
    ) {
      best = anchor;
    }
  }
  return best;
}

/** Simulate codegen placement: shift every generated offset by a prefix length. */
export function rebaseAnchors(
  anchors: readonly PrintAnchor[],
  prefixLength: number,
): readonly PrintAnchor[] {
  return anchors.map((anchor) => ({
    ...anchor,
    generatedStart: anchor.generatedStart + prefixLength,
    generatedEnd: anchor.generatedEnd + prefixLength,
  }));
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

/** Authored line/column for an offset (1-based line, 0-based column, Source Map v3). */
export function authoredPosition(
  sf: ts.SourceFile,
  offset: number,
): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(Math.min(offset, sf.text.length));
  return { line: lc.line + 1, column: lc.character };
}

/**
 * Merge anchors into mapping points. Several nodes can start at the same generated
 * position (a parent and its first child); a consumer must not receive duplicates,
 * so the deepest anchor survives per generated line/column.
 */
export function mappingPointsFor(
  anchors: readonly PrintAnchor[],
  js: string,
  sf: ts.SourceFile,
): MappingPoint[] {
  const byPosition = new Map<string, PrintAnchor>();
  for (const anchor of anchors) {
    const generated = generatedPosition(js, anchor.generatedStart);
    const key = `${generated.line}:${generated.column}`;
    const existing = byPosition.get(key);
    if (existing === undefined || anchor.depth > existing.depth) byPosition.set(key, anchor);
  }
  const points: MappingPoint[] = [];
  for (const anchor of [...byPosition.values()].sort(
    (a, b) => a.generatedStart - b.generatedStart,
  )) {
    const generated = generatedPosition(js, anchor.generatedStart);
    const authored = authoredPosition(sf, anchor.authoredStart);
    points.push({
      generatedLine: generated.line,
      generatedColumn: generated.column,
      sourceLine: authored.line,
      sourceColumn: authored.column,
      name: anchor.kind,
    });
  }
  return points;
}
