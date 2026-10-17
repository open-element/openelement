/**
 * The style edges of an already-compiled artifact module — the second admitted
 * input class of the compiled-element transform (#1558, alpha.13 I1/KR-10).
 *
 * Packages ship the compiler's OWN emitted modules (the release pack pipeline
 * stages `compilePackageElementModules` output),
 * so a consumer build that resolves one has no authored grammar left to
 * compile — but the module's `.css` imports are real edges of the style asset
 * protocol, and the style-asset intercept (router) answers only edges the
 * compiled-element transform registered. Without this recovery the packaged
 * module's sheet imports fall through to the bundler's own CSS channel, whose
 * module has no default export: the island chunk's `static styles` binding
 * then fails the build at MISSING_EXPORT (reproduced with the packed
 * `@openelement/ui`, /tmp/allpkgs app: `"default" is not exported by
 * ".../open-button.css"`), because a workspace build compiled the `.tsx`
 * source and never needed the artifact path.
 *
 * The accepted shape is the ONE style authoring grammar
 * (semantic-core/style-imports.ts): a relative `.css` default import arrayed
 * in the class's `static styles`. The extraction here is deliberately the
 * PERMISSIVE read of that shape: it claims exactly the relative `.css`
 * default imports arrayed as plain bindings, and leaves every other member of
 * a `static styles` array untouched. Artifacts compiled before #1558
 * (legacy inline sheets that referenced a `StyleSheet` built in a plain
 * module) therefore keep riding the old path unchanged — a strict admission
 * here would break every previously-published package for no protocol gain.
 *
 * One writer (P8): this module only recovers edge specifiers; the caller (the
 * compiled-element transform's host binding) registers them, exactly as it
 * registers an authored compile's `styleRequests`.
 */

import ts from 'typescript';
import { typescriptParser } from './semantic-core/parse-module.ts';

/**
 * The cheap prefilter every emitted artifact carries: the Part Program's
 * module-local binding name (`const __partProgram = ...` plus the
 * `static __partProgram` member). Modules without it are never parsed, so the
 * recovery costs nothing on ordinary graph nodes.
 */
const COMPILED_ARTIFACT_MARKER = '__partProgram';

/**
 * The second, equally cheap gate: only a module naming a `.css` specifier can
 * carry sheet edges. Modules that merely mention the marker (the element
 * runtime reads `ctor.__partProgram`) stop here instead of paying a parse.
 */
const CSS_SPECIFIER_HINT = /\.css['"]/;

/** The one static member whose initializer arrays the module's sheets. */
const STYLES_MEMBER_NAME = 'styles';

/** Whether a specifier is the grammar's relative sheet form. */
function isRelativeSheetSpecifier(specifier: string): boolean {
  return specifier.endsWith('.css') && (specifier.startsWith('./') || specifier.startsWith('../'));
}

/**
 * The module's relative `.css` default imports, keyed by local binding.
 * Side-effect, named and bare-specifier forms are not sheet edges of the
 * grammar and are left to the bundler.
 */
function collectSheetBindings(sf: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!isRelativeSheetSpecifier(specifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.name) continue;
    bindings.set(clause.name.text, specifier);
  }
  return bindings;
}

/**
 * What one compiled artifact module declares about its style edges: the
 * relative `.css` specifiers in authored order, and the light-root scope tag
 * the module's Part Program names (undefined for a shadow-root artifact).
 */
export interface CompiledArtifactStyleRead {
  readonly requests: readonly string[];
  readonly scopeTag?: string;
}

/**
 * The `.css` style edges of one compiled artifact module, in authored order —
 * or undefined when the module is not a shape this recovery adopts. Never
 * throws and never guesses: a module without the Part Program marker, without
 * a `.css` specifier, without an arrayed `static styles`, or with a sheet
 * import no class arrays is left entirely to the graph's normal channels,
 * exactly as before this recovery existed. Adoption is all-or-nothing per
 * module, so it can never turn a working module into a fail-closed intercept
 * while half its edges stay unregistered.
 *
 * The read tolerates both artifact forms the pack pipeline produces: the
 * compiler's raw emission (TypeScript syntax, e.g. a `type`-annotated styles
 * member) and the packed module (types stripped by the packer). The AST parse
 * is ScriptKind.TSX for exactly that reason — a diagnostics gate on the file
 * extension would refuse the raw form and silently drop its edges.
 */
export function compiledArtifactStyleRequests(
  source: string,
  fileName: string,
): readonly string[] | undefined {
  return readCompiledArtifactStyles(source, fileName)?.requests;
}

/**
 * The same recovery, read once for both facts an artifact states: its edges
 * and its root scope (alpha15 S lane, S-C1.2). The scope comes from the
 * module's own Part Program literal — the emitter writes it verbatim, so the
 * packed form needs no second source of truth and no assumption about which
 * root kind a shipped package used.
 */
export function readCompiledArtifactStyles(
  source: string,
  fileName: string,
): CompiledArtifactStyleRead | undefined {
  if (!source.includes(COMPILED_ARTIFACT_MARKER)) return undefined;
  if (!CSS_SPECIFIER_HINT.test(source)) return undefined;
  const { sourceFile: sf } = typescriptParser.parseModule(source, fileName);
  const sheetBindings = collectSheetBindings(sf);
  if (sheetBindings.size === 0) return undefined;

  const edges: string[] = [];
  const claimed = new Set<string>();
  const claim = (element: ts.Expression): boolean => {
    if (!ts.isIdentifier(element)) return false;
    const specifier = sheetBindings.get(element.text);
    if (specifier === undefined) return true;
    if (!claimed.has(specifier)) {
      claimed.add(specifier);
      edges.push(specifier);
    }
    return true;
  };
  let shapeFollowed = true;
  let program: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    // The emitted Part Program literal (`const __partProgram = {...}`): the
    // one place the artifact states its own tag and root kind.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === PART_PROGRAM_BINDING &&
      node.initializer !== undefined
    ) {
      program = node.initializer;
    }
    // The compiler's emission declares the class as a class EXPRESSION bound
    // to a `var` (`var OpenButton = class extends OpenElement {...}`), so both
    // class forms carry the `static styles` member this read follows.
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        if (!ts.isIdentifier(member.name) || member.name.text !== STYLES_MEMBER_NAME) continue;
        const modifiers = ts.getModifiers(member) ?? [];
        if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
        const initializer = member.initializer;
        if (initializer === undefined) continue;
        let expression = initializer;
        while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
          expression = expression.expression;
        }
        if (!ts.isArrayLiteralExpression(expression)) {
          // A `static styles` this read cannot follow makes the module's edge
          // set unknowable — adopt nothing rather than a partial set.
          if (sheetBindings.size > 0) shapeFollowed = false;
          continue;
        }
        for (const element of expression.elements) {
          if (ts.isSpreadElement(element) || !claim(element)) {
            shapeFollowed = false;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Every collected sheet import must have been claimed by a `static styles`
  // array — the ONE style authoring grammar (style-imports.ts). An unclaimed
  // sheet import means the module is not this grammar's shape, and a partial
  // adoption would leave the intercept to fail closed on the remaining edge.
  if (!shapeFollowed || claimed.size !== sheetBindings.size) return undefined;
  if (edges.length === 0) return undefined;
  const scopeTag = programScopeTag(program);
  return scopeTag === undefined ? { requests: edges } : { requests: edges, scopeTag };
}

/** The Part Program's module-local binding, as the emitter writes it. */
const PART_PROGRAM_BINDING = '__partProgram';

/**
 * The light-root scope tag inside an artifact's Part Program literal. Only a
 * statically visible `tag` string with `root.kind === "light"` counts; every
 * other shape (a computed literal, a shadow root, a missing field) reads as
 * "no scope", which is the shadow-root default.
 */
function programScopeTag(program: ts.Expression | undefined): string | undefined {
  if (program === undefined) return undefined;
  let expression = program;
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
    expression = expression.expression;
  }
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  const tag = propertyOf(expression, 'tag');
  const root = propertyOf(expression, 'root');
  if (tag === undefined || !ts.isStringLiteral(tag) || tag.text === '') return undefined;
  if (root === undefined || !ts.isObjectLiteralExpression(root)) return undefined;
  const kind = propertyOf(root, 'kind');
  if (kind === undefined || !ts.isStringLiteral(kind) || kind.text !== 'light') return undefined;
  return tag.text;
}

/** One property's initializer of an object literal, or undefined. */
function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (ts.isIdentifier(property.name) && property.name.text === name) return property.initializer;
    if (ts.isStringLiteral(property.name) && property.name.text === name)
      return property.initializer;
  }
  return undefined;
}
