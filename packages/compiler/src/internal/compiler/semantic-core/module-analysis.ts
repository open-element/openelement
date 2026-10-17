/** Bundler-neutral module semantics consumed by compiler and Vite graph adapters. */

import ts from 'typescript';

/**
 * The bundler-neutral facts one module source yields: its relative imports, the
 * intrinsic bindings it admits ({@link ModuleSemanticFacts.compiledElementDecorator},
 * {@link ModuleSemanticFacts.exportedTagName}, custom-element tags it defines or
 * references) and the interaction-event names its handlers bind. The Vite graph
 * adapter branches on these without re-parsing the AST.
 */
export interface ModuleSemanticFacts {
  relativeImports: string[];
  /**
   * Every static import/export specifier the module spells, relative or not —
   * present only when the caller asks for it (`collectSpecifiers`), because a
   * host that walks a module graph through its own resolver (S-C1.4's
   * server-rendered style-edge pass) needs the aliased and package specifiers
   * too, while every other consumer's facts stay exactly as they were.
   */
  moduleSpecifiers?: string[];
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
  /**
   * True when the module default-exports a page-definition factory call from
   * the host's injected vocabulary, or is an .mdx route. The default scan
   * (no injected vocabulary) never recognizes another package's factories.
   */
  definePage: boolean;
  /**
   * The server function page fact (alpha15 server lane): the first argument
   * of a default-exported `definePage(…)` call when that argument is an
   * identifier resolving to a server function component THIS module
   * declares. A function component never carries a Part Program, so the
   * route cannot be a compiled class page; the host build renders it through
   * the component function. Spread-conditional: absent for class pages and
   * non-page modules. The scan is order-independent (the module's server
   * function components are collected before the page call is judged), so a
   * default export written above its component declaration admits
   * identically. An inline arrow or an unexported local — the shapes whose
   * JSX would otherwise escape to runtime — never records the fact.
   */
  pageComponentName?: string;
  /**
   * The exported functions whose body is a single return of JSX — the
   * server-only TSX function components this module declares (alpha15 server
   * lane). Discovery is structural and deterministic: `export function`
   * declarations (named, not default) with exactly one return statement of a
   * JSX element, or `export const` arrows with a JSX expression body. The
   * fact is the cheap graph-walker face; admission and lowering stay the
   * compile entry's job (`compileServerComponentModule`), which fails closed
   * on everything this scan only reports. Sorted alphabetically.
   */
  serverFunctionComponents: string[];
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
 * an intrinsic. The built-in set covers `@openelement/element` only — host
 * frameworks extend admission through injected
 * {@link StaticSidecarDescriptor}s, never through compiler-side knowledge of
 * another package.
 */
export type IntrinsicName =
  | 'element'
  | 'property'
  | 'OpenElement'
  | 'ErrorBoundary'
  | 'computed'
  | 'trustedHtml';

const INTRINSIC_MODULES: Readonly<Record<IntrinsicName, readonly string[]>> = {
  element: ['@openelement/element'],
  property: ['@openelement/element'],
  OpenElement: ['@openelement/element'],
  // The README's error-boundary authoring form subclasses ErrorBoundary —
  // a canonical named import of '@openelement/element' like OpenElement, and
  // the compiler's admitted base-class set (analyze-module.ts). ErrorBoundary
  // extends OpenElement, so everything downstream of admission is unchanged.
  ErrorBoundary: ['@openelement/element'],
  computed: ['@openelement/element'],
  trustedHtml: ['@openelement/element'],
};

// The descriptor contracts are protocol-owned since #1557 (both the compiler
// and the router build consume them without depending on each other); the
// compiler facade re-exports the same identities below.
export type {
  ModuleVocabularyDescriptor,
  StaticSidecarDescriptor,
} from '@openelement/protocol/module-descriptors';

import type {
  ModuleVocabularyDescriptor,
  StaticSidecarDescriptor,
} from '@openelement/protocol/module-descriptors';

/** Host-supplied admission extensions for the semantic core. */
export interface SemanticCoreOptions {
  /**
   * Static-sidecar descriptors the host admits. The default core knows none:
   * a module carrying a sidecar policy statement fails closed until the host
   * injects its descriptor.
   */
  readonly staticSidecars?: readonly StaticSidecarDescriptor[];
}

/** Host-supplied vocabulary extensions for the module scan. */
export interface ModuleSemanticsOptions {
  /**
   * Vocabulary descriptors the host admits beyond the core's own element
   * bindings. The default scan knows no other package: a route module's
   * page-definition export or registration factory is recognized only when
   * the host injects its descriptor.
   */
  readonly vocabulary?: readonly ModuleVocabularyDescriptor[];
  /** Collect {@link ModuleSemanticFacts.moduleSpecifiers} (opt-in). */
  readonly collectSpecifiers?: boolean;
}

/**
 * The core's own vocabulary: empty. The element package exposes no
 * defineElement() factory — compiled registration is the @element decorator
 * on an OpenElement subclass, which the scan recognizes directly. Every live
 * registration factory — Router's page definition, the lit page factory —
 * rides host-injected descriptors, and the retired factory names fail closed
 * like any other unrecognized import.
 */
const CORE_VOCABULARY: readonly ModuleVocabularyDescriptor[] = [];

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
  /**
   * True only when the expression resolves to a runtime named import matching
   * one of the injected 'static-sidecar' descriptors (aliases followed,
   * canonical specifier). Namespace, default, type-only, conflicting and
   * re-export provenance is never admitted — the caller fails closed.
   */
  isStaticSidecarCallee(expression: ts.Expression): boolean;
  /** True for a runtime (non-type-only) named import, aliases followed. */
  isRuntimeNamedImport(
    localName: string,
    module: string | readonly string[],
    imported: string,
  ): boolean;
  /**
   * True when the module binds the name itself (top-level local declaration
   * or any import): such a spelling never refers to a platform global. Same
   * top-level-only shadowing discipline the intrinsic resolution uses.
   */
  hasModuleScopeBinding(localName: string): boolean;
}

/**
 * The compiler's admitted base classes, in resolution order (alpha.13 I2,
 * KR-11): the README documents subclassing `ErrorBoundary`, and the compiler
 * admits that authoring form exactly as it admits `OpenElement` — both must
 * be runtime named imports of '@openelement/element', so the binding-source
 * check is unchanged. `ErrorBoundary extends OpenElement`, so everything
 * downstream of admission sees the same class shape.
 */
export const CANONICAL_BASE_CLASS_INTRINSICS: readonly IntrinsicName[] = [
  'OpenElement',
  'ErrorBoundary',
];

/**
 * Resolve one heritage clause against the admitted base classes. Returns the
 * first canonical resolution; when none is canonical, the first resolution
 * that names why the provenance is unsupported (so the caller's fail-closed
 * diagnostic keeps carrying the reason). A plain identifier whose text is one
 * of the admitted names is tried first, so a conflicting-binding diagnostic
 * names the base class the author wrote rather than the other one.
 */
export function resolveCanonicalBaseClass(
  bindings: ModuleIntrinsicBindings,
  heritage: ts.Expression | undefined,
): IntrinsicResolution | undefined {
  if (heritage === undefined) return undefined;
  const writtenName = ts.isIdentifier(heritage) ? heritage.text : undefined;
  const candidates = [
    ...CANONICAL_BASE_CLASS_INTRINSICS.filter((name) => name === writtenName),
    ...CANONICAL_BASE_CLASS_INTRINSICS.filter((name) => name !== writtenName),
  ];
  let unsupported: IntrinsicResolution | undefined;
  for (const intrinsic of candidates) {
    const resolution = bindings.resolveIntrinsic(heritage, intrinsic);
    if (resolution.canonical) return resolution;
    if (unsupported === undefined && resolution.unsupported !== undefined) {
      unsupported = resolution;
    }
  }
  return unsupported;
}

/**
 * Resolve the module-scope import/declaration bindings of one source file
 * once, so decorator, heritage and factory use sites all answer provenance
 * from the same table. The semantic core analyzes a single module and stays
 * bundler-neutral: it never follows re-exports across files. Host-injected
 * static-sidecar descriptors ride the options — the core itself never names
 * another package.
 */
export function createModuleIntrinsicBindings(
  sourceFile: ts.SourceFile,
  options: SemanticCoreOptions = {},
): ModuleIntrinsicBindings {
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
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
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

  const resolveIdentifier = (
    name: string,
    bindingName: string,
    modules: readonly string[],
  ): IntrinsicResolution => {
    if (locals.has(name)) return { canonical: false };
    const bindings = imports.get(name) ?? [];
    if (bindings.length === 0) return { canonical: false };
    if (bindings.length > 1) {
      return {
        canonical: false,
        unsupported:
          `conflicting module-scope bindings for "${name}" (${bindings
            .map(describe)
            .join('; ')}); ` +
          `import ${bindingName} once from its canonical module '${modules.join("' or '")}'`,
      };
    }
    const binding = bindings[0];
    if (binding.form !== 'named') {
      if (modules.includes(binding.module)) {
        return {
          canonical: false,
          unsupported: `"${name}" is a ${describe(
            binding,
          )}; ${bindingName} requires a runtime named import`,
        };
      }
      return { canonical: false };
    }
    if (modules.includes(binding.module)) {
      if (binding.imported !== bindingName) return { canonical: false };
      if (binding.typeOnly) {
        return {
          canonical: false,
          unsupported:
            `"${name}" is a type-only import of ${bindingName} from '${binding.module}'; ` +
            'intrinsics are runtime named imports',
        };
      }
      return { canonical: true, localName: name };
    }
    if (binding.imported === bindingName && binding.module.startsWith('.')) {
      return {
        canonical: false,
        unsupported:
          `"${name}" imports ${bindingName} from '${binding.module}'; re-export provenance is not ` +
          `resolved across modules — import ${bindingName} from its canonical module ` +
          `'${modules.join("' or '")}'`,
      };
    }
    return { canonical: false };
  };

  return {
    resolveIntrinsic(expression, intrinsic) {
      if (ts.isIdentifier(expression)) {
        return resolveIdentifier(expression.text, intrinsic, INTRINSIC_MODULES[intrinsic]);
      }
      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.name.text === intrinsic
      ) {
        const namespace = expression.expression.text;
        const bindings = imports.get(namespace) ?? [];
        if (
          !locals.has(namespace) &&
          bindings.length === 1 &&
          bindings[0].form === 'namespace' &&
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
    isStaticSidecarCallee(expression) {
      if (!ts.isIdentifier(expression)) return false;
      for (const descriptor of options.staticSidecars ?? []) {
        if (
          resolveIdentifier(expression.text, descriptor.exportName, [descriptor.moduleSpecifier])
            .canonical
        )
          return true;
      }
      return false;
    },
    isRuntimeNamedImport(localName, module, imported) {
      if (locals.has(localName)) return false;
      const modules = typeof module === 'string' ? [module] : module;
      const bindings = imports.get(localName) ?? [];
      return (
        bindings.length === 1 &&
        bindings[0].form === 'named' &&
        modules.includes(bindings[0].module) &&
        bindings[0].imported === imported &&
        !bindings[0].typeOnly
      );
    },
    hasModuleScopeBinding(localName) {
      return locals.has(localName) || imports.has(localName);
    },
  };
}

function isCustomElementTag(value: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(value);
}

/**
 * The exported name of a function declaration / single-declarator variable
 * statement that {@link isExportedServerComponentDeclaration} admitted.
 */
export function serverComponentName(statement: ts.Statement): string {
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? '';
  const declaration = (statement as ts.VariableStatement).declarationList.declarations[0];
  return ts.isIdentifier(declaration.name) ? declaration.name.text : '';
}

function returnsJsx(expression: ts.Expression | undefined): boolean {
  const value =
    expression && ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  return value !== undefined && (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value));
}

/**
 * The structural server function component shapes the fact scan reports:
 * a named `export function` whose body is exactly one `return <jsx>` or an
 * `export const` arrow whose expression body is JSX. The compile entry
 * (`compileServerComponentModule`) re-derives the same shapes with
 * fail-closed diagnostics; this scan only answers "is there something to
 * compile here" for the module graph walker.
 */
export function isExportedServerComponentDeclaration(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
  const exported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return false;
  if (ts.isFunctionDeclaration(statement)) {
    if (
      statement.name === undefined ||
      modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ||
      statement.body === undefined ||
      !ts.isBlock(statement.body)
    ) {
      return false;
    }
    const returns = statement.body.statements.filter(ts.isReturnStatement);
    return (
      statement.body.statements.length === 1 &&
      returns.length === 1 &&
      returnsJsx(returns[0].expression)
    );
  }
  if (ts.isVariableStatement(statement)) {
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1 || !ts.isIdentifier(declarations[0].name)) return false;
    const initializer = declarations[0].initializer;
    return (
      initializer !== undefined &&
      ts.isArrowFunction(initializer) &&
      !ts.isBlock(initializer.body) &&
      returnsJsx(initializer.body)
    );
  }
  return false;
}

function stringArgument(call: ts.CallExpression, index = 0): string | undefined {
  const argument = call.arguments[index];
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

/**
 * Whether a `.define(...)` callee object is the platform CustomElementRegistry:
 * a bare module-unbound `customElements` global, or the registry reached
 * through an unambiguous unbound global qualifier
 * (`window.`/`globalThis.`/`self.`). Raw text matching misfires both ways — a
 * module-scope `customElements` binding (import or local) is a shadow, not the
 * registry, while a qualified global spelling is the registry and must count.
 */
function isCustomElementsRegistry(
  object: ts.Expression,
  imports: ModuleIntrinsicBindings,
): boolean {
  if (ts.isIdentifier(object)) {
    return object.text === 'customElements' && !imports.hasModuleScopeBinding(object.text);
  }
  if (
    ts.isPropertyAccessExpression(object) &&
    object.name.text === 'customElements' &&
    ts.isIdentifier(object.expression) &&
    !imports.hasModuleScopeBinding(object.expression.text)
  ) {
    return (
      object.expression.text === 'window' ||
      object.expression.text === 'globalThis' ||
      object.expression.text === 'self'
    );
  }
  return false;
}

/**
 * Parse one module source and report the semantic facts the compiler boundary
 * and the Vite graph adapters branch on. Pure: it never resolves imports from
 * disk and never throws on foreign or invalid syntax — an unparsable module
 * simply yields no recognized facts. The scan's factory vocabulary is
 * host-injected: the default knows only the element package's own
 * registration factories, and page-definition/registration facts for other
 * packages require the caller's {@link ModuleSemanticsOptions.vocabulary}
 * descriptors.
 */
export function analyzeModuleSemantics(
  source: string,
  fileName: string,
  options: ModuleSemanticsOptions = {},
): ModuleSemanticFacts {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = createModuleIntrinsicBindings(sourceFile);
  const vocabulary = [...CORE_VOCABULARY, ...(options.vocabulary ?? [])];
  const pageDefinitionBindings = vocabulary.filter(
    (descriptor) => descriptor.kind === 'page-definition',
  );
  const registrationBindings = vocabulary.filter(
    (descriptor) => descriptor.kind === 'element-registration',
  );
  const relativeImports = new Set<string>();
  const moduleSpecifiers = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      moduleSpecifiers.add(statement.moduleSpecifier.text);
      if (statement.moduleSpecifier.text.startsWith('.'))
        relativeImports.add(statement.moduleSpecifier.text);
    }
  }

  let exportedTagName: string | undefined;
  let compiledElementDecorator = false;
  let unsupportedElementDecorator: string | undefined;
  let definePage = fileName.endsWith('.mdx');
  let pageComponentName: string | undefined;
  let usesExportedTagName = false;
  let enhancedForm = false;
  let defaultCompiledTag: string | undefined;
  const defined = new Set<string>();
  const referenced = new Set<string>();
  const interactionEvents = new Set<string>();
  const serverComponents = new Set<string>();

  // The server-function-component set is collected BEFORE the page-call
  // judgement so the pageComponentName fact is order-independent: a default
  // export written above its component declaration admits identically (the
  // pre-pass is the same isExportedServerComponentDeclaration predicate the
  // main loop reports from — one shape authority).
  for (const statement of sourceFile.statements) {
    if (isExportedServerComponentDeclaration(statement)) {
      serverComponents.add(serverComponentName(statement));
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'tagName' &&
          declaration.initializer &&
          (ts.isStringLiteral(declaration.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(declaration.initializer))
        )
          exportedTagName = declaration.initializer.text;
      }
    }
    if (
      ts.isExportAssignment(statement) &&
      ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression)
    ) {
      // A default-exported page-definition factory call marks the module as a
      // page — but only for a binding the host's injected vocabulary admits.
      // (The lit renderer's factory lives on a subpath; the router injects
      // both specifiers, the core stays package-blind, #1339.)
      const pageFactory = statement.expression.expression.text;
      const matchedPageBinding = pageDefinitionBindings.find((descriptor) =>
        imports.isRuntimeNamedImport(
          pageFactory,
          descriptor.moduleSpecifier,
          descriptor.exportName,
        ),
      );
      if (matchedPageBinding) {
        definePage = true;
        // The server function page (alpha15): only the native definePage
        // binding (not the lit factory whose first argument is a tag string)
        // can admit a component function. The first argument must be a plain
        // identifier that resolves to a server function component THIS module
        // declares — an inline arrow or an unexported local would ship runtime
        // JSX, and the server lane has no interpreter (the R1 admission rule
        // mirrored).
        if (
          matchedPageBinding.kind === 'page-definition' &&
          matchedPageBinding.exportName === 'definePage'
        ) {
          const firstArgument = statement.expression.arguments[0];
          if (
            firstArgument !== undefined &&
            ts.isIdentifier(firstArgument) &&
            serverComponents.has(firstArgument.text)
          ) {
            pageComponentName = firstArgument.text;
          }
        }
      }
    }

    if (!ts.isClassDeclaration(statement)) continue;
    const isDefault = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );
    const heritage = statement.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    // Provenance-only (#1209): a bare base-class spelling never counts; the
    // heritage identifier must bind a canonical named import (aliases
    // followed). The admitted set is OpenElement or ErrorBoundary — the
    // README's error-boundary authoring form (I2, KR-11).
    const extendsCanonicalBase = resolveCanonicalBaseClass(imports, heritage)?.canonical === true;
    for (const decorator of ts.getDecorators(statement) ?? []) {
      if (!ts.isCallExpression(decorator.expression)) {
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
      if (isDefault && extendsCanonicalBase) defaultCompiledTag = tag;
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith('.')
      ) {
        relativeImports.add(node.arguments[0].text);
      }
      if (ts.isIdentifier(expression)) {
        // Provenance-only (#1209): a registration factory counts only when the
        // host's injected vocabulary admits the binding — a runtime named
        // import from a descriptor's canonical specifier (aliases followed);
        // a bare same-name spelling records nothing.
        if (
          registrationBindings.some((descriptor) =>
            imports.isRuntimeNamedImport(
              expression.text,
              descriptor.moduleSpecifier,
              descriptor.exportName,
            ),
          )
        ) {
          const tag = stringArgument(node);
          if (tag && isCustomElementTag(tag)) defined.add(tag);
          if (tag !== undefined && tag === exportedTagName) usesExportedTagName = true;
          if (
            node.arguments[0] &&
            ts.isIdentifier(node.arguments[0]) &&
            node.arguments[0].text === 'tagName'
          )
            usesExportedTagName = true;
        }
        const isElementJsxFactory =
          imports.isRuntimeNamedImport(
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
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'define' &&
        isCustomElementsRegistry(expression.expression, imports)
      ) {
        const tag = stringArgument(node);
        if (tag && isCustomElementTag(tag)) defined.add(tag);
        if (tag !== undefined && tag === exportedTagName) usesExportedTagName = true;
        if (
          node.arguments[0] &&
          ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === 'tagName'
        )
          usesExportedTagName = true;
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
    ...(options.collectSpecifiers === true ? { moduleSpecifiers: [...moduleSpecifiers] } : {}),
    compiledElementDecorator,
    ...(unsupportedElementDecorator === undefined ? {} : { unsupportedElementDecorator }),
    ...(exportedTagName === undefined ? {} : { exportedTagName }),
    definePage,
    ...(pageComponentName === undefined ? {} : { pageComponentName }),
    serverFunctionComponents: [...serverComponents].sort(),
    usesExportedTagName,
    enhancedForm,
    ...(defaultCompiledTag === undefined ? {} : { defaultCompiledTag }),
    definedCustomElementTags: [...defined].sort(),
    referencedCustomElementTags: [...referenced].sort(),
    compilerInteractionEvents: [...interactionEvents].sort(),
  };
}
