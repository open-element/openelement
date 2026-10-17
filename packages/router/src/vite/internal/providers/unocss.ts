/**
 * The UnoCSS style provider (alpha15 stage 2B).
 *
 * WHAT THIS ADAPTER IS. UnoCSS is a real third-party engine, reached through
 * its own public API: `createGenerator` from `unocss`, `loadConfig` from
 * `@unocss/config` (the same loader the official CLI and Vite plugin use), the
 * official `presetWind4` for the `tailwind4` dialect, and the generator's own
 * `applyExtractors` for source scanning. This module writes no utility grammar,
 * mocks no compiler and hardcodes no CSS: every rule in an emitted sheet was
 * produced by UnoCSS from a token the framework handed it, or by the resolved
 * preset's own theme/preflight layers.
 *
 * THE TWO SHEETS.
 *
 * - COMPONENT sheet — `generate(candidates, { preflights: false })`: the
 *   utilities a shadow root's admitted class tokens need. No preflight: a
 *   reset inside a component's own shadow tree would change every existing
 *   component's rendering. The theme VARIABLES a shadow tree consumes are the
 *   document sheet's (`:root, :host`), and custom properties inherit across
 *   the shadow boundary — one theme source for the whole document, exactly
 *   like the application's own tokens.
 *
 * - DOCUMENT sheet — the resolved config's preflight layers (properties +
 *   theme, plus the base reset when the plan says the document belongs to the
 *   application) followed by the utilities compiled from the admitted
 *   candidates AND the tokens the generator's own extractors find in the
 *   module texts the framework walked. That division is the port's whole
 *   point: the framework traverses its graph and delivers the bytes; UnoCSS
 *   decides what a token means.
 *
 * RESET POLICY. `documentReset` is the one fact the application owns
 * (`ResolvedStylePlan.documentReset`). When the framework installs its default
 * preset — which it does exactly when the project carries no `uno.config.ts`
 * — that policy rides the preset's own `preflights.reset` option. When the
 * project DOES carry a configuration, its presets are the application's own
 * and its reset choice is the application's (`uno.config.ts` is where an
 * UnoCSS application states its preflight policy); the automatic-mode
 * guarantee still holds because automatic mode by definition has no
 * application declaration and therefore no application preset set.
 *
 * THEME SOURCES. Declared `theme` sources are plain CSS and are included with
 * their own meaning intact: an UnoCSS sheet is real CSS by the time it exists,
 * so a token/role file (Open Props, a package's `:root` block) needs no
 * engine-specific transform — this is what makes the theme source independent
 * of the utility generator. What the source cannot carry verbatim is resolved,
 * never transformed: its `@import`s are inlined (every occurrence, conditions
 * intact) and its relative `url()` targets are rebased onto the sheet's
 * compile base so the referenced files are emitted beside it. A source that
 * carries Tailwind's `@theme` at-rule is the one shape this adapter cannot
 * honour (nothing would compile it and the roles would be silently absent), so
 * it fails closed and names both supported shapes.
 *
 * FAILURE POSTURE. Failures keep their codes: a missing peer, an unloadable
 * configuration, a declared source that cannot be resolved, a `@theme` source
 * this adapter cannot compile, and a document sheet that compiles to nothing at
 * all. A COMPONENT sheet that compiles to nothing is not in that list — a
 * zero-match compile is the engine's answer for an application's own native-CSS
 * hooks, and it is delivered as the empty sheet it is.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import { PresetErrorCode, buildError } from '../../../internal/error-codes.ts';
import type { StyleSheetCompileInput, StyleProvider } from '../style-provider.ts';
import type { ResolvedStyleSelection } from '../style-plan.ts';
import { generatedSheetBase } from '../generated-sheets.ts';

/**
 * The CSS parser and the value parser. Both are CommonJS packages resolved
 * from THIS package's own dependency tree (the same seam the peers below use),
 * and both are real parsers: the document grammar (at-rules, declarations,
 * comments, strings, escapes) belongs to postcss, and the grammar inside a
 * value (an `@import` prelude, a `url()` argument) belongs to
 * postcss-value-parser. Nothing in this module scans CSS text by hand.
 */
const requireFromHere = createRequire(import.meta.url);
const postcss = requireFromHere('postcss') as typeof import('postcss');
const parseValue = requireFromHere('postcss-value-parser') as typeof import('postcss-value-parser');

/** The postcss AST types this module walks, read off the parser's own surface. */
type CssRoot = ReturnType<typeof postcss.parse>;
type CssAtRule = ReturnType<typeof postcss.atRule>;
type CssChildNode = CssRoot['nodes'][number];

/** One node of a parsed CSS value, in the shape the value parser hands back. */
interface CssValueNode {
  readonly type: 'word' | 'string' | 'div' | 'space' | 'function' | 'comment' | 'unicode-range';
  value: string;
  quote?: string;
  /** The whitespace a separator or function wraps (`: x`, `( … )`). */
  before?: string;
  after?: string;
  nodes?: CssValueNode[];
}

/** The generator surface this adapter consumes (the official public shape). */
interface UnoGeneratorLike {
  applyExtractors(code: string, id?: string): Promise<Set<string>>;
  generate(
    tokens: Iterable<string>,
    options: { preflights: boolean },
  ): Promise<{ css: string; matched: Set<string> }>;
}

/** The resolved-config loader's contract (the official `@unocss/config`). */
interface UnoConfigModule {
  /**
   * `sources` is the set of files the configuration was read from, and it is
   * what the engine's own dev plugin watches (`@unocss/vite`'s
   * `ConfigHMRPlugin`). The installed versions hand these back as plain paths
   * — `unconfig`, which `@unocss/config` delegates to, returns `string[]` —
   * while the loader's public type describes `{ filepath }` records. Both
   * shapes are accepted here because only the running version knows which it
   * is, and reading the wrong one silently yields an empty watch list.
   */
  loadConfig(
    cwd: string,
    configOrPath?: string,
    extraConfigSources?: unknown[],
  ): Promise<{
    config: Record<string, unknown>;
    sources: Array<string | { filepath?: string }>;
  }>;
}

/** The `unocss` package's public surface, as this adapter uses it. */
interface UnocssModule {
  createGenerator(config: Record<string, unknown>): Promise<UnoGeneratorLike>;
  presetWind4(options?: Record<string, unknown>): unknown;
}

/** One compiled UnoCSS sheet plus the files whose change would move it. */
interface UnoCompile {
  readonly generator: UnoGeneratorLike;
  readonly watchFiles: readonly string[];
  /**
   * The document sheet's static head: the declared CSS sources. Read per
   * compile (never cached at construction) so a dev edit to a token file
   * moves the served sheet.
   */
  readonly documentPrefix: () => string;
}

/** The `@theme` at-rule Tailwind compiles; UnoCSS has no such transform. */
const TAILWIND_THEME_AT_RULE = '@theme';

/**
 * Load the `unocss` package from the APPLICATION's own resolution — never from
 * the router's tree, so a packed consumer's declared dependency is what runs.
 * Fails closed with the entry seam's coded error when the peer is missing.
 */
function resolveUnocssEntry(root: string): string {
  try {
    return createRequire(join(root, 'package.json')).resolve('unocss');
  } catch (cause) {
    throw buildError(
      PresetErrorCode.UNOCSS_UNRESOLVABLE,
      '[unocss] the unocss option is enabled but the `unocss` package is not resolvable from ' +
        `the project root (${root}). Install it in the application: \`unocss\` is an optional ` +
        'peer of @openelement/router.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
}

async function loadUnocss(root: string): Promise<UnocssModule> {
  return (await import(pathToFileURL(resolveUnocssEntry(root)).href)) as UnocssModule;
}

/** Load the official configuration loader from the peer's own dependency tree. */
async function loadConfigModule(unocssEntry: string): Promise<UnoConfigModule> {
  const require = createRequire(unocssEntry);
  let entry: string;
  try {
    entry = require.resolve('@unocss/config');
  } catch (cause) {
    throw buildError(
      PresetErrorCode.UNOCSS_CONFIG_UNLOADABLE,
      '[unocss] the installed `unocss` package carries no resolvable config loader ' +
        '(@unocss/config), so the project configuration cannot be read.',
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  return (await import(pathToFileURL(entry).href)) as UnoConfigModule;
}

/** Resolve one declared `unocss.config` path against the application root. */
function resolveDeclaredConfigPath(root: string, declared: string): string {
  const file = isAbsolute(declared) ? declared : resolve(root, declared);
  if (!existsSync(file)) {
    throw buildError(
      PresetErrorCode.UNOCSS_CONFIG_UNRESOLVED,
      `[unocss] the declaration names the configuration "${declared}", but the project does ` +
        `not carry it (resolved: ${file}). Correct the path, or omit \`config\` to let UnoCSS ` +
        'search for its conventional file names (uno.config.ts and friends) from the project root.',
    );
  }
  return file;
}

/**
 * Include one declared theme source, resolving the two things that cannot
 * travel verbatim: its `@import`s and its relative `url()` targets.
 *
 * IMPORTS. A token file composes other token files (`@import
 * 'open-props/style'`, `@import './colors.css'`), and the browser cannot
 * resolve a bare specifier — so each import is resolved through the platform
 * resolver (bare specifiers from the app root, relative ones against their
 * importer) and inlined depth-first, in the order the file states them. This
 * is a resolution step, not a CSS transform: nothing inside the imported text
 * is rewritten except the two facts below.
 *
 * The document grammar is read by postcss, so the shapes a text scan cannot
 * tell apart are distinct nodes here: a comment is a comment, a declaration's
 * string value is a value, and an at-rule is an at-rule. `@import './x.css'`
 * spelled inside a `content:` string is data; `@theme` spelled inside a
 * comment is prose; neither is syntax, and neither is processed. (The first
 * resolver matched `@import` with a regular expression over blanked text and
 * rewrote a string's content into resolved CSS — the failure a real parser
 * makes unreachable.)
 *
 * EVERY OCCURRENCE. Per CSS Cascade 5's import processing, every `@import`
 * OCCURRENCE participates independently: the sheet is constructed once per
 * occurrence, at its own position, under its own conditions. The same file
 * imported into two layers lands in both — so a repeat is inlined again, and
 * only the read is shared (the byte cache below). The one termination the
 * spec's model never reaches is a cycle, a file reached while its own chain is
 * still reading it; that chain is cut, and the cut is recorded in the sheet.
 * The first resolver conflated the two facts and deduplicated by file, which
 * left `@import './child.css' layer(b)` after `layer(a)` delivering an empty
 * layer — not what the source says.
 *
 * CONDITIONS. An `@import` prelude is `@import <url> [layer |
 * layer(name)]? [supports(cond)]? <media-query-list>? ;` and its conditions
 * are part of its meaning: the child's rules are inlined wrapped in the
 * at-rules those conditions denote — `layer` outermost, then `supports`, then
 * `media`, the nesting CSS Cascade defines. Matching only the bare form (as
 * this resolver first did) left `@import './child.css' layer(tokens)`
 * untouched: the child's tokens never reached the sheet at all.
 *
 * URL TARGETS. A theme source that paints with a file next to itself
 * (`url('./swatch.svg')`) states that file relative to ITS OWN directory, but
 * the sheet it is inlined into is delivered from the framework's compile base
 * (`{@linkcode generatedSheetBase}` in build, the same `/.openElement/` URL
 * namespace in dev) — a target left as written would be a request nothing
 * answers. Every relative target that names a file on disk is therefore
 * rebased onto the compile base, where the shared generated-sheet emitter
 * emits the referenced bytes as a real asset of the build and resolves the
 * reference to that asset's URL. Data URLs, fragments, root-absolute and
 * scheme targets are not this rebase's to move; a relative target that names
 * no file is left exactly as written rather than invented.
 *
 * The one shape this adapter cannot honour is Tailwind's `@theme` at-rule
 * (nothing here compiles it, so the roles it declares would be silently
 * absent), and it fails closed naming both supported shapes.
 */
function readThemeSource(
  root: string,
  source: string,
  state: InlineState = newInlineState(),
): string {
  return inlineThemeFile(root, resolveThemeSource(root, source), source, state).toString();
}

/**
 * The two walk facts: which files the current chain is still reading (the
 * cycle guard), and the bytes already read (shared between import occurrences
 * — the read may be reused, the semantics may not be dropped).
 */
interface InlineState {
  /** Files on the current chain — a second visit is a cycle. */
  readonly active: Set<string>;
  /** Files whose bytes were read — a repeat re-parses, never re-reads. */
  readonly cache: Map<string, string>;
}

function newInlineState(): InlineState {
  return { active: new Set(), cache: new Map() };
}

/**
 * Parse one theme file into a processed tree: imports inlined, url targets
 * rebased, `@theme` refused. Returns the tree so an import site can splice the
 * child's nodes under its own conditions; the walk's entry point stringifies.
 */
function inlineThemeFile(root: string, file: string, source: string, state: InlineState): CssRoot {
  // A cycle is a file reached while it is still being read; a repeat is one
  // reached again from a finished branch. Only the first stops here, and it is
  // recorded in the sheet rather than followed forever.
  if (state.active.has(file)) {
    const cut = postcss.root();
    cut.append(
      postcss.comment({
        text: `circular @import skipped: ${source}`,
        // The stringifier renders raws.left/right around the text; the
        // padding lives there, not in the text, or it doubles.
        raws: { left: ' ', right: ' ' },
      }),
    );
    return cut as CssRoot;
  }
  state.active.add(file);
  try {
    let text = state.cache.get(file);
    if (text === undefined) {
      text = readFileSync(file, 'utf8');
      state.cache.set(file, text);
    }
    let tree: CssRoot;
    try {
      tree = postcss.parse(text, { from: file }) as CssRoot;
    } catch (cause) {
      throw buildError(
        PresetErrorCode.UNOCSS_THEME_SOURCE_INCOMPATIBLE,
        `[unocss] the declared style source "${source}" is not parseable CSS ` +
          `(${cause instanceof Error ? cause.message : String(cause)}). Theme sources are ` +
          'inlined through a real CSS parser, so a file it cannot parse cannot reach the sheet.',
        { cause: cause instanceof Error ? cause : undefined },
      );
    }
    // Tailwind's `@theme` is an AT-RULE. A real `@theme { … }` block anywhere
    // in the source is the one shape this adapter cannot honour, and it fails
    // closed; a comment and a string value are different node types, and a
    // real parser never confuses them.
    tree.walkAtRules((node) => {
      if (node.name.toLowerCase() !== 'theme') return;
      throw buildThemeSourceIncompatible(source);
    });
    // Root-level `@import` at-rules, in document order; each occurrence is
    // replaced in place by its resolution (a comment naming it, then the
    // child's rules under the prelude's conditions).
    for (const node of [...tree.nodes]) {
      if (node.type !== 'atrule' || node.name.toLowerCase() !== 'import') continue;
      inlineImportAtRule(root, node as CssAtRule, file, state);
    }
    rebaseThemeUrls(tree, root, file);
    return tree;
  } finally {
    state.active.delete(file);
  }
}

/** The coded refusal for a source that carries Tailwind's `@theme` at-rule. */
function buildThemeSourceIncompatible(source: string) {
  return buildError(
    PresetErrorCode.UNOCSS_THEME_SOURCE_INCOMPATIBLE,
    `[unocss] the declared style source "${source}" carries Tailwind's ` +
      `\`${TAILWIND_THEME_AT_RULE}\` at-rule, which UnoCSS does not compile — the roles it ` +
      'declares would be silently absent from the document sheet. UnoCSS accepts (a) ' +
      'plain-CSS token files (`:root { --color-…: … }`, e.g. Open Props) as `theme` ' +
      'sources, and (b) the role table in `uno.config.ts`’s own `theme` key.',
  );
}

/**
 * Replace one `@import` at-rule with its resolution. The statement's
 * prelude is read by the value parser (strings, `url()` functions, escapes and
 * all); a prelude this reader cannot parse is left exactly as written — the
 * browser owns the diagnostic, and rewriting what was not understood is how
 * CSS gets corrupted.
 */
function inlineImportAtRule(
  root: string,
  atRule: CssAtRule,
  importer: string,
  state: InlineState,
): void {
  const prelude = parseValue(atRule.params) as unknown as { nodes: CssValueNode[] };
  const nodes = prelude.nodes;
  let index = 0;
  const nextMeaningful = (): CssValueNode | undefined => {
    while (index < nodes.length && nodes[index]!.type === 'space') index += 1;
    return nodes[index];
  };
  const specifier = readImportSpecifier(nextMeaningful());
  if (specifier === undefined || specifier === '') return;
  index += 1;
  // A scheme URL, a protocol-relative URL or a root-absolute URL is not this
  // device's to resolve: the browser owns it and it stays exactly as written.
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('//')) return;
  if (specifier.startsWith('/')) return;
  const conditions = readImportConditions(nodes, index);
  const resolved = resolveThemeSource(root, specifier, dirname(importer));
  const child = inlineThemeFile(root, resolved, specifier, state);
  // The child's rules, wrapped in the at-rules the conditions denote (layer
  // outermost, then supports, then media — the nesting CSS Cascade defines),
  // replace the import statement; a comment records what was resolved, so the
  // sheet's own text shows the resolution instead of a live statement.
  let payload: CssChildNode[] = child.nodes.map((node) => node.clone());
  if (conditions.media !== undefined) {
    const media = postcss.atRule({ name: 'media', params: conditions.media });
    media.append(payload);
    payload = [media as CssChildNode];
  }
  if (conditions.supports !== undefined) {
    const supports = postcss.atRule({ name: 'supports', params: `(${conditions.supports})` });
    supports.append(payload);
    payload = [supports as CssChildNode];
  }
  if (conditions.layer !== undefined) {
    const layer = postcss.atRule({
      name: 'layer',
      params: conditions.layer === true ? '' : conditions.layer,
    });
    layer.append(payload);
    payload = [layer as CssChildNode];
  }
  const provenance = postcss.comment({
    text: `@import '${specifier}'`,
    // The stringifier renders raws.left/right around the text; the padding
    // lives there, not in the text, or it doubles.
    raws: { left: ' ', right: ' ' },
  });
  provenance.raws.before = atRule.raws.before;
  if (payload.length > 0) payload[0]!.raws.before = '\n';
  atRule.replaceWith(provenance, ...payload);
}

/** The URL or string of an `@import` prelude's first meaningful node. */
function readImportSpecifier(node: CssValueNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === 'string') return node.value;
  if (node.type === 'function' && node.value.toLowerCase() === 'url') {
    const inner = (node.nodes ?? []).filter((item) => item.type !== 'space');
    if (inner.length === 1 && (inner[0]!.type === 'string' || inner[0]!.type === 'word')) {
      return inner[0]!.value;
    }
  }
  return undefined;
}

/** The conditions one `@import` prelude carries, in the order it carries them. */
interface ImportConditions {
  /** `layer` (the anonymous form) or `layer(name)`. */
  readonly layer?: string | true;
  /** The `supports(...)` condition, without the parentheses that wrapped it. */
  readonly supports?: string;
  /** Whatever followed: a media query list. */
  readonly media?: string;
}

/**
 * Read an `@import` prelude's conditions off the parsed value: `layer` (word
 * or function) first, then `supports(...)`, then whatever follows as the media
 * query list. Nodes the grammar does not place land in `media` and are carried
 * through verbatim rather than dropped.
 */
function readImportConditions(nodes: CssValueNode[], from: number): ImportConditions {
  const conditions: { layer?: string | true; supports?: string; media?: string } = {};
  let index = from;
  const meaningful = (): CssValueNode | undefined => {
    while (index < nodes.length && nodes[index]!.type === 'space') index += 1;
    return nodes[index];
  };
  let node = meaningful();
  if (node?.type === 'word' && node.value.toLowerCase() === 'layer') {
    conditions.layer = true;
    index += 1;
    node = meaningful();
  } else if (node?.type === 'function' && node.value.toLowerCase() === 'layer') {
    const name = serializeCssValue(node.nodes ?? []).trim();
    conditions.layer = name === '' ? true : name;
    index += 1;
    node = meaningful();
  }
  if (node?.type === 'function' && node.value.toLowerCase() === 'supports') {
    conditions.supports = serializeCssValue(node.nodes ?? []).trim();
    index += 1;
  }
  const media = serializeCssValue(nodes.slice(index)).trim();
  if (media !== '') conditions.media = media;
  return conditions;
}

/**
 * Serialize parsed value nodes back to CSS text. The parser preserved the
 * source's whitespace and quoting as nodes (a separator keeps the spaces
 * around it in `before`/`after`, a function the ones inside its parentheses),
 * so this is a walk of the AST, not a scan of text: words, strings,
 * separators, raw whitespace runs, and functions (named or the anonymous
 * `(...)` grouping) round-trip exactly.
 */
function serializeCssValue(nodes: readonly CssValueNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'word' || node.type === 'unicode-range') {
      out += node.value;
    } else if (node.type === 'div') {
      out += `${node.before ?? ''}${node.value}${node.after ?? ''}`;
    } else if (node.type === 'string') {
      out += `${node.quote ?? '"'}${node.value}${node.quote ?? '"'}`;
    } else if (node.type === 'comment') {
      out += `/*${node.value}*/`;
    } else if (node.type === 'function') {
      out += `${node.value}(${node.before ?? ''}${serializeCssValue(node.nodes ?? [])}${
        node.after ?? ''
      })`;
    } else {
      out += node.value;
    }
  }
  return out;
}

/**
 * Rebase every relative `url()` target of one theme file onto the sheet's
 * compile base. The target a source states is relative to ITS directory; the
 * inlined sheet is delivered from {@linkcode generatedSheetBase}. A target is
 * rebased only when the file it names exists — a relative target that names
 * nothing is left exactly as written, never invented into a different lie.
 */
function rebaseThemeUrls(tree: CssRoot, root: string, file: string): void {
  const urlBase = generatedSheetBase(root);
  tree.walkDecls((decl) => {
    const parsed = parseValue(decl.value) as unknown as { nodes: CssValueNode[] };
    let changed = false;
    for (const node of parsed.nodes) {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'url') continue;
      const inner = (node.nodes ?? []).filter((item) => item.type !== 'space');
      if (inner.length !== 1) continue;
      const item = inner[0]!;
      if (item.type !== 'string' && item.type !== 'word') continue;
      const target = item.value;
      if (!isRelativeUrlTarget(target)) continue;
      const { path, suffix } = splitUrlSuffix(target);
      const resolvedFile = resolve(dirname(file), path.replaceAll(/\\(.)/g, '$1'));
      if (!existsSync(resolvedFile)) continue;
      const rebased = relative(urlBase, resolvedFile);
      if (rebased === '') continue;
      const quote = item.type === 'string' && item.quote !== undefined ? item.quote : '"';
      node.nodes = [
        {
          type: 'string',
          value: escapeCssString(`${rebased}${suffix}`, quote),
          quote,
        },
      ];
      changed = true;
    }
    if (!changed) return;
    decl.value = serializeCssValue(parsed.nodes);
    // postcss prefers a declaration's raw value (raws.value.raw) over `value`
    // when serializing; the rewrite must be what reaches the sheet.
    delete decl.raws.value;
  });
}

/** True for a `url()` target a relative rebase owns (see the module doc). */
function isRelativeUrlTarget(target: string): boolean {
  return (
    target !== '' &&
    !target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.startsWith('data:') &&
    !target.startsWith('#') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

/** A target's path part and its trailing query/fragment, kept verbatim. */
function splitUrlSuffix(target: string): { path: string; suffix: string } {
  const cut = target.search(/[?#]/);
  return cut === -1
    ? { path: target, suffix: '' }
    : { path: target.slice(0, cut), suffix: target.slice(cut) };
}

/** Escape one path for the CSS string it is written into. */
function escapeCssString(value: string, quote: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
}

/**
 * Resolve one theme-source path: relative paths against their importer, bare
 * and absolute specifiers through the app root's own resolver (so a package
 * CSS subpath resolves by the package's declared `exports`, exactly as any
 * other import of it would).
 */
function resolveThemeSource(root: string, source: string, importer?: string): string {
  if (source.startsWith('.') || isAbsolute(source)) {
    const file = importer === undefined ? resolve(root, source) : resolve(importer, source);
    if (!existsSync(file)) {
      throw buildError(
        PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED,
        `[unocss] the declared style source "${source}" cannot be read (resolved: ${file}).`,
      );
    }
    return file;
  }
  try {
    return createRequire(join(root, 'package.json')).resolve(source);
  } catch {
    const file = resolve(root, source);
    if (existsSync(file)) return file;
    throw buildError(
      PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED,
      `[unocss] the declared style source "${source}" cannot be resolved from the project root ` +
        `${root} (neither a package subpath nor a file). Declare a shipped package CSS file or ` +
        'an app-relative path.',
    );
  }
}

/**
 * Build the resolved configuration for one plan: the project's own config when
 * it carries one (loaded through the official loader, including its
 * `sources` for the watch list), else the framework default.
 */
async function resolveUnoConfig(
  root: string,
  plan: ResolvedStyleSelection,
  declaredConfig: string | undefined,
): Promise<{
  config: Record<string, unknown>;
  watchFiles: string[];
  /** True when the framework's own default preset set was installed. */
  defaultPreset: boolean;
}> {
  // The peer's own resolution first: a missing engine is the coded
  // UNOCSS_UNRESOLVABLE diagnostic, never the resolver's raw MODULE_NOT_FOUND.
  const unocssEntry = resolveUnocssEntry(root);
  const { loadConfig } = await loadConfigModule(unocssEntry);
  const declared =
    declaredConfig === undefined ? undefined : resolveDeclaredConfigPath(root, declaredConfig);
  // A configuration file that exists but cannot be LOADED (a syntax error, a
  // throwing module) is the same coded class as one the generator rejects
  // (#1616): the recovery channels downstream report by code, so the loader's
  // raw failure is wrapped into the envelope dialect here.
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(root, declared);
  } catch (cause) {
    throw buildError(
      PresetErrorCode.UNOCSS_CONFIG_UNLOADABLE,
      `[unocss] the project UnoCSS configuration could not be loaded` +
        ` (${root}${declared === undefined ? '' : `, config: ${declared}`}).`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  const watchFiles = loaded.sources
    .map((source) => (typeof source === 'string' ? source : source.filepath))
    .filter((file): file is string => typeof file === 'string' && file !== '');
  const ownPresets = Array.isArray(loaded.config.presets) && loaded.config.presets.length > 0;
  if (ownPresets) return { config: loaded.config, watchFiles, defaultPreset: false };
  const unocss = await loadUnocss(root);
  return {
    config: { ...loaded.config, presets: [unocss.presetWind4()] },
    watchFiles,
    defaultPreset: true,
  };
}

/**
 * The generator for one compile, with the framework's ONE policy decision
 * applied where that decision lives for this engine: the default preset's
 * `preflights.reset`, which is the plan's `documentReset`.
 */
async function buildGenerator(
  root: string,
  plan: ResolvedStyleSelection,
  declaredConfig: string | undefined,
): Promise<UnoCompile> {
  const { config, watchFiles, defaultPreset } = await resolveUnoConfig(root, plan, declaredConfig);
  const unocss = await loadUnocss(root);
  const resolved = defaultPreset
    ? {
        ...config,
        presets: [unocss.presetWind4({ preflights: { reset: plan.documentReset } })],
      }
    : config;
  let generator: UnoGeneratorLike;
  try {
    generator = await unocss.createGenerator(resolved);
  } catch (cause) {
    throw buildError(
      PresetErrorCode.UNOCSS_CONFIG_UNLOADABLE,
      '[unocss] the resolved UnoCSS configuration was rejected by the generator ' +
        `(${root}${declaredConfig === undefined ? '' : `, config: ${declaredConfig}`}).`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  const documentPrefix = (): string => {
    // One walk state across the declared sources: the byte cache is shared (a
    // file two sources import is read once), and each source is its own root —
    // its chain is fully unwound before the next begins, so the cycle guard
    // stays per-chain.
    const state = newInlineState();
    return plan.theme
      .map(
        (source) =>
          `/* declared style source: ${source} */\n${readThemeSource(root, source, state)}`,
      )
      .join('\n');
  };
  return { generator, watchFiles, documentPrefix };
}

/**
 * The document sheet's emptiness guard.
 *
 * A COMPONENT sheet may legitimately be empty: the engine compiled the
 * candidate set successfully and matched nothing, which is exactly what an
 * application's own native-CSS hooks are — a class it styles itself is not a
 * utility request. Reading the candidate count as evidence that a rule must
 * exist turned that answer into a false failure, so the guard lives only where
 * the engine is expected to produce a layer unconditionally.
 *
 * The document sheet carries the resolved preset's preflight layers (theme
 * variables, `@property` declarations, and the base reset when the application
 * owns the document), so an enabled pipeline that produces nothing at all has
 * produced no theme either — that is a defect of the adapter, never silence.
 */
function assertDocumentCompiled(css: string): string {
  if (css.trim() !== '') return css;
  throw buildError(
    PresetErrorCode.UNOCSS_EMPTY_COMPILE,
    '[unocss] the document sheet compiled to no CSS. An enabled entry always carries the ' +
      'resolved preset’s preflight layers (theme variables at minimum), so an empty compile ' +
      'is a defect of the adapter, never a silently unstyled document.',
  );
}

/**
 * Create the UnoCSS adapter for one build or dev server. Constructing it
 * loads the peer and the project configuration, so the caller constructs it
 * exactly when the plan selected UnoCSS.
 */
export async function createUnocssProvider(
  root: string,
  plan: ResolvedStyleSelection,
  declaredConfig: string | undefined,
): Promise<StyleProvider> {
  const compile = await buildGenerator(root, plan, declaredConfig);
  const { generator, watchFiles, documentPrefix } = compile;

  /** Tokens from the module texts the framework walked, via UnoCSS's extractors. */
  const extractFromSources = async (
    sources: StyleSheetCompileInput['sources'],
  ): Promise<string[]> => {
    const tokens = new Set<string>();
    for (const [id, code] of sources) {
      // The provider's OWN extractor: the framework never tokenizes source.
      for (const token of await generator.applyExtractors(code, id)) tokens.add(token);
    }
    return [...tokens];
  };

  return {
    id: 'unocss',
    dialects: ['tailwind4'],
    documentDelivery: 'generated',
    componentSheetSpecifier: 'virtual:open-unocss-components',
    documentSheetModule: 'virtual:open-unocss-document',
    watchFiles,

    async compileComponents({ candidates }) {
      // A zero-match compile is an answer, not a failure: the engine compiled
      // every admitted candidate and none of them is a utility the application
      // asked the engine to produce. An empty sheet is the delivery for it.
      if (candidates.length === 0) return '';
      const { css } = await generator.generate(candidates, { preflights: false });
      return css;
    },

    async compileDocument({ candidates, sources }) {
      const extracted = await extractFromSources(sources);
      const tokens = [...new Set([...candidates, ...extracted])];
      const { css } = await generator.generate(tokens, { preflights: true });
      // The preflight layers (properties + theme, and the base reset when the
      // application owns the document) exist even with no token at all: an
      // enabled pipeline with zero matched utilities still ships the theme the
      // declared roles live in.
      const sheet = [documentPrefix(), css].filter((part) => part.trim() !== '').join('\n');
      return assertDocumentCompiled(sheet);
    },
  };
}
