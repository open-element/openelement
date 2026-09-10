/** Bundler-neutral module semantics consumed by compiler and Vite graph adapters. */

import ts from 'typescript';

export interface ModuleSemanticFacts {
  relativeImports: string[];
  compiledElementDecorator: boolean;
  /**
   * Set when a class decorator spells the `element` intrinsic through
   * unsupported or ambiguous provenance (type-only import, namespace access,
   * default import, conflicting duplicate bindings, or a relative-module
   * re-export). Never set for clearly foreign bindings (third-party packages,
   * local declarations, bare/global spellings) — those modules are simply not
   * OpenElement modules. The plugin gate compiles such modules so the
   * compiler boundary fails closed with the OEC9027 provenance diagnostic.
   */
  unsupportedElementDecorator?: string;
  exportedTagName?: string;
  definePage: boolean;
  usesExportedTagName: boolean;
  enhancedForm: boolean;
  defaultCompiledTag?: string;
  definedCustomElementTags: string[];
  referencedCustomElementTags: string[];
  compilerInteractionEvents: string[];
}

/**
 * The canonical intrinsic-binding model (#1209, A10.1): compiler intrinsics
 * are binding identities (module specifier + imported name, aliases
 * followed), never identifier spellings. A bare/global spelling NEVER admits
 * an intrinsic. `@openelement/app` re-exports neither `OpenElement` nor the
 * compile-time-only decorator intrinsics, so the canonical specifier for
 * those is `@openelement/element` only.
 */
export type IntrinsicName =
  | 'element'
  | 'property'
  | 'OpenElement'
  | 'computed'
  | 'trustedHtml'
  | 'defineIslandConfig';

const INTRINSIC_MODULES: Readonly<Record<IntrinsicName, readonly string[]>> = {
  element: ['@openelement/element'],
  property: ['@openelement/element'],
  OpenElement: ['@openelement/element'],
  computed: ['@openelement/element'],
  trustedHtml: ['@openelement/element'],
  defineIslandConfig: ['@openelement/app'],
};

/**
 * Intrinsics that exist only at compile time: the compiler erases the
 * decorator applications they power, and the runtime packages export no such
 * bindings, so the generated module must not keep importing them.
 */
const COMPILE_TIME_ONLY_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  '@openelement/element': ['element', 'property'],
};

/** True when `imported` from `module` is a compile-time-only intrinsic binding. */
export function isCompileTimeOnlyImport(module: string, imported: string): boolean {
  return COMPILE_TIME_ONLY_IMPORTS[module]?.includes(imported) ?? false;
}

interface ImportBinding {
  form: 'named' | 'namespace' | 'default';
  module: string;
  /** Exported name for named imports; '*' for namespace; 'default' for default. */
  imported: string;
  typeOnly: boolean;
}

export interface IntrinsicResolution {
  /** True only for a runtime named import of the intrinsic from its canonical module. */
  readonly canonical: boolean;
  /** The local identifier at the use site (present only when canonical). */
  readonly localName?: string;
  /**
   * Why the provenance is unsupported/ambiguous (type-only, namespace,
   * default import, conflicting duplicates, relative re-export). Callers must
   * fail closed with this reason; absent for clearly foreign or unbound
   * spellings.
   */
  readonly unsupported?: string;
}

export interface ModuleIntrinsicBindings {
  resolveIntrinsic(expression: ts.Expression, intrinsic: IntrinsicName): IntrinsicResolution;
  /** True for a runtime (non-type-only) named import, aliases followed. */
  isRuntimeNamedImport(
    localName: string,
    module: string | readonly string[],
    imported: string,
  ): boolean;
}

/**
 * Resolve the module-scope import/declaration bindings of one source file
 * once, so decorator, heritage and factory use sites all answer provenance
 * from the same table. The semantic core analyzes a single module and stays
 * bundler-neutral (ADR-0148): it never follows re-exports across files.
 */
export function createModuleIntrinsicBindings(sourceFile: ts.SourceFile): ModuleIntrinsicBindings {
  const imports = new Map<string, ImportBinding[]>();
  const locals = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const module = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) continue;
      const clauseTypeOnly = clause.isTypeOnly ?? false;
      const add = (local: string, binding: ImportBinding): void => {
        const list = imports.get(local) ?? [];
        list.push(binding);
        imports.set(local, list);
      };
      if (clause.name) {
        add(clause.name.text, {
          form: 'default',
          module,
          imported: 'default',
          typeOnly: clauseTypeOnly,
        });
      }
      const namedBindings = clause.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          add(element.name.text, {
            form: 'named',
            module,
            imported: element.propertyName?.text ?? element.name.text,
            typeOnly: clauseTypeOnly || (element.isTypeOnly ?? false),
          });
        }
      } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        add(namedBindings.name.text, {
          form: 'namespace',
          module,
          imported: '*',
          typeOnly: clauseTypeOnly,
        });
      }
      continue;
    }
    // Top-level local value declarations (including ambient `declare` forms)
    // shadow any import for intrinsic resolution: a local binding is never an
    // intrinsic, which is what keeps lexical shadowing and same-name local
    // functions/classes out of the grammar.
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      locals.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) locals.add(declaration.name.text);
      }
    }
  }

  const describe = (binding: ImportBinding): string => {
    if (binding.form === 'namespace') return `namespace import of '${binding.module}'`;
    if (binding.form === 'default') return `default import of '${binding.module}'`;
    return `import of ${binding.imported} from '${binding.module}'`;
  };

  const resolveIdentifier = (name: string, intrinsic: IntrinsicName): IntrinsicResolution => {
    const modules = INTRINSIC_MODULES[intrinsic];
    if (locals.has(name)) return { canonical: false };
    const bindings = imports.get(name) ?? [];
    if (bindings.length === 0) return { canonical: false };
    if (bindings.length > 1) {
      return {
        canonical: false,
        unsupported:
          `conflicting module-scope bindings for "${name}" (${
            bindings.map(describe).join('; ')
          }); ` +
          `import ${intrinsic} once from its canonical module '${modules.join("' or '")}'`,
      };
    }
    const binding = bindings[0];
    if (binding.form !== 'named') {
      if (modules.includes(binding.module)) {
        return {
          canonical: false,
          unsupported: `"${name}" is a ${
            describe(binding)
          }; ${intrinsic} requires a runtime named import`,
        };
      }
      return { canonical: false };
    }
    if (modules.includes(binding.module)) {
      if (binding.imported !== intrinsic) return { canonical: false };
      if (binding.typeOnly) {
        return {
          canonical: false,
          unsupported:
            `"${name}" is a type-only import of ${intrinsic} from '${binding.module}'; ` +
            'intrinsics are runtime named imports',
        };
      }
      return { canonical: true, localName: name };
    }
    if (binding.imported === intrinsic && binding.module.startsWith('.')) {
      return {
        canonical: false,
        unsupported:
          `"${name}" imports ${intrinsic} from '${binding.module}'; re-export provenance is not ` +
          `resolved across modules — import ${intrinsic} from its canonical module ` +
          `'${modules.join("' or '")}'`,
      };
    }
    return { canonical: false };
  };

  return {
    resolveIntrinsic(expression, intrinsic) {
      if (ts.isIdentifier(expression)) return resolveIdentifier(expression.text, intrinsic);
      if (
        ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
        expression.name.text === intrinsic
      ) {
        const namespace = expression.expression.text;
        const bindings = imports.get(namespace) ?? [];
        if (
          !locals.has(namespace) && bindings.length === 1 && bindings[0].form === 'namespace' &&
          INTRINSIC_MODULES[intrinsic].includes(bindings[0].module)
        ) {
          return {
            canonical: false,
            unsupported:
              `namespace-qualified intrinsic "${namespace}.${intrinsic}" is unsupported; ` +
              `import ${intrinsic} from '${bindings[0].module}' by name`,
          };
        }
      }
      return { canonical: false };
    },
    isRuntimeNamedImport(localName, module, imported) {
      if (locals.has(localName)) return false;
      const modules = typeof module === 'string' ? [module] : module;
      const bindings = imports.get(localName) ?? [];
      return bindings.length === 1 && bindings[0].form === 'named' &&
        modules.includes(bindings[0].module) && bindings[0].imported === imported &&
        !bindings[0].typeOnly;
    },
  };
}

function isCustomElementTag(value: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(value);
}

function stringArgument(call: ts.CallExpression, index = 0): string | undefined {
  const argument = call.arguments[index];
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

export function analyzeModuleSemantics(source: string, fileName: string): ModuleSemanticFacts {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = createModuleIntrinsicBindings(sourceFile);
  const relativeImports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith('.')
    ) relativeImports.add(statement.moduleSpecifier.text);
  }

  let exportedTagName: string | undefined;
  let compiledElementDecorator = false;
  let unsupportedElementDecorator: string | undefined;
  let definePage = fileName.endsWith('.mdx');
  let usesExportedTagName = false;
  let enhancedForm = false;
  let defaultCompiledTag: string | undefined;
  const defined = new Set<string>();
  const referenced = new Set<string>();
  const interactionEvents = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) && declaration.name.text === 'tagName' &&
          declaration.initializer &&
          (ts.isStringLiteral(declaration.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
        ) exportedTagName = declaration.initializer.text;
      }
    }
    if (
      ts.isExportAssignment(statement) && ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      (imports.isRuntimeNamedImport(
        statement.expression.expression.text,
        '@openelement/app',
        'definePage',
      ) ||
        // #1339: the lit renderer's page definition factory lives on the
        // @openelement/app/lit subpath; a route default-exporting it is a
        // definePage-shaped route for scanning purposes (descriptor attached
        // by the same internal path, host tag on openElementPageTag).
        imports.isRuntimeNamedImport(
          statement.expression.expression.text,
          '@openelement/app/lit',
          'defineLitPage',
        ))
    ) definePage = true;

    if (!ts.isClassDeclaration(statement)) continue;
    const isDefault = statement.modifiers?.some((modifier) =>
      modifier.kind === ts.SyntaxKind.DefaultKeyword
    );
    const heritage = statement.heritageClauses?.find((clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword
    )?.types[0]?.expression;
    // Provenance-only (#1209): a bare `OpenElement` spelling never counts; the
    // heritage identifier must bind the canonical import (aliases followed).
    const extendsOpenElement = heritage !== undefined &&
      imports.resolveIntrinsic(heritage, 'OpenElement').canonical;
    for (const decorator of ts.getDecorators(statement) ?? []) {
      if (
        !ts.isCallExpression(decorator.expression)
      ) {
        continue;
      }
      const resolution = imports.resolveIntrinsic(decorator.expression.expression, 'element');
      if (!resolution.canonical) {
        // Unsupported/ambiguous provenance surfaces so the plugin gate can
        // route the module to the compiler, which fails closed (OEC9027);
        // clearly foreign bindings stay silent pass-throughs.
        if (resolution.unsupported && unsupportedElementDecorator === undefined) {
          unsupportedElementDecorator = resolution.unsupported;
        }
        continue;
      }
      compiledElementDecorator = true;
      const tag = stringArgument(decorator.expression);
      if (!tag || !isCustomElementTag(tag)) continue;
      defined.add(tag);
      if (isDefault && extendsOpenElement) defaultCompiledTag = tag;
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')
      ) {
        relativeImports.add(node.arguments[0].text);
      }
      if (ts.isIdentifier(expression)) {
        // Provenance-only (#1209): the legacy registration factories count
        // only when bound to a real runtime named import from an OpenElement
        // package; a bare same-name spelling records nothing.
        if (
          imports.isRuntimeNamedImport(
            expression.text,
            ['@openelement/element', '@openelement/app'],
            'defineElement',
          ) ||
          imports.isRuntimeNamedImport(
            expression.text,
            ['@openelement/element', '@openelement/app'],
            'defineIsland',
          )
        ) {
          const tag = stringArgument(node);
          if (tag && isCustomElementTag(tag)) defined.add(tag);
          if (tag !== undefined && tag === exportedTagName) usesExportedTagName = true;
          if (
            node.arguments[0] && ts.isIdentifier(node.arguments[0]) &&
            node.arguments[0].text === 'tagName'
          ) usesExportedTagName = true;
        }
        const isElementJsxFactory = imports.isRuntimeNamedImport(
          expression.text,
          '@openelement/element/jsx-runtime',
          'jsx',
        ) ||
          imports.isRuntimeNamedImport(
            expression.text,
            '@openelement/element/jsx-runtime',
            'jsxs',
          ) ||
          imports.isRuntimeNamedImport(
            expression.text,
            '@openelement/element/jsx-runtime',
            'jsxDEV',
          );
        if (isElementJsxFactory) {
          const tag = stringArgument(node);
          if (tag && isCustomElementTag(tag)) referenced.add(tag);
        }
      } else if (
        ts.isPropertyAccessExpression(expression) && expression.expression.getText(sourceFile) ===
          'customElements' &&
        expression.name.text === 'define'
      ) {
        const tag = stringArgument(node);
        if (tag && isCustomElementTag(tag)) defined.add(tag);
        if (tag !== undefined && tag === exportedTagName) usesExportedTagName = true;
        if (
          node.arguments[0] && ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === 'tagName'
        ) usesExportedTagName = true;
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (isCustomElementTag(tag)) {
        referenced.add(tag);
        if (tag === exportedTagName) usesExportedTagName = true;
      }
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) continue;
        const name = attribute.name.getText(sourceFile);
        if (name === 'data-open-enhance') enhancedForm = true;
        if (/^on[A-Z]/.test(name)) interactionEvents.add(name.slice(2).toLowerCase());
      }
    }
    // Lit templates carry the same attribute inside html`` template literals
    // instead of JSX (#1339: the enhancement layer is renderer-shared, so the
    // detection must be too). The attribute-shape lookahead ([\s=>/]) keeps
    // prose mentions from pulling the layer in, matching the JSX rule.
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const parts = ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((text) => /data-open-enhance(?=[\s=>/])/.test(text))) enhancedForm = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    relativeImports: [...relativeImports],
    compiledElementDecorator,
    ...(unsupportedElementDecorator === undefined ? {} : { unsupportedElementDecorator }),
    ...(exportedTagName === undefined ? {} : { exportedTagName }),
    definePage,
    usesExportedTagName,
    enhancedForm,
    ...(defaultCompiledTag === undefined ? {} : { defaultCompiledTag }),
    definedCustomElementTags: [...defined].sort(),
    referencedCustomElementTags: [...referenced].sort(),
    compilerInteractionEvents: [...interactionEvents].sort(),
  };
}
