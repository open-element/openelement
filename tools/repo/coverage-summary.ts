import { walk } from '@std/fs/walk';
import ts from 'typescript';
import { parseTypeScript } from '../lib/typescript-ast.ts';

export interface CoverageMetric {
  covered: number;
  total: number;
  percentage: number;
}

export interface CoverageSummary {
  lines: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
}

interface FileCoverage {
  lines: Map<string, boolean>;
  branches: Map<string, boolean>;
  functions: Map<string, boolean>;
}

/** Only versioned, publishable runtime sources belong in the release coverage gate. */
export function isProductionPackageSource(path: string): boolean {
  return (
    (isPackageSource(path) || isToolsLibSource(path)) &&
    !path.includes('/__tests__/')
  );
}

/** Publishable package runtime source under packages/<name>/src. */
export function isPackageSource(path: string): boolean {
  return /\/packages\/[^/]+\/src\//.test(path);
}

/** Shared release tooling library under the repository-root tools/lib. */
export function isToolsLibSource(path: string): boolean {
  return /\/tools\/lib\//.test(path) && !/\/www\/tools\/lib\//.test(path);
}

/** Site-owned shared libraries under www/tools/lib (the testable layer;
 * CLI entry scripts are exercised by gate runs, not unit coverage). */
export function isWwwToolsSource(path: string): boolean {
  return /\/www\/tools\/lib\//.test(path);
}

export function parseLcov(
  lcov: string,
  include: (path: string) => boolean = isProductionPackageSource,
): CoverageSummary {
  const files = new Map<string, FileCoverage>();
  let currentPath = '';
  let current: FileCoverage | undefined;

  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      currentPath = line.slice(3);
      current = files.get(currentPath) ?? {
        lines: new Map(),
        branches: new Map(),
        functions: new Map(),
      };
      files.set(currentPath, current);
    } else if (current && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',');
      mergeHit(current.lines, lineNumber, Number(hits) > 0);
    } else if (current && line.startsWith('BRDA:')) {
      const [lineNumber, block, branch, hits] = line.slice(5).split(',');
      mergeHit(
        current.branches,
        `${lineNumber}:${block}:${branch}`,
        hits !== '-' && Number(hits) > 0,
      );
    } else if (current && line.startsWith('FNDA:')) {
      const [hits, ...name] = line.slice(5).split(',');
      mergeHit(current.functions, name.join(','), Number(hits) > 0);
    } else if (line === 'end_of_record') {
      currentPath = '';
      current = undefined;
    }
  }

  const included = [...files.entries()]
    .filter(([path]) => include(path) && !path.includes('/__tests__/'))
    .map(([, coverage]) => coverage);
  return {
    lines: metric(included.flatMap((file) => [...file.lines.values()])),
    branches: metric(included.flatMap((file) => [...file.branches.values()])),
    functions: metric(included.flatMap((file) => [...file.functions.values()])),
  };
}

function mergeHit(values: Map<string, boolean>, key: string, hit: boolean): void {
  values.set(key, (values.get(key) ?? false) || hit);
}

function metric(values: boolean[]): CoverageMetric {
  const covered = values.filter(Boolean).length;
  return {
    covered,
    total: values.length,
    percentage: values.length ? covered / values.length * 100 : 0,
  };
}

/** Coverable-element counts estimated for a source file absent from LCOV. */
export interface CoverableCounts {
  lines: number;
  branches: number;
  functions: number;
}

/**
 * Paths that never belong in the coverage denominator: test/spec code,
 * fixture trees, generated modules, and pure declaration files.
 */
export function isCoverageTreeExcluded(path: string): boolean {
  return path.includes('/__tests__/') ||
    path.includes('/__fixtures__/') ||
    path.includes('/fixtures/') ||
    /\.(test|spec)\.tsx?$/u.test(path) ||
    /\.d\.ts$/u.test(path) ||
    /(^|\/)generated[-_.]/u.test(path);
}

/**
 * Enumerate every in-scope source file under `root` so files that no test
 * ever loads still enter the coverage denominator (Deno coverage only
 * profiles modules that were actually imported during the test run).
 */
export async function enumerateCoverageFiles(
  root: string,
  include: (path: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of walk(root, { exts: ['.ts', '.tsx'], includeDirs: false })) {
    const path = entry.path;
    if (
      path.includes('/node_modules/') ||
      path.includes('/vendor/') ||
      path.includes('/dist/') ||
      path.includes('/.coverage')
    ) {
      continue;
    }
    if (!include(path) || isCoverageTreeExcluded(path)) continue;
    files.push(path);
  }
  return files.sort();
}

/** Absolute paths of every file present in an LCOV report. */
export function lcovFilePaths(lcov: string): Set<string> {
  const paths = new Set<string>();
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) paths.add(line.slice(3));
  }
  return paths;
}

function hasDeclareModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
}

/**
 * Estimate the coverable lines/branches/functions of a source file via the
 * TypeScript AST. Used only for files missing from LCOV, where every
 * coverable element is by definition uncovered. Approximation contract
 * (calibrated against `deno coverage` output): each decision point (if,
 * ternary, loop, catch, `&&`/`||`/`??`) yields two branch slots, each
 * case/default clause one; type-only constructs (interfaces, type aliases,
 * `import type`, `declare`) yield nothing.
 */
export function countCoverableElements(source: string, path = 'source.ts'): CoverableCounts {
  const file = parseTypeScript(source, path);
  const lines = new Set<number>();
  let functions = 0;
  let branches = 0;
  const startLine = (node: ts.Node): number =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  const visit = (node: ts.Node): void => {
    // `declare` subtrees are pure ambient types: no code, nothing coverable.
    if (hasDeclareModifier(node)) return;
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) lines.add(startLine(node));
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) lines.add(startLine(node));
    } else if (
      ts.isStatement(node) &&
      !ts.isInterfaceDeclaration(node) &&
      !ts.isTypeAliasDeclaration(node) &&
      !ts.isModuleDeclaration(node)
    ) {
      lines.add(startLine(node));
    } else if (
      ts.isExpression(node) &&
      !ts.isIdentifier(node) &&
      !ts.isStringLiteral(node) &&
      !ts.isNumericLiteral(node)
    ) {
      lines.add(startLine(node));
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)) && node.body
    ) {
      functions++;
    }

    if (
      ts.isIfStatement(node) || ts.isConditionalExpression(node) ||
      ts.isForStatement(node) || ts.isForInStatement(node) ||
      ts.isForOfStatement(node) || ts.isWhileStatement(node) ||
      ts.isDoStatement(node) || ts.isCatchClause(node)
    ) {
      branches += 2;
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      branches += 1;
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      branches += 2;
    }

    ts.forEachChild(node, visit);
  };
  visit(file);
  return { lines: lines.size, branches, functions };
}

function extendMetric(base: CoverageMetric, extraTotal: number): CoverageMetric {
  const total = base.total + extraTotal;
  return {
    covered: base.covered,
    total,
    percentage: total ? base.covered / total * 100 : 0,
  };
}

/**
 * Fold files that no test loaded into the summary as fully uncovered, so the
 * gate denominator covers the whole source tree instead of only the modules
 * Deno happened to profile.
 */
export function addUncoveredFiles(
  base: CoverageSummary,
  uncovered: Iterable<CoverableCounts>,
): CoverageSummary {
  let lines = 0;
  let branches = 0;
  let functions = 0;
  for (const counts of uncovered) {
    lines += counts.lines;
    branches += counts.branches;
    functions += counts.functions;
  }
  return {
    lines: extendMetric(base.lines, lines),
    branches: extendMetric(base.branches, branches),
    functions: extendMetric(base.functions, functions),
  };
}
