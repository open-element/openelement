/**
 * API + Custom Element reference generator (#1158 lineage, 1.0 alpha surface).
 *
 * Builds www/app/data/_generated-api-reference.ts from the real public exports
 * of every supported subpath of the retained 1.0 packages (TypeScript
 * enumeration of the export map declared in each packages/<name>/deno.json),
 * their JSDoc, and the @openelement/ui compiler manifest (tags/attributes/
 * slots/CSS parts/SSR/claim/activation). `--check` regenerates and requires
 * byte-identical output — the CI drift gate.
 */
import { formatJson } from '@openelement/element/build-utils';
import { resolve } from '@std/path';
import ts from 'typescript';
import { readPackages, releasePublishOrder } from './lib/package-graph.ts';

export const API_REFERENCE_ARTIFACT = 'www/app/data/_generated-api-reference.ts';
const UI_MANIFEST = 'packages/ui/src/generated-manifest.json';

interface ExportRecord {
  name: string;
  kind: string;
  summary: string;
  source: { path: string; line: number };
  stability: string;
  anchor: string;
}

interface SubpathRecord {
  subpath: string;
  label: string;
  exports: ExportRecord[];
}

interface PackageRecord {
  id: string;
  name: string;
  importPath: string;
  supportedSubpaths: string[];
  internalSubpaths: string[];
  subpaths: SubpathRecord[];
}

interface ElementRecord {
  tag: string;
  className: string;
  description: string;
  layer: string;
  hydrate: string;
  module: string;
  attributes: unknown[];
  events: unknown[];
  slots: unknown[];
  cssParts: unknown[];
  anchor: string;
}

export interface ApiReferenceBuild {
  packages: PackageRecord[];
  elements: ElementRecord[];
  failures: string[];
}

function clean(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

function subpathLabel(subpath: string): string {
  return subpath === '.' ? 'root' : subpath;
}

function anchorFor(pkgId: string, subpath: string, name: string): string {
  return `api-${clean(pkgId)}-${clean(subpathLabel(subpath))}-${clean(name)}`;
}

function exportKind(flags: ts.SymbolFlags): string {
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Variable) return 'const';
  if (flags & ts.SymbolFlags.Namespace) return 'namespace';
  return 'export';
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

function enumerateExports(entryFile: string, repoRoot: string): ExportRecord[] {
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

  return checker.getExportsOfModule(moduleSymbol).map((exportSymbol) => {
    const target = resolveAlias(checker, exportSymbol);
    const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? source;
    const file = declaration.getSourceFile().fileName;
    const relative = resolve(file).startsWith(`${resolve(repoRoot)}/`)
      ? resolve(file).slice(resolve(repoRoot).length + 1)
      : file;
    const line = declaration.getSourceFile().getLineAndCharacterOfPosition(
      declaration.getStart(),
    ).line + 1;
    const summary = ts.displayPartsToString(target.getDocumentationComment(checker))
      .replace(/\s+/g, ' ').trim();
    return {
      name: exportSymbol.getName(),
      kind: exportKind(target.flags),
      summary,
      source: { path: relative, line },
      stability: 'public',
      anchor: '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildApiReference(): Promise<ApiReferenceBuild> {
  const repoRoot = Deno.cwd();
  const failures: string[] = [];
  const manifest = JSON.parse(await Deno.readTextFile(UI_MANIFEST)) as {
    declarations?: Array<Record<string, unknown>>;
  };
  const manifestDescriptionByClass = new Map<string, string>();
  for (const declaration of manifest.declarations ?? []) {
    manifestDescriptionByClass.set(
      String(declaration.className ?? ''),
      String(declaration.description ?? ''),
    );
  }

  const packages = releasePublishOrder(await readPackages());
  const anchors = new Set<string>();
  const records: PackageRecord[] = [];

  for (const info of packages) {
    const exportsMap = typeof info.exports === 'string'
      ? { '.': info.exports }
      : (info.exports ?? {}) as Record<string, string>;
    const shortName = info.name.slice(info.name.lastIndexOf('/') + 1);
    const subpaths: SubpathRecord[] = [];

    for (const subpath of Object.keys(exportsMap).sort()) {
      const target = exportsMap[subpath];
      if (typeof target !== 'string') {
        failures.push(`${info.name}: subpath '${subpath}' has no exports target`);
        continue;
      }
      let enumerated: ExportRecord[];
      try {
        enumerated = enumerateExports(
          `${info.dir}/${target.replace(/^\.\//, '')}`,
          repoRoot,
        );
      } catch (error) {
        failures.push(`${info.name}/${subpathLabel(subpath)}: enumeration failed: ${error}`);
        continue;
      }
      for (const record of enumerated) {
        if (info.name === '@openelement/ui' && record.summary === '') {
          const manifestDescription = manifestDescriptionByClass.get(record.name);
          if (manifestDescription) record.summary = manifestDescription;
        }
        record.anchor = anchorFor(shortName, subpath, record.name);
        if (anchors.has(record.anchor)) failures.push(`duplicate anchor '${record.anchor}'`);
        anchors.add(record.anchor);
      }
      subpaths.push({ subpath, label: subpathLabel(subpath), exports: enumerated });
    }

    records.push({
      id: shortName,
      name: info.name,
      importPath: info.name,
      supportedSubpaths: Object.keys(exportsMap).sort(),
      internalSubpaths: [],
      subpaths,
    });
  }

  const elements: ElementRecord[] = [];
  for (const declaration of manifest.declarations ?? []) {
    const tag = String(declaration.tagName);
    const openElement = (declaration.openElement ?? {}) as Record<string, unknown>;
    const anchor = `ce-${tag}`;
    if (anchors.has(anchor)) failures.push(`duplicate anchor '${anchor}'`);
    anchors.add(anchor);
    elements.push({
      tag,
      className: String(declaration.className ?? ''),
      description: String(declaration.description ?? ''),
      layer: String(openElement.layer ?? ''),
      hydrate: String(openElement.hydrate ?? ''),
      module: String(openElement.module ?? ''),
      attributes: (declaration.attributes ?? []) as unknown[],
      events: (declaration.events ?? []) as unknown[],
      slots: (declaration.slots ?? []) as unknown[],
      cssParts: (declaration.cssParts ?? []) as unknown[],
      anchor,
    });
  }
  elements.sort((a, b) => a.tag.localeCompare(b.tag));

  return { packages: records, elements, failures };
}

function searchRecords(build: ApiReferenceBuild): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  for (const pkg of build.packages) {
    for (const subpath of pkg.subpaths) {
      for (const exported of subpath.exports) {
        records.push({
          route: '/apilist',
          anchor: exported.anchor,
          title: `${exported.name} (${pkg.name}/${subpath.label})`,
          kind: 'api',
        });
      }
    }
  }
  for (const element of build.elements) {
    records.push({
      route: '/apilist',
      anchor: element.anchor,
      title: `<${element.tag}> (${element.className})`,
      kind: 'custom-element',
    });
  }
  return records.sort((a, b) => a.anchor.localeCompare(b.anchor));
}

export function renderApiReferenceModule(build: ApiReferenceBuild): string {
  const payload = {
    packages: build.packages,
    elements: build.elements,
    searchRecords: searchRecords(build),
  };
  return '// Auto-generated by tools/generate-api-reference.ts (#1158) — do not edit\n' +
    '// Source of truth: packages/<name>/deno.json exports + JSDoc and\n' +
    '// packages/ui/src/generated-manifest.json. Drift fails the\n' +
    '// `api-reference:check` CI gate; regenerate with `deno task generate:api-reference`.\n' +
    `export const apiReference = ${formatJson(payload).trimEnd()} as const;\n`;
}

if (import.meta.main) {
  const check = Deno.args.includes('--check');
  const build = await buildApiReference();
  if (build.failures.length > 0) {
    console.error('API reference validation failed:');
    for (const failure of build.failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  const module = renderApiReferenceModule(build);
  if (check) {
    let existing: string;
    try {
      existing = await Deno.readTextFile(API_REFERENCE_ARTIFACT);
    } catch {
      console.error(`${API_REFERENCE_ARTIFACT} is missing; run deno task generate:api-reference`);
      Deno.exit(1);
    }
    if (existing !== module) {
      console.error(
        `${API_REFERENCE_ARTIFACT} is stale; run deno task generate:api-reference and commit the result`,
      );
      Deno.exit(1);
    }
    console.log(`API reference check passed (${API_REFERENCE_ARTIFACT} is byte-identical).`);
  } else {
    await Deno.writeTextFile(API_REFERENCE_ARTIFACT, module);
    const exportCount = build.packages.reduce(
      (sum, pkg) => sum + pkg.subpaths.reduce((inner, sub) => inner + sub.exports.length, 0),
      0,
    );
    console.log(
      `Wrote ${build.packages.length} packages (${exportCount} documented exports) and ` +
        `${build.elements.length} custom elements to ${API_REFERENCE_ARTIFACT}`,
    );
  }
}
