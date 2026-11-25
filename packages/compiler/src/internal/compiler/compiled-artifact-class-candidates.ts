/** Recover the compiler's shadow stylesheet candidates from a packed module. */

import ts from 'typescript';
import { typescriptParser } from './semantic-core/parse-module.ts';

const CANDIDATE_MEMBER_NAME = '__oeClassCandidates';
const GENERATED_CANDIDATE_FOOTER = '// openElement:class-candidates ';

/** Package staging appends the compiler's candidates to the distributable JS. */
export function encodeCompiledArtifactClassCandidates(candidates: readonly string[]): string {
  if (candidates.length === 0) return '';
  return `\n${GENERATED_CANDIDATE_FOOTER}${JSON.stringify(candidates)}\n`;
}

function generatedCandidateFooter(source: string, file: ts.SourceFile): string | undefined {
  const lastComment = ts
    .getLeadingCommentRanges(source, file.endOfFileToken.getFullStart())
    ?.at(-1);
  if (
    lastComment?.kind !== ts.SyntaxKind.SingleLineCommentTrivia ||
    !source.startsWith(GENERATED_CANDIDATE_FOOTER, lastComment.pos) ||
    source.slice(lastComment.end).trim() !== ''
  ) {
    return undefined;
  }
  return source.slice(lastComment.pos + GENERATED_CANDIDATE_FOOTER.length, lastComment.end);
}

function decodeGeneratedCandidates(footer: string): readonly string[] | undefined {
  try {
    const value: unknown = JSON.parse(footer);
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((candidate) => typeof candidate === 'string' && /^\S+$/u.test(candidate))
    ) {
      return value;
    }
  } catch {
    // A malformed footer contributes no candidates.
  }
  return undefined;
}

/**
 * The admitted class candidates of one compiled artifact module, or undefined
 * when the module does not carry the emitted fact. Generated elements carry
 * a build-only footer, and compiled classes carry their literal static member.
 */
export function compiledArtifactClassCandidates(
  source: string,
  fileName: string,
): readonly string[] | undefined {
  if (!source.includes(CANDIDATE_MEMBER_NAME) && !source.includes(GENERATED_CANDIDATE_FOOTER)) {
    return undefined;
  }
  const { sourceFile: sf } = typescriptParser.parseModule(source, fileName);
  const footer = generatedCandidateFooter(source, sf);
  if (footer !== undefined) return decodeGeneratedCandidates(footer);

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
