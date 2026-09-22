/**
 * API + Custom Element reference generator (#1158 lineage, 1.0 alpha surface).
 *
 * Builds www/app/data/_generated-api-reference.ts from the real public exports
 * of every supported subpath of the retained 1.0 packages (TypeScript
 * enumeration of the export map declared in each packages/<name>/deno.json),
 * their JSDoc, their signatures and option-bag members, the config option
 * table derived from the router's application options type, and the
 * @openelement/ui compiler manifest (tags/attributes/slots/CSS parts/SSR/
 * claim/activation). `--check` regenerates and requires byte-identical output —
 * the CI drift gate.
 *
 * Derived artifacts (P6): a signature, an option table and a JSDoc summary are
 * facts that already exist in the source; this generator renders them instead
 * of letting the site restate them by hand. Cross-package `@openelement/*`
 * imports are pinned to workspace sources via `ts.CompilerOptions.paths` built
 * from each package's deno.json exports (the rule
 * tools/repo/check-public-interface-snapshot.ts established), so a re-exported
 * symbol resolves to its real declaration and JSDoc instead of to whatever
 * node_modules layout the generating machine happens to have.
 *
 * Undocumented-export gate (#1414): an export without a JSDoc summary fails
 * generation, so `www#check:api-reference` (gate:release, the release train)
 * turns red the moment a new export lands without its rustdoc-style comment.
 * The @openelement/ui
 * compiler manifest description is the documented fallback for UI element
 * classes — it is generated from the element's own `@element` meta, not
 * hand-copied.
 */
import { formatJson } from '@openelement/element/build-utils';
import { fromFileUrl, join, resolve } from '@std/path';
import ts from 'typescript';
import {
  type PackageInfo,
  readPackages,
  releasePublishOrder,
} from '../../tools/lib/package-graph.ts';

export const API_REFERENCE_ARTIFACT = 'www/app/data/_generated-api-reference.ts';
const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const UI_MANIFEST = 'packages/ui/src/generated-manifest.json';

/**
 * The application config option table's source: the type an
 * `openelement.config.ts` default export is checked against. `defineConfig`
 * (the router's config entry, #1411) declares its parameter as this type, so
 * the table below is the config surface's own declaration rendered — never a
 * hand-kept copy.
 */
const CONFIG_TYPE = { entry: 'packages/router/src/vite/index.ts', type: 'OpenElementOptions' };

interface OptionRecord {
  name: string;
  type: string;
  required: boolean;
  default: string;
  description: string;
}

interface ExportRecord {
  name: string;
  kind: string;
  summary: string;
  signature: string;
  options: OptionRecord[];
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
  configOptions: OptionRecord[];
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

function repoRelativePath(file: string, repoRoot: string): string {
  return resolve(file).startsWith(`${resolve(repoRoot)}/`)
    ? resolve(file).slice(resolve(repoRoot).length + 1)
    : file;
}

/**
 * Exact `paths` mapping pinning every declared `@openelement/*` export subpath
 * to its workspace source entry (the same rule
 * tools/repo/check-public-interface-snapshot.ts applies), so the checker never
 * falls through to ambient node_modules copies of workspace packages.
 */
function workspacePaths(packages: PackageInfo[]): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const pkg of packages) {
    const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports;
    for (const [subpath, source] of Object.entries(exports ?? {})) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      paths[specifier] = [resolve(pkg.dir, String(source).replace(/^\.\//, ''))];
    }
  }
  return paths;
}

function programOptions(paths: Record<string, string[]>): ts.CompilerOptions {
  return {
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    baseUrl: repoRoot,
    paths,
  };
}

// Presentation ceiling for a rendered type: the reference page shows the call
// shape, not the full structural expansion of a 400-character union.
const TYPE_LIMIT = 220;
const MEMBER_LIMIT = 160;

function trim(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/** Resolve a symbol's declaration, its file path (repo-relative later) and its line. */
function declarationOf(target: ts.Symbol, fallback: ts.SourceFile) {
  const declaration = target.valueDeclaration ?? target.declarations?.[0] ?? fallback;
  const file = declaration.getSourceFile();
  const line = file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1;
  return { declaration, file: file.fileName, line };
}

/** The `@default` JSDoc tag of a declaration, or ''. */
function defaultOf(declaration: ts.Declaration): string {
  for (const tag of ts.getJSDocTags(declaration)) {
    if (tag.tagName.text !== 'default') continue;
    const comment = typeof tag.comment === 'string' ? tag.comment : '';
    if (comment.trim() !== '') return trim(comment, 80);
  }
  return '';
}

/**
 * The doc text of a declaration: the comment body, or — for a comment whose
 * body is a tag rather than prose (a JSDoc starting with `@dangerous`) — the
 * tag comments, so a tagged member still renders the sentence documenting it.
 */
function docText(checker: ts.TypeChecker, symbol: ts.Symbol, declaration: ts.Declaration): string {
  const body = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (body !== '') return trim(body, 400);
  const tagComments = ts.getJSDocTags(declaration)
    .map((tag) => typeof tag.comment === 'string' ? `@${tag.tagName.text} ${tag.comment}` : '')
    .filter((comment) => comment !== '');
  return tagComments.length > 0 ? trim(tagComments.join(' '), 400) : '';
}

/**
 * The declared call shape of an export: a function signature, a class header
 * (`class X extends Y`) or the declared type name. `typeToString` of a
 * declared type is right for interfaces and aliases; a class's static-side
 * type would print as construct signatures, so classes report their heritage
 * instead.
 */
function signatureOf(
  checker: ts.TypeChecker,
  target: ts.Symbol,
  declaration: ts.Declaration,
  kind: string,
): string {
  const flags = ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
    ts.TypeFormatFlags.WriteTypeArgumentsOfSignature;
  if (kind === 'class') {
    const heritage = ts.isClassLike(declaration)
      ? declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      : undefined;
    const base = heritage?.types.map((type) => type.getText()).join(', ');
    return trim(
      base ? `class ${target.getName()} extends ${base}` : `class ${target.getName()}`,
      TYPE_LIMIT,
    );
  }
  const type = checker.getTypeOfSymbolAtLocation(target, declaration);
  const call = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
  if (call) {
    return trim(checker.signatureToString(call, declaration, flags), TYPE_LIMIT);
  }
  if (target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
    return trim(
      checker.typeToString(checker.getDeclaredTypeOfSymbol(target), declaration, flags),
      TYPE_LIMIT,
    );
  }
  return trim(checker.typeToString(type, declaration, flags), TYPE_LIMIT);
}

/** True for an object type (interfaces, aliases to object literals). */
function isObjectType(type: ts.Type): boolean {
  return (type as ts.ObjectType).objectFlags !== undefined;
}

/** Union members, or `[]` for a non-union type. */
function unionMembers(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [];
}

/**
 * The object half of an optional member type: `{ a?: string } | undefined`
 * reduces to the object, so an optional option group still descends into its
 * members. A union of two real shapes is not an option bag and stays a type
 * text.
 */
function unwrapOptional(type: ts.Type): ts.Type {
  if (!type.isUnion()) return type;
  const members = type.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined));
  return members.length === 1 ? members[0] : type;
}

/**
 * True when a type is an object literal option bag whose members belong in a
 * table. Primitives, literal types, arrays/tuples, unions, index-signature
 * dictionaries and callable types are reported as a type text instead — a
 * string's own prototype members are never options.
 */
function isOptionBag(type: ts.Type): boolean {
  if (!isObjectType(type)) return false;
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false;
  if (type.getStringIndexType() || type.getNumberIndexType()) return false;
  const flags = type.getFlags();
  if (
    flags &
    (ts.TypeFlags.Array | ts.TypeFlags.Tuple | ts.TypeFlags.Union | ts.TypeFlags.Intersection)
  ) {
    return false;
  }
  const count = type.getProperties().length;
  return count > 0 && count <= 24;
}

interface OptionTableContext {
  checker: ts.TypeChecker;
  visited: Set<number>;
  depth: number;
}

/**
 * Flatten an option-bag type into table rows. Nested option bags (the
 * `inject`/`html`/`build`/`i18n` groups) descend one level with dotted names so
 * the table renders the real shape instead of an opaque type name; everything
 * else reports its type text.
 */
function optionRows(
  type: ts.Type,
  context: OptionTableContext,
  prefix: string,
  out: OptionRecord[],
): void {
  if (context.depth > 2) return;
  for (const member of type.getProperties()) {
    const declaration = member.valueDeclaration ?? member.declarations?.[0];
    if (!declaration) continue;
    const name = member.getName();
    const memberType = context.checker.getTypeOfSymbolAtLocation(member, declaration);
    // Optional members resolve to `T | undefined`; the `?` in the row already
    // says that, so the rendered type stays the declared `T`.
    const declaredType = unwrapOptional(memberType);
    const typeText = trim(
      context.checker.typeToString(
        memberType,
        declaration,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      ),
      MEMBER_LIMIT,
    ).replace(/ \| undefined$/, '');
    const path = prefix === '' ? name : `${prefix}.${name}`;
    const required = !('questionToken' in declaration) ||
      (declaration as { questionToken?: ts.QuestionToken }).questionToken === undefined;
    const nested = isOptionBag(declaredType) &&
      !context.visited.has(declaredType.id) &&
      // A member whose type is a named interface is a group only when its
      // members are all optional (an option bag, not a data record).
      (declaredType.symbol === undefined ||
        declaredType.getProperties().every((property) => {
          const propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0];
          return propertyDeclaration !== undefined &&
            'questionToken' in propertyDeclaration &&
            (propertyDeclaration as { questionToken?: ts.QuestionToken }).questionToken !==
              undefined;
        }));
    if (nested) {
      const before = out.length;
      context.visited.add(declaredType.id);
      context.depth += 1;
      optionRows(declaredType, context, path, out);
      context.depth -= 1;
      if (out.length > before) continue;
    }
    out.push({
      name: path,
      type: typeText,
      required,
      default: defaultOf(declaration),
      description: docText(context.checker, member, declaration),
    });
  }
}

/** The option table of the first parameter of a callable export. */
function optionsOfSignature(
  checker: ts.TypeChecker,
  type: ts.Type,
  declaration: ts.Declaration,
): OptionRecord[] {
  const call = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
  const parameter = call?.getParameters()[0];
  if (!parameter) return [];
  const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ??
    declaration;
  const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
  // Optional-parameter unions (`config?: OpenPipelineConfig` resolves to
  // `OpenPipelineConfig | undefined`) keep the object member; a union of two
  // real shapes has no single table and renders as a signature only.
  const bags = [parameterType, ...unionMembers(parameterType)].filter(isOptionBag);
  const bag = bags.length === 1 ? bags[0] : undefined;
  if (!bag) return [];
  const rows: OptionRecord[] = [];
  optionRows(bag, { checker, visited: new Set([bag.id]), depth: 1 }, '', rows);
  return rows;
}

/** The member table of a declared options interface/alias. */
function optionsOfDeclaration(checker: ts.TypeChecker, target: ts.Symbol): OptionRecord[] {
  const bag = checker.getDeclaredTypeOfSymbol(target);
  if (!isOptionBag(bag)) return [];
  const rows: OptionRecord[] = [];
  optionRows(bag, { checker, visited: new Set([bag.id]), depth: 1 }, '', rows);
  return rows;
}

/**
 * A declared entry that exports nothing is a command entry, not a library
 * surface: packages/create declares its single entry with a bare-string
 * exports (`./src/cli.ts`), so there is no subpath map to enumerate. Record
 * the entry itself — name, source and the module's own leading JSDoc — instead
 * of leaving the package with an empty export set.
 */
function entryRecord(entryFile: string, repoRoot: string): ExportRecord {
  const resolvedEntry = resolve(entryFile);
  const text = Deno.readTextFileSync(resolvedEntry);
  const leading = ts.getLeadingCommentRanges(text, 0)?.find((range) =>
    range.kind === ts.SyntaxKind.MultiLineCommentTrivia
  );
  const summary = leading
    ? text.slice(leading.pos, leading.end)
      .split('\n')
      .map((line) => line.trim().replace(/^\/?\*+\/?/, '').trim())
      .find((line) => line !== '') ?? ''
    : '';
  const name = resolvedEntry.slice(resolvedEntry.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return {
    name,
    kind: 'entry',
    summary,
    signature: '',
    options: [],
    source: { path: repoRelativePath(resolvedEntry, repoRoot), line: 1 },
    stability: 'public',
    anchor: '',
  };
}

function enumerateExports(
  entryFile: string,
  repoRoot: string,
  paths: Record<string, string[]>,
): ExportRecord[] {
  const resolvedEntry = resolve(entryFile);
  const program = ts.createProgram([resolvedEntry], programOptions(paths));
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(resolvedEntry);
  if (!source) throw new Error(`TypeScript did not load public entry ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`TypeScript did not resolve module ${entryFile}`);

  return checker.getExportsOfModule(moduleSymbol).map((exportSymbol) => {
    let step = 'resolveAlias';
    try {
      const target = resolveAlias(checker, exportSymbol);
      step = 'declarationOf';
      const { declaration, file, line } = declarationOf(target, source);
      step = 'exportKind';
      const kind = exportKind(target.flags);
      step = 'optionsOfSignature';
      const type = checker.getTypeOfSymbolAtLocation(target, declaration);
      return {
        name: exportSymbol.getName(),
        kind,
        summary: ts.displayPartsToString(target.getDocumentationComment(checker))
          .replace(/\s+/g, ' ').trim(),
        signature: signatureOf(checker, target, declaration, kind),
        // Options come from a callable's first parameter or from the members of
        // a declared options interface/alias — the two shapes a consumer reads a
        // table for.
        options: kind === 'function' || kind === 'entry'
          ? optionsOfSignature(checker, type, declaration)
          : kind === 'interface' || kind === 'type'
          ? optionsOfDeclaration(checker, target)
          : [],
        source: { path: repoRelativePath(file, repoRoot), line },
        stability: 'public',
        anchor: '',
      };
    } catch (error) {
      const err = error as Error;
      throw new Error(
        `export ${exportSymbol.getName()} failed at ${step}: ${err.message.split('\n')[0]}\n${
          (err.stack ?? '').split('\n').slice(1, 8).join('\n')
        }`,
      );
    }
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The application config option table, rendered from the config options type. */
function readConfigOptions(paths: Record<string, string[]>): OptionRecord[] {
  const entry = join(repoRoot, CONFIG_TYPE.entry);
  const program = ts.createProgram([entry], programOptions(paths));
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`TypeScript did not load config type entry ${CONFIG_TYPE.entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const configSymbol = moduleSymbol
    ? checker.getExportsOfModule(moduleSymbol).find((symbol) =>
      symbol.getName() === CONFIG_TYPE.type
    )
    : undefined;
  if (!configSymbol) {
    throw new Error(`${CONFIG_TYPE.entry} does not export ${CONFIG_TYPE.type}`);
  }
  const target = resolveAlias(checker, configSymbol);
  const bag = checker.getDeclaredTypeOfSymbol(target);
  const rows: OptionRecord[] = [];
  optionRows(bag, { checker, visited: new Set([bag.id]), depth: 1 }, '', rows);
  if (rows.length === 0) {
    throw new Error(`${CONFIG_TYPE.type} has no option members to render`);
  }
  return rows;
}

export async function buildApiReference(): Promise<ApiReferenceBuild> {
  const failures: string[] = [];
  const manifest = JSON.parse(await Deno.readTextFile(join(repoRoot, UI_MANIFEST))) as {
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
  const paths = workspacePaths(packages);
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
      const entryFile = `${info.dir}/${target.replace(/^\.\//, '')}`;
      let enumerated: ExportRecord[];
      try {
        enumerated = enumerateExports(entryFile, repoRoot, paths);
        if (enumerated.length === 0 && typeof info.exports === 'string') {
          enumerated = [entryRecord(entryFile, repoRoot)];
        }
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
        // The undocumented-export gate: a public export with no JSDoc summary
        // is a promise nobody wrote down.
        if (record.summary === '') {
          failures.push(
            `${info.name}/${subpathLabel(subpath)}#${record.name} has no JSDoc summary ` +
              `(${record.source.path}:${record.source.line})`,
          );
        }
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

  const configOptions = readConfigOptions(paths);

  return { packages: records, elements, configOptions, failures };
}

function searchRecords(build: ApiReferenceBuild): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  for (const pkg of build.packages) {
    for (const subpath of pkg.subpaths) {
      for (const exported of subpath.exports) {
        records.push({
          route: '/reference',
          anchor: exported.anchor,
          title: `${exported.name} (${pkg.name}/${subpath.label})`,
          kind: 'api',
        });
      }
    }
  }
  for (const element of build.elements) {
    records.push({
      route: '/reference',
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
    configOptions: build.configOptions,
    searchRecords: searchRecords(build),
  };
  return '// Auto-generated by www/tools/generate-api-reference.ts (#1158) — do not edit\n' +
    '// Source of truth: packages/<name>/deno.json exports + JSDoc, the router\n' +
    '// application options type (packages/router/src/vite/index.ts\n' +
    '// OpenElementOptions) and packages/ui/src/generated-manifest.json.\n' +
    '// Regenerate with `deno task --cwd www generate:api-reference`; the file is\n' +
    '// untracked and rebuilt before test/site:build.\n' +
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
      existing = await Deno.readTextFile(join(repoRoot, API_REFERENCE_ARTIFACT));
    } catch {
      console.error(
        `${API_REFERENCE_ARTIFACT} is missing; run deno task --cwd www generate:api-reference`,
      );
      Deno.exit(1);
    }
    if (existing !== module) {
      console.error(
        `${API_REFERENCE_ARTIFACT} is stale; run deno task --cwd www generate:api-reference`,
      );
      Deno.exit(1);
    }
    console.log(`API reference check passed (${API_REFERENCE_ARTIFACT} is byte-identical).`);
  } else {
    await Deno.writeTextFile(join(repoRoot, API_REFERENCE_ARTIFACT), module);
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
