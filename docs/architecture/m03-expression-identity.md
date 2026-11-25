---
status: active
topic: Compiler expression lowering and source maps
summary: Expression identity, type erasure, evaluation order and authored source locations through generated output.
---

# Compiler expression lowering and source maps

Semantic IR records an expression's identity, authored span, binding references
and tracking mode. The separate Expression Registry maps that identity to
lowered JavaScript and its source segments. Both are compiler-private.
Expression identities are unique for a compilation and can change when the
author edits surrounding source. [Expression Registry](../../packages/compiler/src/internal/compiler/semantic-core/expression-registry.ts)

## Lowering rules

1. Transform expressions on the existing TypeScript AST. Erase type annotations,
   assertions, type arguments and other type-only syntax with the erasure visitor.
2. Lower nested JSX to recipe references at the original expression position.
   The expression produces a renderable value. Insertion assigns its owner.
3. Preserve JavaScript evaluation order and source ranges for synthesized nodes.
4. Print the complete transformed expression once with the TypeScript printer.
   Unsupported context-sensitive forms fail with a located diagnostic.
5. Release the transformed AST after recording the text and mappings.

Ordinary locals still evaluate as snapshots. A dependency is tracked by the
admitted expression in its authored evaluation mode, as described in the
[lexical binding model](./m03-scope-resolution.md). Server-only await uses the
[separate server contract](./m14-full-await-definition.md).

## Authored locations

Keep authored TSX positions, lowered JavaScript offsets and final generated
module offsets distinct. Before printing, the lowerer attaches
compilation-specific markers at expression and JSX boundaries. It indexes the
printed markers, strips them, and adjusts each source anchor by the removed
marker lengths. Placement in the generated module rebases those segments.
The anchors preserve node starts and use one-based lines and zero-based columns.
A lowered JSX reference maps back to the original JSX node.

Verify emitted semantics, erasure, ordinary source-map anchors and the authored
location carried by compiler and claim diagnostics. [Expression lowering source](../../packages/compiler/src/internal/compiler/semantic-core/expression-lowering.ts) · [Compiler expression tests](../../packages/compiler/__tests__/semantic-ir/expression-registry.test.ts) · [Historical design record](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/architecture/m03-expression-identity.md)
