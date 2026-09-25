/** Route-owned streaming admission; the Element program remains generic. */
import ts from 'typescript';
import { dirname, extname, resolve } from '../../../internal/host-path.ts';
import { compileElementProgram, stableModuleId } from '@openelement/element/compiler';
import { isDangerousKey } from '@openelement/element/authoring';
import type { StreamRouteManifest } from '../protocol/ssg.ts';
import { safeReadFile } from './route-scanner-fs.ts';
import { STREAM_FRAME_FORBIDDEN_TAGS, unsafeStreamFrameAttribute } from '@openelement/element';

type Program = ReturnType<typeof compileElementProgram>['program'];

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;
const FORBIDDEN_FRAME_TAGS: ReadonlySet<string> = new Set(STREAM_FRAME_FORBIDDEN_TAGS);

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find((entry): entry is ts.PropertyAssignment =>
    ts.isPropertyAssignment(entry) &&
    (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
    entry.name.text === name
  );
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;
}

function hasMember(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some((entry) =>
    (ts.isPropertyAssignment(entry) || ts.isMethodDeclaration(entry)) &&
    (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === name
  );
}

function objectValue(node: ts.Node | undefined): ts.ObjectLiteralExpression | undefined {
  return node && ts.isObjectLiteralExpression(node) ? node : undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  return node;
}

function position(sf: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${sf.fileName}:${line + 1}:${character + 1}`;
}

function diagnostic(
  route: string,
  field: string,
  at: string,
  reason: string,
): never {
  throw new Error(
    `[openElement] stream route ${route}, field ${field} at ${at}: ${reason}. ` +
      'Keep the field front-gate, bind directly to a nonreflecting page property, ' +
      'remove the ineligible sink, or disable streaming.',
  );
}

function staticLoaderFields(
  sf: ts.SourceFile,
  route: string,
  field: string,
): Set<string> | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement) && !ts.isFunctionDeclaration(statement)) continue;
    const declaration = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.find((entry) =>
        ts.isIdentifier(entry.name) && entry.name.text === 'loader'
      )
      : statement.name?.text === 'loader'
      ? statement
      : undefined;
    if (!declaration) continue;
    const body = ts.isFunctionDeclaration(declaration) ? declaration.body : declaration.initializer;
    const result = body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
      ? body.body
      : body;
    const expression = result && ts.isBlock(result)
      ? result.statements.length === 1 && ts.isReturnStatement(result.statements[0])
        ? result.statements[0].expression
        : undefined
      : result;
    const object = expression && unwrap(expression);
    if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
    const spread = object.properties.find(ts.isSpreadAssignment);
    if (spread) {
      diagnostic(route, field, position(sf, spread), 'loader object spread has unknowable fields');
    }
    const computedKey = object.properties.find((entry) =>
      'name' in entry && entry.name && ts.isComputedPropertyName(entry.name)
    );
    if (computedKey) {
      diagnostic(
        route,
        field,
        position(sf, computedKey),
        'computed loader key has unknowable field ownership',
      );
    }
    return new Set(
      object.properties.flatMap((entry) =>
        (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry) ||
            ts.isMethodDeclaration(entry)) &&
          (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))
          ? [entry.name.text]
          : []
      ),
    );
  }
  return undefined;
}

function hasExportedLoader(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (
      ts.isExportDeclaration(statement) && !statement.isTypeOnly && !statement.moduleSpecifier &&
      statement.exportClause && ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((entry) =>
        !entry.isTypeOnly && entry.name.text === 'loader' &&
        (entry.propertyName?.text ?? entry.name.text) === 'loader'
      )
    ) return true;
    if (
      (ts.isFunctionDeclaration(statement) && statement.name?.text === 'loader' ||
        ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some((entry) =>
            ts.isIdentifier(entry.name) && entry.name.text === 'loader'
          )) &&
      (ts.getModifiers(statement) ?? []).some((modifier) =>
        modifier.kind === ts.SyntaxKind.ExportKeyword
      ) &&
      !(ts.getModifiers(statement) ?? []).some((modifier) =>
        modifier.kind === ts.SyntaxKind.DefaultKeyword
      )
    ) return true;
  }
  return false;
}

function hasOpaqueNode(nodes: Program['template']): boolean {
  return nodes.some((node) =>
    node.k === 'el' &&
    (node.tag.includes('-') || node.tag === 'slot' ||
      FORBIDDEN_FRAME_TAGS.has(node.tag) ||
      (node.iattrs?.length ?? 0) > 0 ||
      node.attrs.some(([name, value]) => unsafeStreamFrameAttribute(name, value)) ||
      hasOpaqueNode(node.children))
  );
}

function anchorPathIsOpaque(program: Program, path: number[]): boolean {
  let nodes: Program['template'] = program.template;
  for (const index of path) {
    const node = nodes[index];
    if (!node || node.k !== 'el') return true;
    if (
      node.tag.includes('-') || node.tag === 'slot' || FORBIDDEN_FRAME_TAGS.has(node.tag) ||
      node.attrs.some(([name]) => name === 'slot')
    ) return true;
    nodes = node.children;
  }
  return false;
}

function manifestForProgram(
  route: string,
  fields: readonly string[],
  program: Program,
  params: readonly string[],
): Promise<StreamRouteManifest> {
  const records = new Map(program.sourceMap.records.map((record) => [record.id, record.source]));
  const result: StreamRouteManifest['fields'] = [];
  for (const field of fields) {
    const source = records.get(`property:${field}`);
    const at = source
      ? `${source.file}:${source.start.line}:${source.start.column + 1}`
      : `${program.sourceMap.file}:1:1`;
    if (params.includes(field) || field === 'locale') {
      diagnostic(
        route,
        field,
        at,
        `collides with an injected ${field === 'locale' ? 'locale' : 'route param'} property`,
      );
    }
    const prop = program.metadata.properties.find((entry) => entry.name === field);
    if (!prop) diagnostic(route, field, at, 'no declared compiled page property');
    if (prop.computed || prop.attribute !== null || prop.reflect) {
      diagnostic(route, field, at, 'property must be writable, attribute: false, reflect: false');
    }
    const affected = new Set([field]);
    for (const computed of program.metadata.properties.filter((entry) => entry.computed)) {
      if (computed.deps?.some((dep) => affected.has(dep))) {
        affected.add(computed.name);
        const consumer = program.dependencies.find((entry) => entry.signal === computed.name);
        diagnostic(
          route,
          field,
          at,
          `dependency field ${field} -> computed ${computed.name}` +
            (consumer ? ` -> ${program.parts[consumer.owner.index].k} ${consumer.location}` : ''),
        );
      }
    }
    const owners: StreamRouteManifest['fields'][number]['owners'] = [];
    for (const dep of program.dependencies.filter((entry) => entry.signal === field)) {
      const part = program.parts[dep.owner.index];
      const sink = records.get(dep.location);
      const sinkAt = sink ? `${sink.file}:${sink.start.line}:${sink.start.column + 1}` : at;
      if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
        diagnostic(route, field, sinkAt, `${part.k} sink ${dep.location} is not deferrable`);
      }
      if (anchorPathIsOpaque(program, part.location.path.slice(0, -1))) {
        diagnostic(
          route,
          field,
          sinkAt,
          `${part.k} ${dep.location} crosses a slot or custom-element host`,
        );
      }
      if (
        (part.k === 'when' && (hasOpaqueNode(part.on) || hasOpaqueNode(part.off))) ||
        (part.k === 'each' && hasOpaqueNode(part.item))
      ) {
        diagnostic(
          route,
          field,
          sinkAt,
          `${part.k} ${dep.location} has an opaque host, unsafe frame tag/attribute, or item attribute`,
        );
      }
      if (!sink) diagnostic(route, field, at, `missing source ownership for ${dep.location}`);
      owners.push({ ...dep.owner, location: dep.location, source: sink });
    }
    if (owners.length === 0) diagnostic(route, field, at, 'no eligible Part or Region consumer');
    result.push({ field, signal: field, owners });
  }
  // Build-time mirror of the runtime/browser seed and frame budget
  // (__streamFields rejects fields > 32 / owners > 64; the browser seed
  // contract caps fields at 32 and pending Parts at 64). Failing here keeps
  // the error actionable instead of a silent browser rejection at hydration.
  const ownerTotal = result.reduce((count, entry) => count + entry.owners.length, 0);
  if (result.length > 32 || ownerTotal > 64) {
    throw new Error(
      `[openElement] stream route ${route} exceeds the bounded deferred budget: ` +
        `${result.length} fields (max 32), ${ownerTotal} Part owners (max 64). ` +
        'Defer fewer fields, reduce the deferred sinks per field, or split the page.',
    );
  }
  const { sourceMap: _sourceMap, ...wireProgram } = program;
  const bytes = new TextEncoder().encode(JSON.stringify(wireProgram));
  return crypto.subtle.digest('SHA-256', bytes).then((hash) => ({
    program: {
      version: program.version,
      tag: program.tag,
      sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    },
    fields: result,
  }));
}

/** Undefined means the route has no streaming declaration. Unsupported declarations fail the build. */
export async function scanStreamManifest(
  route: string,
  file: string,
  source: string,
  params: readonly string[] = [],
  projectRoot = Deno.cwd(),
  workspaceRoot?: string,
): Promise<StreamRouteManifest | undefined> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const exported = sf.statements.find((entry): entry is ts.ExportAssignment =>
    ts.isExportAssignment(entry) && !entry.isExportEquals
  );
  if (!exported || !ts.isCallExpression(exported.expression)) return undefined;
  const call = exported.expression;
  if (!ts.isIdentifier(call.expression)) return undefined;
  const binding = sf.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const specifier = statement.moduleSpecifier.text;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) return [];
    return named.elements.filter((entry) =>
      entry.name.text === call.expression.getText(sf) &&
      ((entry.propertyName?.text ?? entry.name.text) === 'definePage' &&
          specifier === '@openelement/router' ||
        (entry.propertyName?.text ?? entry.name.text) === 'defineLitPage' &&
          specifier === '@openelement/router/lit')
    )
      .map((entry) => entry.propertyName?.text ?? entry.name.text);
  })[0];
  if (!binding) return undefined;
  const descriptor = objectValue(call.arguments[binding === 'defineLitPage' ? 2 : 1]);
  const intent = descriptor && objectValue(property(descriptor, 'renderIntent')?.initializer);
  if (!intent || !property(intent, 'stream')) return undefined;
  const at = position(sf, property(intent, 'stream')!);
  const fail: (reason: string) => never = (reason) => diagnostic(route, 'defer', at, reason);
  if (binding !== 'definePage') fail('only native compiled pages support stream.defer');
  if (
    !descriptor ||
    descriptor.properties.some((entry) =>
      !ts.isPropertyAssignment(entry) && !ts.isMethodDeclaration(entry)
    )
  ) {
    fail('descriptor must be a literal object without spreads');
  }
  const head = property(descriptor, 'head') &&
    objectValue(property(descriptor, 'head')?.initializer);
  if (
    hasMember(descriptor, 'props') ||
    hasMember(descriptor, 'head') && (!head ||
        head.properties.some((entry) =>
          !ts.isPropertyAssignment(entry) || propertyName(entry.name) === undefined
        ))
  ) {
    fail('custom props projection and request-dependent head are not admitted');
  }
  if (
    intent.properties.length !== 2 ||
    intent.properties.some((entry) =>
      !ts.isPropertyAssignment(entry) ||
      !['mode', 'stream'].includes(propertyName(entry.name) ?? '')
    )
  ) {
    fail('renderIntent must contain only literal mode and stream assignments');
  }
  if (
    !property(intent, 'mode') ||
    !ts.isStringLiteral(property(intent, 'mode')!.initializer) ||
    (property(intent, 'mode')!.initializer as ts.StringLiteral).text !== 'dynamic'
  ) fail("stream requires literal mode: 'dynamic'");
  const stream = objectValue(property(intent, 'stream')?.initializer);
  if (!stream || stream.properties.length !== 1 || !property(stream, 'defer')) {
    fail('stream must contain only a literal defer array');
  }
  const defer = property(stream!, 'defer')!.initializer;
  if (
    !ts.isArrayLiteralExpression(defer) || defer.elements.length === 0 ||
    defer.elements.some((entry) =>
      !ts.isStringLiteral(entry) || !/^[a-zA-Z_$][\w$]*$/.test(entry.text) ||
      isDangerousKey(entry.text)
    )
  ) fail('defer must be a nonempty list of literal safe property names');
  const fields = (defer as ts.ArrayLiteralExpression).elements.map((entry) =>
    (entry as ts.StringLiteral).text
  );
  if (new Set(fields).size !== fields.length) fail('duplicate defer field');
  const hasLoader = sf.statements.some((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'loader' ||
    ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((entry) =>
        ts.isIdentifier(entry.name) && entry.name.text === 'loader'
      )
  );
  if (!hasLoader) fail('stream requires a route loader');
  if (!hasExportedLoader(sf)) {
    fail('route loader must be a named export consumed by the generated entry');
  }
  const knownFields = staticLoaderFields(sf, route, fields[0]);
  if (knownFields) {
    for (const field of fields) {
      if (!knownFields.has(field)) {
        diagnostic(route, field, position(sf, defer), 'missing from literal loader object');
      }
    }
  }
  const pageArg = call.arguments[0];
  if (!pageArg || !ts.isIdentifier(pageArg)) {
    fail('page must be a statically imported compiled class');
  }
  const pageArgName = (pageArg as ts.Identifier).text;
  const imported = sf.statements.filter(ts.isImportDeclaration).find((statement) => {
    const clause = statement.importClause;
    return clause?.name?.text === pageArgName ||
      (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.some((entry) => entry.name.text === pageArgName));
  }) as ts.ImportDeclaration | undefined;
  if (
    !imported || !ts.isStringLiteral(imported.moduleSpecifier) ||
    !imported.moduleSpecifier.text.startsWith('.')
  ) {
    fail('page class must be a local static import');
  }
  const specifier = (imported!.moduleSpecifier as ts.StringLiteral).text;
  const base = resolve(dirname(file), specifier);
  const candidates = extname(base) ? [base] : SOURCE_EXTENSIONS.map((ext) => base + ext);
  let pageFile: string | undefined;
  let pageSource: string | undefined;
  for (const candidate of candidates) {
    pageSource = await safeReadFile(candidate);
    if (pageSource !== undefined) {
      pageFile = candidate;
      break;
    }
  }
  if (!pageFile || pageSource === undefined) {
    fail(`cannot resolve compiled page import ${specifier}`);
  }
  const pageSf = ts.createSourceFile(
    pageFile!,
    pageSource!,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const classes = pageSf.statements.filter(ts.isClassDeclaration);
  if (classes.length !== 1) {
    diagnostic(
      route,
      fields[0],
      `${pageFile}:1:1`,
      `page module declares ${classes.length} classes; one compiled class must own the imported page program`,
    );
  }
  const clause = imported!.importClause!;
  const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.find((entry) => entry.name.text === pageArgName)
    : undefined;
  const pageClass = classes[0];
  const modifiers = ts.getModifiers(pageClass) ?? [];
  const isDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  if (
    clause.name?.text === pageArgName ? !isDefault : !named ||
      isDefault ||
      (named.propertyName?.text ?? named.name.text) !== pageClass.name?.text
  ) {
    diagnostic(
      route,
      fields[0],
      position(pageSf, pageClass),
      'imported page class does not own the compiled default/named program',
    );
  }
  const program = compileElementProgram(
    pageSource!,
    stableModuleId(pageFile!, resolve(projectRoot), workspaceRoot),
  ).program;
  if (program.metadata.className !== pageClass.name?.text) {
    diagnostic(
      route,
      fields[0],
      position(pageSf, pageClass),
      'compiled program identity mismatches the imported page class',
    );
  }
  if (program.root.kind === 'shadow-closed') {
    fail('closed shadow page has no accessible deferred owner');
  }
  return manifestForProgram(route, fields, program, params);
}
