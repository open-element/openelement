/**
 * Boundary check for the generated Nitro Workers output (section 17).
 *
 * The Cloudflare Workers preset emits a self-contained module graph: the
 * entry and its transitive static imports must resolve inside the output, and
 * the only permitted `node:*` specifiers are the Cloudflare `nodejs_compat`
 * shims `node:process` and `node:buffer` — and only when the Nitro manifest
 * asserts `cloudflare.nodeCompat === true`. Any external bare specifier
 * (unbundled dependency) or other `node:*` builtin would fail at the edge.
 * Modules in the graph are also scanned for bare-global `process.env`
 * accesses: bundled third-party code that skips the `node:process` shim
 * throws a ReferenceError on a strict Workers runtime.
 *
 * Generated third-party output is not product source: the check proves the
 * entry dependency graph, it does not rewrite Nitro/unenv output. Run after
 * `apps/saas#nitro:build-workers` (the root `saas:workers` task does).
 */

import { walkSync } from '@std/fs/walk';
import ts from 'typescript';
import { extractStaticModuleSpecifiers, parseTypeScript } from '../lib/typescript-ast.ts';

export interface WorkersManifest {
  preset?: string;
  serverEntry?: string;
  publicDir?: string;
  config?: { cloudflare?: { nodeCompat?: boolean } };
}

export interface WorkersModule {
  /** Path relative to the output server directory, e.g. `index.mjs`. */
  path: string;
  text: string;
}

/**
 * Cloudflare `nodejs_compat` shims that a Nitro Workers build may import when
 * the manifest declares nodeCompat. Every other `node:*` builtin fails.
 */
export const WORKERS_NODE_SHIMS: readonly { specifier: string; reason: string }[] = [
  { specifier: 'node:process', reason: 'Cloudflare nodejs_compat process shim' },
  { specifier: 'node:buffer', reason: 'Cloudflare nodejs_compat Buffer shim' },
];

function normalize(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Bare-global `process.env` detection. The import graph proves specifiers, but
 * bundled third-party code can still touch the `process` global directly; on
 * Workers that global only exists when the module binds it through the
 * `node:process` shim or reads `globalThis.process`, so a free `process.env`
 * access throws a ReferenceError at the edge. Only a property/element access
 * on a free `process` identifier counts: `typeof process` guards, locally
 * bound `process` (imports, parameters, `const { process } = globalThis`), and
 * comments/strings never do.
 */
function bindingDeclaresProcess(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === 'process';
  return name.elements.some((element) =>
    ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === 'process'
  );
}

function scopeBindsProcess(scope: ts.Node): boolean {
  if (ts.isFunctionLike(scope) && scope.parameters.some((p) => bindingDeclaresProcess(p.name))) {
    return true;
  }
  if (
    ts.isCatchClause(scope) && scope.variableDeclaration !== undefined &&
    bindingDeclaresProcess(scope.variableDeclaration.name)
  ) {
    return true;
  }
  if (
    !ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isModuleBlock(scope) &&
    !ts.isCaseClause(scope) && !ts.isDefaultClause(scope)
  ) {
    return false;
  }
  for (const statement of scope.statements) {
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.some((d) => bindingDeclaresProcess(d.name))) {
        return true;
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === 'process'
    ) {
      return true;
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name?.text === 'process') return true;
      const named = clause?.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named) && named.name.text === 'process') {
        return true;
      }
      if (
        named !== undefined && ts.isNamedImports(named) &&
        named.elements.some((element) => element.name.text === 'process')
      ) {
        return true;
      }
    } else if (ts.isImportEqualsDeclaration(statement) && statement.name.text === 'process') {
      return true;
    }
  }
  return false;
}

function processIsBound(node: ts.Node): boolean {
  let scope = node.parent;
  while (scope !== undefined) {
    if (scopeBindsProcess(scope)) return true;
    scope = scope.parent;
  }
  return false;
}

/** 1-based lines of bare `process.env` accesses, mirroring the AST helpers. */
function extractBareProcessEnvLines(source: string, path: string): number[] {
  const file = parseTypeScript(source, path);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    let processRef: ts.Identifier | undefined;
    if (
      ts.isPropertyAccessExpression(node) && node.name.text === 'env' &&
      ts.isIdentifier(node.expression) && node.expression.text === 'process'
    ) {
      processRef = node.expression;
    } else if (
      ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'env'
    ) {
      processRef = node.expression;
    }
    if (processRef !== undefined && !processIsBound(processRef)) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

function resolveRelative(from: string, specifier: string, present: Set<string>): string | null {
  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const segments = (fromDir === '' ? specifier : `${fromDir}/${specifier}`).split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  const candidate = resolved.join('/');
  if (present.has(candidate)) return candidate;
  if (present.has(`${candidate}/index.mjs`)) return `${candidate}/index.mjs`;
  return null;
}

/**
 * Scan the Workers entry dependency graph. `modules` keys are relative to the
 * output server directory; `entry` defaults to the manifest serverEntry.
 */
export function scanWorkersOutput(
  manifest: WorkersManifest,
  modules: readonly WorkersModule[],
  entry?: string,
): string[] {
  const violations: string[] = [];
  if (manifest.preset !== 'cloudflare-module') {
    violations.push(`manifest preset must be 'cloudflare-module', got '${manifest.preset}'`);
  }
  const nodeCompat = manifest.config?.cloudflare?.nodeCompat === true;
  if (!nodeCompat) {
    violations.push('manifest must declare config.cloudflare.nodeCompat = true');
  }
  const byPath = new Map(modules.map((module) => [normalize(module.path), module]));
  const entryPath = normalize(entry ?? manifest.serverEntry ?? 'index.mjs');
  if (!byPath.has(entryPath)) {
    violations.push(`entry module missing from output: ${entryPath}`);
    return violations;
  }

  const shims = new Set(WORKERS_NODE_SHIMS.map((shim) => shim.specifier));
  const seen = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of extractStaticModuleSpecifiers(byPath.get(path)!.text, path)) {
      const value = specifier.value;
      if (value.startsWith('node:')) {
        if (!nodeCompat || !shims.has(value)) {
          violations.push(`${path}:${specifier.line}: forbidden Workers node builtin: ${value}`);
        }
        continue;
      }
      if (value.startsWith('./') || value.startsWith('../')) {
        const resolved = resolveRelative(path, value, new Set(byPath.keys()));
        if (resolved === null) {
          violations.push(
            `${path}:${specifier.line}: relative import escapes the output: ${value}`,
          );
        } else {
          queue.push(resolved);
        }
        continue;
      }
      if (value.startsWith('/') || value.includes(':')) continue;
      violations.push(
        `${path}:${specifier.line}: external import must be bundled for Workers: ${value}`,
      );
    }
    for (const line of extractBareProcessEnvLines(byPath.get(path)!.text, path)) {
      violations.push(
        `${path}:${line}: bare global process.env access; import the node:process shim`,
      );
    }
  }
  return violations;
}

function printShims(): void {
  console.log(`Workers node builtin allowlist (${WORKERS_NODE_SHIMS.length} entries):`);
  for (const shim of WORKERS_NODE_SHIMS) {
    console.log(`  ALLOW ${shim.specifier} — ${shim.reason}`);
  }
}

if (import.meta.main) {
  const outputRoot = Deno.args[0] ?? 'apps/saas/.output-workers';
  printShims();
  let manifest: WorkersManifest;
  try {
    manifest = JSON.parse(await Deno.readTextFile(`${outputRoot}/nitro.json`)) as WorkersManifest;
  } catch (error) {
    console.error(`Workers boundary check failed: cannot read ${outputRoot}/nitro.json`);
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
  const serverDir = `${outputRoot}/server`;
  const modules: WorkersModule[] = [];
  for (const entry of walkSync(serverDir, { includeDirs: false, exts: ['.mjs'] })) {
    modules.push({
      path: normalize(entry.path.slice(serverDir.length + 1)),
      text: await Deno.readTextFile(entry.path),
    });
  }
  // Manifest serverEntry is relative to the output root (`server/index.mjs`).
  const entry = manifest.serverEntry?.replace(/^server\//, '');
  const violations = scanWorkersOutput(manifest, modules, entry);
  if (violations.length > 0) {
    console.error('Workers output boundary violations detected:');
    for (const violation of violations) console.error(`  ${violation}`);
    Deno.exit(1);
  }
  console.log(`Workers output boundary check passed (${modules.length} server modules).`);
}
