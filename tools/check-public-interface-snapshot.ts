/** Generate/check the deterministic retained-package public-interface baseline. */
import { formatJson } from '@openelement/element/build-utils';
import ts from 'typescript';
import { resolve } from '@std/path';
import { readPackages, releasePublishOrder } from './lib/package-graph.ts';

const SNAPSHOT = 'docs/release/public-interface-snapshot.json';
const TYPE_FLAGS = ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest).toHex();
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    current = checker.getAliasedSymbol(current);
  }
  return current;
}

function isInsidePackage(declaration: ts.Declaration, packageDir: string): boolean {
  const file = resolve(declaration.getSourceFile().fileName);
  return file.startsWith(`${resolve(packageDir)}/`);
}

function isPrivate(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) =>
    ts.canHaveModifiers(declaration) &&
    ts.getModifiers(declaration)?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)
  );
}

function isReadonly(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) =>
    ts.canHaveModifiers(declaration) &&
    ts.getModifiers(declaration)?.some((modifier) =>
      modifier.kind === ts.SyntaxKind.ReadonlyKeyword
    )
  );
}

function publicSymbolName(symbol: ts.Symbol): string {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (
    declaration && 'name' in declaration && declaration.name &&
    ts.isComputedPropertyName(declaration.name as ts.Node)
  ) {
    return (declaration.name as ts.ComputedPropertyName).getText();
  }
  return symbol.getName();
}

function signatureShape(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  packageDir: string,
  seen: Set<number>,
  depth: number,
): string {
  const declaration = signature.getDeclaration();
  const typeParameters = signature.getTypeParameters() ?? [];
  const generics = typeParameters.length === 0 ? '' : `<${
    typeParameters.map((parameter) => {
      const constraint = parameter.getConstraint();
      const fallback = parameter.getDefault();
      return [
        checker.typeToString(parameter, declaration, TYPE_FLAGS),
        constraint ? `extends ${typeShape(checker, constraint, packageDir, seen, depth + 1)}` : '',
        fallback ? `=${typeShape(checker, fallback, packageDir, seen, depth + 1)}` : '',
      ].filter(Boolean).join(' ');
    }).join(',')
  }>`;
  const parameters = signature.getParameters().map((parameter) => {
    const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
    const type = parameterDeclaration
      ? checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration)
      : checker.getAnyType();
    const optional = (parameter.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
    const rest = parameterDeclaration && ts.isParameter(parameterDeclaration) &&
        parameterDeclaration.dotDotDotToken
      ? '...'
      : '';
    return `${rest}${parameter.getName()}${optional}:${
      typeShape(
        checker,
        type,
        packageDir,
        seen,
        depth + 1,
      )
    }`;
  }).join(',');
  return `${generics}(${parameters})=>${
    typeShape(
      checker,
      signature.getReturnType(),
      packageDir,
      seen,
      depth + 1,
    )
  }`;
}

function typeShape(
  checker: ts.TypeChecker,
  type: ts.Type,
  packageDir: string,
  seen: Set<number> = new Set(),
  depth = 0,
): string {
  if (depth > 20) return checker.typeToString(type, undefined, TYPE_FLAGS);
  if (type.isUnion()) {
    return `union(${
      type.types.map((part) => typeShape(checker, part, packageDir, new Set(seen), depth + 1))
        .sort().join('|')
    })`;
  }
  if (type.isIntersection()) {
    return `intersection(${
      type.types.map((part) => typeShape(checker, part, packageDir, new Set(seen), depth + 1))
        .sort().join('&')
    })`;
  }

  const typeId = (type as ts.Type & { id?: number }).id;
  if (typeId !== undefined && seen.has(typeId)) {
    return `recursive(${checker.typeToString(type, undefined, TYPE_FLAGS)})`;
  }
  const nextSeen = new Set(seen);
  if (typeId !== undefined) nextSeen.add(typeId);

  if ((type.flags & ts.TypeFlags.Object) === 0) {
    return checker.typeToString(type, undefined, TYPE_FLAGS);
  }

  if (checker.isTupleType(type)) {
    const arguments_ = checker.getTypeArguments(type as ts.TypeReference);
    return `tuple(${
      arguments_.map((item) => typeShape(checker, item, packageDir, nextSeen, depth + 1)).join(',')
    })`;
  }
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return `array(${item ? typeShape(checker, item, packageDir, nextSeen, depth + 1) : 'unknown'})`;
  }

  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declarations = symbol?.declarations ?? [];
  const local = declarations.some((declaration) => isInsidePackage(declaration, packageDir));
  const anonymous = symbol?.getName() === '__type' || symbol?.getName() === '__object';
  if (!local && !anonymous) return checker.typeToString(type, undefined, TYPE_FLAGS);

  const parts: string[] = [];
  for (
    const property of checker.getPropertiesOfType(type).sort((a, b) =>
      a.getName().localeCompare(b.getName())
    )
  ) {
    if (isPrivate(property) || property.getName().startsWith('#')) continue;
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    // External lib/DOM inheritance is not owned by this package. Local
    // inherited members are pinned by their exported base symbol.
    if (!(property.declarations ?? []).some((item) => isInsidePackage(item, packageDir))) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
    const readonly = isReadonly(property) ? 'readonly ' : '';
    parts.push(`${readonly}${publicSymbolName(property)}${optional}:${
      typeShape(
        checker,
        propertyType,
        packageDir,
        nextSeen,
        depth + 1,
      )
    }`);
  }
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    parts.push(`call:${signatureShape(checker, signature, packageDir, nextSeen, depth + 1)}`);
  }
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Construct)) {
    parts.push(`construct:${signatureShape(checker, signature, packageDir, nextSeen, depth + 1)}`);
  }
  for (const index of checker.getIndexInfosOfType(type)) {
    parts.push(
      `index:${typeShape(checker, index.keyType, packageDir, nextSeen, depth + 1)}=>${
        typeShape(checker, index.type, packageDir, nextSeen, depth + 1)
      }`,
    );
  }
  if (parts.length === 0) return checker.typeToString(type, undefined, TYPE_FLAGS);
  return `{${parts.sort().join(';')}}`;
}

export async function publicInterfaceShape(
  entryFile: string,
  packageDir: string,
): Promise<{ publicShapeSha256: string; publicSymbols: string[] }> {
  const resolvedEntry = resolve(entryFile);
  const program = ts.createProgram([resolvedEntry], {
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(resolvedEntry);
  if (!source) throw new Error(`TypeScript did not load public entry ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`TypeScript did not resolve module ${entryFile}`);

  const publicSymbols = checker.getExportsOfModule(moduleSymbol).map((exportSymbol) => {
    const target = resolveAlias(checker, exportSymbol);
    const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? source;
    const shapes: string[] = [];
    if ((target.flags & ts.SymbolFlags.Value) !== 0) {
      shapes.push(`value:${
        typeShape(
          checker,
          checker.getTypeOfSymbolAtLocation(target, declaration),
          packageDir,
        )
      }`);
    }
    if (
      (target.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) !== 0
    ) {
      shapes.push(
        `type:${typeShape(checker, checker.getDeclaredTypeOfSymbol(target), packageDir)}`,
      );
    }
    if ((target.flags & ts.SymbolFlags.Namespace) !== 0) {
      const members = checker.getExportsOfModule(target).map((member) => member.getName()).sort();
      shapes.push(`namespace:${members.join(',')}`);
    }
    return `${exportSymbol.getName()}=${shapes.sort().join('|')}`;
  }).sort();
  const publicShapeSha256 = await sha256Hex(publicSymbols.join('\n'));
  return { publicShapeSha256, publicSymbols };
}

async function main(): Promise<void> {
  const write = Deno.args.includes('--write');
  const packages = releasePublishOrder(await readPackages());
  const snapshot = {
    schema: 2,
    packages: await Promise.all(packages.map(async (pkg) => {
      const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports;
      const declarations = await Promise.all(
        Object.entries(exports ?? {}).map(async ([path, source]) => {
          const entry = resolve(pkg.dir, String(source).replace(/^\.\//, ''));
          return [path, await publicInterfaceShape(entry, pkg.dir)] as const;
        }),
      );
      return {
        name: pkg.name,
        exports: Object.fromEntries(Object.entries(exports ?? {}).sort()),
        declarations: Object.fromEntries(declarations.sort()),
      };
    })),
  };
  const text = formatJson(snapshot);
  if (write) await Deno.writeTextFile(SNAPSHOT, text);
  else if (await Deno.readTextFile(SNAPSHOT) !== text) {
    throw new Error(`${SNAPSHOT} drifted; run deno task interface:snapshot:write`);
  }
  console.log(
    `Public interface snapshot ${write ? 'written' : 'matches'} (${packages.length} packages).`,
  );
}

if (import.meta.main) await main();
