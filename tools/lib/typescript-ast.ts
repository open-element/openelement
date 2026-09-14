// esm-boundary:scanner — this helper extracts Node/CJS constructs, so it names them.
import ts from 'typescript';

interface StaticModuleSpecifier {
  value: string;
  line: number;
}

export function parseTypeScript(source: string, path = 'source.ts'): ts.SourceFile {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

export function extractStaticModuleSpecifiers(
  source: string,
  path = 'source.ts',
): StaticModuleSpecifier[] {
  const file = parseTypeScript(source, path);
  const found: StaticModuleSpecifier[] = [];
  const add = (node: ts.Node | undefined): void => {
    const value = literalText(node);
    if (value === undefined || node === undefined) return;
    found.push({ value, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    } else if (
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export interface NodeGlobalAccess {
  name: string;
  line: number;
}

/**
 * Node runtime globals that must not appear in browser/runtime-free source and
 * are barred in Deno-hosted source too (section 17 rule 1/2). `require` is
 * detected as a call, `module.exports`/`exports.*` as CommonJS property
 * access; the rest as expression identifiers, so comments, string literals and
 * object property names (`{ process: 1 }`) never count.
 */
const NODE_GLOBAL_IDENTIFIERS = new Set([
  'process',
  'Buffer',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate',
]);

export function extractNodeGlobalAccesses(source: string, path = 'source.ts'): NodeGlobalAccess[] {
  const file = parseTypeScript(source, path);
  const found: NodeGlobalAccess[] = [];
  const record = (name: string, node: ts.Node): void => {
    found.push({
      name,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    });
  };

  const isDeclarationName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (parent === undefined) return false;
    if (
      (ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
        ts.isBindingElement(parent)) && parent.name === node
    ) return true;
    if (
      (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
        ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
        ts.isEnumDeclaration(parent)) && parent.name === node
    ) return true;
    return ts.isImportClause(parent) || ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent);
  };

  const isPropertyName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (parent === undefined) return false;
    if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
    if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) {
      return parent.name === node;
    }
    if (ts.isBindingElement(parent)) return parent.propertyName === node;
    return false;
  };

  const isGlobalThisMember = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (
      ts.isPropertyAccessExpression(parent) &&
      ts.isIdentifier(parent.expression) && parent.expression.text === 'globalThis'
    ) return true;
    if (
      ts.isElementAccessExpression(parent) &&
      ts.isIdentifier(parent.expression) && parent.expression.text === 'globalThis'
    ) {
      return literalText(parent.argumentExpression) === node.text;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'require') record('require', node.expression);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'module' && node.name.text === 'exports') {
        record('module.exports', node);
      } else if (node.expression.text === 'exports') {
        record('exports', node);
      }
    }
    if (ts.isIdentifier(node) && NODE_GLOBAL_IDENTIFIERS.has(node.text)) {
      const globalThisMember = isGlobalThisMember(node);
      if (globalThisMember || (!isDeclarationName(node) && !isPropertyName(node))) {
        record(node.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

interface DenoAccess {
  member: string;
  line: number;
}

export function extractDenoAccesses(source: string, path = 'source.ts'): DenoAccess[] {
  const file = parseTypeScript(source, path);
  const found: DenoAccess[] = [];
  // Simple aliases (`const D = Deno`) so `D.readTextFile` is caught too.
  const aliases = new Set<string>();
  const isDenoExpression = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && (node.text === 'Deno' || aliases.has(node.text))) ||
    (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis' && node.name.text === 'Deno');
  const record = (member: string, node: ts.Node): void => {
    found.push({
      member,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (ts.isIdentifier(node.name) && isDenoExpression(node.initializer)) {
        aliases.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name) && isDenoExpression(node.initializer)) {
        // Simple destructuring: `const { readTextFile, mkdir: mk } = Deno`.
        for (const element of node.name.elements) {
          if (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName)) {
            continue;
          }
          if (!ts.isIdentifier(element.name)) continue;
          record(element.propertyName?.text ?? element.name.text, element);
        }
      }
    }
    let member: string | undefined;
    if (ts.isPropertyAccessExpression(node) && isDenoExpression(node.expression)) {
      member = node.name.text;
    } else if (ts.isElementAccessExpression(node) && isDenoExpression(node.expression)) {
      member = literalText(node.argumentExpression);
    }
    if (member !== undefined) record(member, node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
