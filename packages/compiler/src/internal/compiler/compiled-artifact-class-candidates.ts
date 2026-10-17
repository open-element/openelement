/**
 * The class-candidate facts of an already-compiled artifact module (alpha15 S
 * lane, S5-B).
 *
 * Packages ship the compiler's OWN emitted modules. A consumer build that
 * resolves one has no authored grammar left to compile, yet the module's
 * statically admitted class tokens are exactly the fact the component
 * stylesheet needs — they were proven when the package was compiled, and
 * re-deriving them from the shipped markup would mean a second parser. The
 * compiler therefore emits them as an explicit static
 * (`static __oeClassCandidates: readonly string[] = [...]`, alongside the
 * `__oeUtilityClasses` flag it has always emitted for shadow-root
 * components), and this module recovers them from the artifact text — the
 * same second-input shape as the style-edge recovery
 * (compiled-artifact-style-requests.ts).
 *
 * All-or-nothing per module: a candidates member that is not an array of
 * string literals is not adopted, so a module outside the emitted shape keeps
 * riding the graph's normal channels exactly as before. Never throws, never
 * guesses: an artifact without the member contributes nothing.
 *
 * Root scope is structural: the compiler emits the member ONLY for
 * shadow-root components with admitted candidates (light-root candidates never
 * need the shadow sheet), so a recovered member is by construction a
 * shadow-root fact.
 */

import ts from 'typescript';
import { typescriptParser } from './semantic-core/parse-module.ts';

/** The emitted static's member name (the cheap prefilter and the lookup key). */
const CANDIDATE_MEMBER_NAME = '__oeClassCandidates';

/**
 * The admitted class candidates of one compiled artifact module, or undefined
 * when the module does not carry the emitted fact. Tolerates both artifact
 * forms the pack pipeline produces (the compiler's raw TypeScript emission and
 * the packed, type-stripped module) — the parse is ScriptKind.TSX for exactly
 * the reason the style-edge recovery documents.
 */
export function compiledArtifactClassCandidates(
  source: string,
  fileName: string,
): readonly string[] | undefined {
  if (!source.includes(CANDIDATE_MEMBER_NAME)) return undefined;
  const { sourceFile: sf } = typescriptParser.parseModule(source, fileName);
  let found: readonly string[] | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isPropertyDeclaration(node) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === CANDIDATE_MEMBER_NAME &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const tokens: string[] = [];
      for (const element of node.initializer.elements) {
        if (!ts.isStringLiteral(element)) return; // all-or-nothing
        tokens.push(element.text);
      }
      found = tokens.length === 0 ? undefined : tokens;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}
