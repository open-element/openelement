/**
 * M03-I-0 source-map prototype (spike): **anchor-based** marker printing.
 *
 * Revised after review. Two corrections matter:
 *
 * 1. **Positions are anchors, not interpolations.** Source Map v3 maps discrete
 *    generated positions to discrete authored positions; it does not assume a
 *    1:1 character relationship inside a node. A JSX node replaced by
 *    `__oe_recipe_ref("r0")` is longer than `<Fallback />`, so "authored + (delta)"
 *    is meaningless. The prototype therefore records **one anchor per node start**
 *    and resolves a generated offset to the nearest preceding anchor.
 * 2. **Markers are namespaced per compilation.** A fixed prefix would let an
 *    author write the same comment text and have their own comment stripped. The
 *    namespace is derived from the source hash, extended until it does not occur
 *    in the authored text, and every expected marker must appear exactly once.
 *
 * Still a spike: no error recovery, excluded from the published package.
 */

import ts from 'typescript';

/** One mapping anchor: a node's start in generated text and in authored text. */
export interface PrintAnchor {
  /** Offset of the node's first character in the generated text (markers removed). */
  readonly generatedStart: number;
  /** Offset one past the node end in generated text (range sanity only). */
  readonly generatedEnd: number;
  /** Authored offset of the node's first character. */
  readonly authoredStart: number;
  /** Authored offset one past the node end. */
  readonly authoredEnd: number;
  /** Depth in the printed subtree; breaks ties toward the innermost node. */
  readonly depth: number;
  /** Node kind name, for debugging only. */
  readonly kind: string;
  /** True when this anchor came from a JSX node replaced by a recipe call. */
  readonly fromJsx: boolean;
}

export interface PrintWithAnchorsResult {
  /** Lowered JavaScript with every marker removed. */
  readonly js: string;
  readonly anchors: readonly PrintAnchor[];
  /** The per-compilation marker namespace (exposed for tests). */
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
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A namespace that cannot collide with the authored text. Deterministic for a
 * given source text, extended while the author happens to contain it.
 */
export function markerNamespaceFor(sf: ts.SourceFile): string {
  let namespace = `${MARKER_HINT}${hashText(sf.text)}_`;
  while (sf.text.includes(namespace)) namespace += 'x';
  return namespace;
}

/** Nodes worth an anchor: every expression plus JSX containers. */
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
    // Synthesized nodes (our recipe call) have no real position and cannot map.
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

interface StrippedMap {
  readonly text: string;
  /** Offset in the stripped text for an offset in the marked text (binary search). */
  toStripped(markedOffset: number): number;
}

/** Remove markers and build a prefix-sum index for O(log n) offset mapping. */
function stripMarkers(markedText: string, markerPattern: RegExp): StrippedMap {
  const removed: Array<{ start: number; end: number; removedBefore: number }> = [];
  let removedTotal = 0;
  for (const match of markedText.matchAll(markerPattern)) {
    const start = match.index ?? 0;
    removed.push({ start, end: start + match[0].length, removedBefore: removedTotal });
    removedTotal += match[0].length;
  }
  let text = '';
  let cursor = 0;
  for (const range of removed) {
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

/**
 * Print one expression (or JSX subtree) with JSX lowered to recipe references,
 * returning JavaScript plus one anchor per expression/JSX node.
 */
export function printExpressionWithAnchors(
  sf: ts.SourceFile,
  expression: ts.Node,
  kindName: (node: ts.Node) => string = (node) => ts.SyntaxKind[node.kind],
): PrintWithAnchorsResult {
  const diagnostics: string[] = [];
  const namespace = markerNamespaceFor(sf);
  const replacedTree = replaceJsx(sf, expression);
  try {
    const marked = attachMarkers(replacedTree.root, replacedTree.replaced, namespace);
    const printer = ts.createPrinter();
    const markedText = printer.printNode(ts.EmitHint.Expression, replacedTree.root, sf);

    const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const markerPattern = new RegExp(`/\\*${escape(namespace)}[se]\\d+\\*/[ \\t]?`, 'g');
    const stripped = stripMarkers(markedText, markerPattern);

    const anchors: PrintAnchor[] = [];
    for (const entry of marked) {
      const startMarker = `/*${namespace}s${entry.id}*/`;
      const endMarker = `/*${namespace}e${entry.id}*/`;
      const startCount = markedText.split(startMarker).length - 1;
      const endCount = markedText.split(endMarker).length - 1;
      if (startCount !== 1 || endCount !== 1) {
        diagnostics.push(
          `marker ${entry.id} appears ${startCount}/${endCount} times (expected exactly once each)`,
        );
        continue;
      }
      const contentStart = markedText.indexOf(startMarker) + startMarker.length;
      const endAt = markedText.indexOf(endMarker);
      if (endAt < contentStart) {
        diagnostics.push(`marker ${entry.id} is out of order`);
        continue;
      }
      let generatedStart = stripped.toStripped(contentStart);
      let generatedEnd = stripped.toStripped(endAt);
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
    return { js: stripped.text, anchors, namespace, diagnostics };
  } finally {
    // M03-B requires the transformed tree to be released once the record exists.
    replacedTree.dispose();
  }
}

/**
 * Resolve a generated offset to an anchor: the last anchor that starts at or
 * before the offset, innermost first. **No arithmetic on authored offsets** — that
 * is the correction this revision makes.
 */
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
