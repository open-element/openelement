/**
 * Build-time generator for the @openelement/ui package manifest.
 *
 * Scans `src/open-*.tsx`, parses component metadata, and writes a
 * static JSON file to `src/generated-manifest.json`. This keeps
 * runtime-free packages free of Deno.readDirSync/Deno.readFileSync.
 *
 * Usage:
 *   node tools/generate-ui-manifest.ts
 *     -> (re)write the manifest.
 *   node tools/generate-ui-manifest.ts --check
 *     -> regenerate in memory and fail (exit 1) when the tracked manifest is
 *        missing or stale. Wired into `gate:release` as ui-manifest:check.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from '@openelement/element';
import ts from 'typescript';
import { formatJson } from '@openelement/element/build-utils';
import { parseTypeScript } from '../../../tools/lib/typescript-ast.ts';
import {
  formatGeneratedElementRefusals,
  readGeneratedElementFacts,
  type GeneratedElementFacts,
} from './generated-element-facts.ts';

const UI_SRC_DIR = new URL('../src/', import.meta.url);
const UI_PACKAGE_JSON = new URL('../package.json', import.meta.url);
const OUT_FILE = new URL('../src/generated-manifest.json', import.meta.url);

const pkg = JSON.parse(readFileSync(UI_PACKAGE_JSON, 'utf8')) as {
  version: string;
  exports?: Record<string, unknown>;
};
const pkgVersion = pkg.version;

/**
 * The host site fact for one function-component module: the tag the island
 * pipeline will register. The compiler lane never derives a tag, and neither
 * does this tool — the resolver is the caller's host fact, exactly as
 * `GeneratedElementSite.tag` is for the compiler.
 */
export type GeneratedElementTagResolver = (file: string) => string | null;

/**
 * The live tag source for the shipped `src/` scan: the package's own `exports`
 * map. A published subpath `./open-<name>` whose target is
 * `./src/open-<name>.tsx` is the identity consumers import, and the same string
 * `buildClassDeclaration` already derives as `openElement.module`. A module
 * outside that contract gets no site fact and keeps the fail-loud skip.
 */
export function publishedGeneratedElementSites(): ReadonlyMap<string, string> {
  const sites = new Map<string, string>();
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target !== 'string' || !subpath.startsWith('./open-')) continue;
    const tag = subpath.slice(2);
    if (target !== `./src/${tag}.tsx`) continue;
    sites.set(`${tag}.tsx`, tag);
  }
  return sites;
}

/**
 * One component's delivery and stability policy, keyed by the PUBLISHED TAG.
 *
 * The tag is the public identity that survives the class->function migration,
 * so one row covers a component on either lane and a migration never needs a
 * second registry or a policy rename.
 */
export interface ComponentPolicy {
  readonly layer: 'dsd-static' | 'dsd-interactive';
  // Hand-aligned with HYDRATION_STRATEGIES in
  // packages/protocol/src/framework.ts (source of truth);
  // tools cannot import element runtime code.
  readonly hydrate: 'load' | 'idle' | 'visible' | 'only';
  // Owner ruling C1 (#1468): the unadopted surface is experimental until each
  // component has standalone adoption evidence; flipping to 'stable' is a
  // deliberate per-component decision, never a sweep.
  readonly status: 'stable' | 'experimental';
  readonly ssr: boolean;
  readonly dsd: boolean;
}

/**
 * Fail-loud registry: every published @openelement/ui component tag must have
 * an explicit policy here. An unlisted tag means a new component shipped
 * without a layering, stability or SSR/DSD decision — throw instead of
 * silently defaulting.
 */
const POLICY_BY_TAG: Readonly<Record<string, ComponentPolicy>> = {
  'open-button': {
    layer: 'dsd-interactive',
    hydrate: 'load',
    status: 'stable',
    ssr: true,
    dsd: true,
  },
  'open-input': {
    layer: 'dsd-interactive',
    hydrate: 'load',
    status: 'experimental',
    ssr: true,
    dsd: true,
  },
  'open-theme-toggle': {
    layer: 'dsd-interactive',
    hydrate: 'load',
    status: 'stable',
    ssr: true,
    dsd: true,
  },
  'open-code-block': {
    layer: 'dsd-static',
    hydrate: 'idle',
    status: 'stable',
    ssr: true,
    dsd: true,
  },
  'open-dialog': {
    layer: 'dsd-interactive',
    hydrate: 'idle',
    status: 'experimental',
    ssr: true,
    dsd: true,
  },
  'open-dropdown': {
    layer: 'dsd-interactive',
    hydrate: 'load',
    status: 'experimental',
    ssr: true,
    dsd: true,
  },
};

/** The ONE policy lookup, shared by both component lanes. */
export function componentPolicy(tag: string): ComponentPolicy {
  const policy = POLICY_BY_TAG[tag];
  if (policy === undefined) {
    throw new Error(
      `No layer/hydrate/status/ssr/dsd policy for component '${tag}': ` +
        'add it to POLICY_BY_TAG in tools/generate-ui-manifest.ts',
    );
  }
  return policy;
}

interface ClassComponentMeta {
  readonly origin: 'class';
  file: string;
  tagName: string;
  className: string;
  description: string;
  attributes: OpenElementAttribute[];
  events: OpenElementEvent[];
  slots: OpenElementSlot[];
  cssParts: OpenElementCssPart[];
  readonly policy: ComponentPolicy;
}

/**
 * A function-component module the compiler lane emitted. The facts are the
 * emitted element's own (see `generated-element-facts.ts`); the policy row,
 * when the host supplies one, is UI package policy, not a compiler fact.
 */
interface GeneratedComponentMeta {
  readonly origin: 'generated-element';
  readonly file: string;
  readonly facts: GeneratedElementFacts;
  readonly events: OpenElementEvent[];
  readonly policy?: ComponentPolicy;
}

type ComponentMeta = ClassComponentMeta | GeneratedComponentMeta;

const COMPONENT_ORDER = [
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-dialog',
  'open-dropdown',
];

function inferAttributeType(name: string): string {
  if (name === 'disabled' || name === 'open' || name === 'required') {
    return 'boolean';
  }
  return 'string';
}

function parseObservedAttributes(text: string): { name: string; type: string }[] {
  // v0.44: compiled components declare attribute-backed properties with
  // @property(...) decorators; the observed set is the compiled property list.
  const source = parseTypeScript(text, 'component.tsx');
  const out: { name: string; type: string }[] = [];
  const kebab = (value: string): string => value.replace(/([A-Z])/g, '-$1').toLowerCase();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const decorators = ts.getDecorators(node) ?? [];
      for (const decorator of decorators) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || call.expression.getText(source) !== 'property') continue;
        const options = call.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)) continue;
        let attribute: string | null | undefined;
        let type = 'string';
        for (const entry of options.properties) {
          if (!ts.isPropertyAssignment(entry)) continue;
          const key = entry.name.getText(source);
          if (key === 'attribute') {
            if (entry.initializer.kind === ts.SyntaxKind.FalseKeyword) attribute = null;
            else if (ts.isStringLiteral(entry.initializer)) {
              attribute = kebab(entry.initializer.text);
            }
          }
          if (key === 'type') {
            const typeName = entry.initializer.getText(source);
            if (typeName === 'Boolean') type = 'boolean';
            else if (typeName === 'Number') type = 'number';
            else if (typeName === 'Array') type = 'array';
            else if (typeName === 'Object') type = 'object';
          }
        }
        if (attribute === null) continue;
        const attrName = attribute ?? kebab(node.name.text);
        const initializer = node.initializer?.getText(source) ?? '';
        const inferred =
          type !== 'string'
            ? type
            : initializer === 'true' || initializer === 'false'
              ? 'boolean'
              : inferAttributeType(attrName);
        out.push({ name: attrName, type: inferred });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function parseTagName(text: string): string {
  // v0.44: the compiled program owns the tag — read the @element decorator.
  const match = text.match(/@element\(\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('Could not find @element(...) decorator');
  return match[1];
}

function parseClassName(text: string, file: string): string {
  const match = text.match(/export\s+(?:default\s+)?class\s+(\w+)\s+extends\s+OpenElement/);
  if (!match) throw new Error(`Could not find exported class in ${file}`);
  return match[1];
}

export function parseCssParts(text: string): OpenElementCssPart[] {
  const parts: OpenElementCssPart[] = [];
  const seen = new Set<string>();
  const add = (name: string, description: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    parts.push({ name, description });
  };
  for (const m of text.matchAll(/\*\s*@csspart\s+(\S+)\s*-+(.*)/g)) {
    add(m[1].trim(), m[2].trim());
  }
  // Also scan JSX `part='...'` literals so parts without @csspart doc
  // comments (e.g. open-badge, open-callout) are not silently dropped.
  for (const m of text.matchAll(/\bpart=['"]([^'"]+)['"]/g)) {
    for (const name of m[1].trim().split(/\s+/)) {
      if (name) add(name, `The '${name}' part`);
    }
  }
  return parts;
}

export function parseSlots(text: string): OpenElementSlot[] {
  const slots: OpenElementSlot[] = [];
  const seen = new Set<string>();
  const add = (name: string, description: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    slots.push({ name, description });
  };
  for (const m of text.matchAll(/\*\s*@slot\s+(\S*)\s*-+(.*)/g)) {
    add(m[1].trim(), m[2].trim());
  }
  // Also scan JSX `<slot name='...'>` literals so named slots without @slot
  // doc comments (e.g. open-card header/footer, open-dialog trigger/footer)
  // are not silently dropped.
  for (const m of text.matchAll(/<slot\s+name=['"]([^'"]+)['"]/g)) {
    add(m[1].trim(), `The '${m[1].trim()}' slot`);
  }
  // Default slot: a <slot> tag without a name attribute. (A named slot such
  // as `<slot name='tab'>` must not imply a default slot.)
  if (/<slot(?![^>]*\bname\s*=)[^>]*>/.test(text)) {
    if (!seen.has('')) {
      slots.unshift({ name: '', description: 'Default slot' });
    }
  }
  return slots;
}

/**
 * Read the events a component DISPATCHES.
 *
 * Recognition is the inline `…dispatchEvent(new CustomEvent('name', { detail }))`
 * shape, on both lanes: a constructed event that is never dispatched is not an
 * event the component fires, so a helper that merely builds a `CustomEvent`
 * must not become a declaration. The detail type is inferred from the literal
 * options. A dispatch through a variable is outside the recognized shape (the
 * six shipped components all dispatch inline), and it is a source-side
 * heuristic, not a runtime claim.
 */
export function parseEvents(text: string): OpenElementEvent[] {
  const events: OpenElementEvent[] = [];
  const seen = new Set<string>();
  const source = parseTypeScript(text, 'component.tsx');
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'dispatchEvent'
    ) {
      const [eventNode] = node.arguments;
      if (
        eventNode !== undefined &&
        ts.isNewExpression(eventNode) &&
        ts.isIdentifier(eventNode.expression) &&
        eventNode.expression.text === 'CustomEvent'
      ) {
        const [nameNode, optionsNode] = eventNode.arguments ?? [];
        if (nameNode && ts.isStringLiteralLike(nameNode) && !seen.has(nameNode.text)) {
          const name = nameNode.text;
          seen.add(name);
          let detailType: string | undefined;
          if (optionsNode && ts.isObjectLiteralExpression(optionsNode)) {
            const detail = optionsNode.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) && property.name.getText(source) === 'detail',
            );
            if (detail && ts.isPropertyAssignment(detail)) {
              detailType = inferExpressionType(detail.initializer, source);
            }
          }
          events.push({
            name,
            type: detailType ? `CustomEvent<${detailType}>` : 'CustomEvent',
            description: `Fired on ${name}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return events;
}

function inferExpressionType(node: ts.Expression, source: ts.SourceFile): string {
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return 'boolean';
  }
  if (ts.isArrayLiteralExpression(node)) return 'unknown[]';
  if (ts.isObjectLiteralExpression(node)) {
    const fields = node.properties.flatMap((property) => {
      if (ts.isPropertyAssignment(property)) {
        return [
          `${property.name.getText(source)}: ${inferExpressionType(property.initializer, source)}`,
        ];
      }
      if (ts.isShorthandPropertyAssignment(property)) return [`${property.name.text}: unknown`];
      return [];
    });
    return `{ ${fields.join('; ')} }`;
  }
  return 'unknown';
}

function parseDescription(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('* @openelement/ui')) {
      // Collect the first prose paragraph, joining wrapped lines: component
      // docstrings wrap at ~80 cols, so the first *line* is usually a
      // sentence fragment (open-input/open-theme-toggle/open-button).
      const paragraph: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].replace(/^\s*\*\s?/, '').trim();
        if (!next) {
          if (paragraph.length) break;
          continue;
        }
        // Stop at the tag block (@csspart/@slot/...) or the comment end
        // without finding prose.
        if (next.startsWith('@') || next.startsWith('/')) break;
        paragraph.push(next);
      }
      const joined = paragraph.join(' ');
      // First *sentence*, not first line.
      const sentence = joined.match(/^(.+?[.!?])(\s|$)/);
      return sentence ? sentence[1] : joined;
    }
  }
  return '';
}

function buildMeta(file: string, source: string): ClassComponentMeta {
  const tagName = parseTagName(source);
  const policy = componentPolicy(tagName);
  const className = parseClassName(source, file);
  const observed = parseObservedAttributes(source);
  const attributes: OpenElementAttribute[] = observed.map(({ name, type }) => ({
    name,
    type,
    description: `${name} attribute`,
  }));

  for (const attr of attributes) {
    if (attr.type === 'boolean') {
      attr.default = 'false';
    }
  }

  return {
    origin: 'class',
    file,
    tagName,
    className,
    description: parseDescription(source),
    attributes,
    events: parseEvents(source),
    slots: parseSlots(source),
    cssParts: parseCssParts(source),
    policy,
  };
}

/**
 * Read the component declarations under `rootDir`.
 *
 * Dispatch is structural: a class-authored module keeps the existing class
 * branch untouched; a module the generated-element lane owns needs the two host
 * facts (the site tag and, for the shipped scan, the policy row) and is
 * projected only when the compiler lane actually emitted it. A module that passes the `open-*.tsx` naming convention
 * but reaches neither branch is NOT filtered out — it would disappear from the
 * manifest, from custom-elements.json, from the packed tarball and from the API
 * reference while `ui-manifest:check`, `ui-cem:check` and `gate:packed` all
 * stay green, because all three compare against a file this loop never wrote.
 * That is a silent capability loss, so the skip below refuses instead of
 * filtering: it names the files.
 */
export interface ComponentScanHost {
  /** The host site fact for function-component modules. */
  readonly site?: GeneratedElementTagResolver;
  /**
   * The policy source for function-component modules. Absent for fixture
   * roots, where a fixture tag carries no package policy.
   */
  readonly policy?: (tag: string) => ComponentPolicy;
}

function readComponentSources(
  rootDir: URL = UI_SRC_DIR,
  host: ComponentScanHost = {},
): ComponentMeta[] {
  const metas: ComponentMeta[] = [];
  const skipped: string[] = [];
  const refused: string[] = [];
  for (const entry of readdirSync(rootDir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || !entry.name.startsWith('open-') || !entry.name.endsWith('.tsx')) {
      continue;
    }
    const source = readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8');
    if (source.includes('extends OpenElement')) {
      metas.push(buildMeta(entry.name, source));
      continue;
    }
    const tag = host.site?.(entry.name) ?? null;
    if (tag === null) {
      skipped.push(entry.name);
      continue;
    }
    const read = readGeneratedElementFacts({ file: entry.name, source, tag });
    if (read.kind === 'admitted') {
      metas.push({
        origin: 'generated-element',
        file: entry.name,
        facts: read.facts,
        // Authored custom events stay a source-side fact on both lanes; the
        // emitted artifact carries no event table.
        events: parseEvents(source),
        ...(host.policy === undefined ? {} : { policy: host.policy(tag) }),
      });
      continue;
    }
    if (read.kind === 'refused') {
      refused.push(
        `open-*.tsx ${entry.name} was refused by the compiler generated-element lane:\n` +
          formatGeneratedElementRefusals(read.diagnostics),
      );
      continue;
    }
    skipped.push(entry.name);
  }
  if (refused.length > 0) {
    throw new Error(
      `${refused.join('\n\n')}\n\n` +
        'The file passes the component naming convention, so projecting no declaration would ' +
        'drop it from the manifest, the Custom Elements Manifest, the packed artifact and the ' +
        'API reference unnoticed.',
    );
  }
  if (skipped.length > 0) {
    throw new Error(
      `open-*.tsx files must declare \`export [default] class <Name> extends OpenElement\` ` +
        `or be admitted by the compiler generated-element lane: ${skipped.join(', ')} passed ` +
        'the naming convention but not either shape, so it would be dropped from the manifest, ' +
        'the Custom Elements Manifest, the packed artifact and the API reference unnoticed. ' +
        'Declare the component shape, or rename the file so it is not published. A ' +
        'function-component module needs a host-supplied generated-element site fact: under ' +
        '`src/` that is a published subpath `./open-<name>` whose target is ' +
        '`./src/open-<name>.tsx` in package.json exports (alpha16-18-execution-plan.md §17).',
    );
  }
  // The policy order is the published declaration order; the tag tie-break
  // keeps a root with several non-policy components (the test fixture roots)
  // deterministic instead of inheriting the filesystem's readdir order.
  const order = new Map(COMPONENT_ORDER.map((t, i) => [t, i]));
  const tagOf = (meta: ComponentMeta): string =>
    meta.origin === 'class' ? meta.tagName : meta.facts.tag;
  metas.sort((a, b) => {
    const byOrder = (order.get(tagOf(a)) ?? 999) - (order.get(tagOf(b)) ?? 999);
    return byOrder === 0 ? tagOf(a).localeCompare(tagOf(b)) : byOrder;
  });
  return metas;
}

/**
 * Project emitted-element facts into the internal manifest declaration.
 *
 * The declaration describes the EMITTED native class, which is what the lane
 * produced and shipped: `className`/`openElement.export` are the emitted
 * module's own named export. `superclassName` is deliberately absent — the
 * emitted class extends the non-public `OpenElementBase`, so there is no
 * truthful public superclass to name. `events` is absent because the function
 * lane has no authored custom-event surface; delivery policy is absent because
 * it is UI package policy, not a compiler fact (phase 1 adds no
 * `POLICY_BY_CLASS` entry).
 */
/**
 * The published delivery block: the ONE place a component's policy and its
 * package identity become `openElement`. Both lanes use it, so a class->function
 * migration cannot drop the Tailwind requirement, the SSR/DSD promise or the
 * stability row.
 *
 * ADR-0167: every component's internals author Tailwind utilities directly
 * (alpha15 S lane), so the compile is a REQUIREMENT of this package — the
 * component stylesheet is what carries the utilities into the shadow roots —
 * and the package owns the theme source that compile needs. A consumer that
 * admits this package declares NO Tailwind configuration and still gets styled
 * components; a consumer that disables the entry fails closed with a coded
 * diagnostic instead of shipping unstyled components.
 */
function openElementDelivery(
  policy: ComponentPolicy,
  module: string,
  exportName: string,
): NonNullable<OpenElementDeclaration['openElement']> {
  return {
    ssr: policy.ssr,
    dsd: policy.dsd,
    layer: policy.layer,
    hydrate: policy.hydrate,
    status: policy.status,
    module,
    export: exportName,
    tailwind: {
      required: true,
      sources: ['./src/theme.css'],
    },
  };
}

export interface GeneratedElementDeclarationOptions {
  /** Authored custom events parsed from the source (both lanes). */
  readonly events?: readonly OpenElementEvent[];
  /** The published policy row; absent for fixture roots with no package policy. */
  readonly policy?: ComponentPolicy;
}

/**
 * Project emitted-element facts into the internal manifest declaration.
 *
 * The declaration describes the EMITTED native class, which is what the lane
 * produced and shipped: `className`/`openElement.export` are the emitted
 * module's own named export. `superclassName` is deliberately absent — the
 * emitted class extends the non-public `OpenElementBase`, so there is no
 * truthful public superclass to name. Delivery policy and events are HOST
 * facts supplied by the caller (the shipped scan passes the package policy and
 * the source-parsed events; a fixture root passes neither), so the projection
 * stays a pure function of its inputs.
 */
export function buildGeneratedElementDeclaration(
  facts: GeneratedElementFacts,
  options: GeneratedElementDeclarationOptions = {},
): OpenElementDeclaration {
  return {
    tagName: facts.tag,
    className: facts.className,
    ...(facts.description === '' ? {} : { description: facts.description }),
    ...(facts.attributes.length ? { attributes: [...facts.attributes] } : {}),
    ...(options.events?.length ? { events: [...options.events] } : {}),
    ...(facts.slots.length ? { slots: [...facts.slots] } : {}),
    ...(facts.cssParts.length ? { cssParts: [...facts.cssParts] } : {}),
    openElement: {
      ...(options.policy === undefined
        ? { module: facts.module, export: facts.exportName }
        : openElementDelivery(options.policy, facts.module, facts.exportName)),
      // The host root and the authored sheets are facts of the emitted element,
      // not package policy: the consuming build registers the style declaration
      // from them without re-reading or re-compiling the package source.
      root: facts.root,
      ...(facts.styles.length === 0 ? {} : { styles: [...facts.styles] }),
    },
  };
}

function buildClassDeclaration(meta: ClassComponentMeta): OpenElementDeclaration {
  return {
    tagName: meta.tagName,
    className: meta.className,
    superclassName: 'OpenElement',
    description: meta.description,
    attributes: meta.attributes.length ? meta.attributes : undefined,
    events: meta.events.length ? meta.events : undefined,
    slots: meta.slots.length ? meta.slots : undefined,
    cssParts: meta.cssParts.length ? meta.cssParts : undefined,
    openElement: openElementDelivery(
      meta.policy,
      `@openelement/ui/${meta.file.replace(/\.tsx$/, '')}`,
      meta.className,
    ),
  };
}

function buildDeclaration(meta: ComponentMeta): OpenElementDeclaration {
  return meta.origin === 'generated-element'
    ? buildGeneratedElementDeclaration(meta.facts, {
        events: meta.events,
        ...(meta.policy === undefined ? {} : { policy: meta.policy }),
      })
    : buildClassDeclaration(meta);
}

export type GeneratedUiManifest = OpenElementPackageManifest & {
  /** JSON has no comment syntax; this is the generated-file header. */
  $comment: string;
};

/**
 * Build the manifest for one component root.
 *
 * `host` carries the two facts only a host can supply for function-component
 * modules: the site tag and the policy row. The shipped scan supplies both
 * (published `exports` subpaths + `POLICY_BY_TAG`); a fixture root supplies only
 * the site tags and no policy.
 */
export function buildManifestFromRoot(
  rootDir: URL,
  host: ComponentScanHost = {},
): GeneratedUiManifest {
  const metas = readComponentSources(rootDir, host);
  const declarations = metas.map(buildDeclaration);
  // No `modules` block (#797): it emitted CEM-style paths like
  // `./open-card.js` that do not exist in the published package (`src/**`),
  // and the only manifest consumer (island-scanner) reads `declarations`.

  return {
    $comment:
      'GENERATED FILE - do not edit. Regenerate with: pnpm --filter @openelement/ui run generate:ui-manifest (drift gate: ui-manifest:check).',
    schemaVersion: '1.0.0',
    packageName: '@openelement/ui',
    version: pkgVersion,
    description: 'Semantic Web Component library for openElement',
    author: 'openElement',
    license: 'MIT',
    homepage: 'https://openelement.org',
    repository: 'https://github.com/open-element/openelement',
    declarations,
  };
}

/** The published `src/open-*.tsx` -> tag facts, read once from `exports`. */
const PUBLISHED_SITES = publishedGeneratedElementSites();

/**
 * The shipped manifest: the published components under `src/`. The live scan
 * supplies the two host facts — the published tag and the policy row — so a
 * function-component module migrates into this manifest without a second
 * registry.
 */
export function buildManifest(): GeneratedUiManifest {
  return buildManifestFromRoot(UI_SRC_DIR, {
    site: (file) => PUBLISHED_SITES.get(file) ?? null,
    policy: componentPolicy,
  });
}

if (import.meta.main) {
  const manifest = buildManifest();
  const text = formatJson(manifest);
  const target = OUT_FILE.pathname;
  if (process.argv.slice(2).includes('--check')) {
    let existing: string;
    try {
      existing = await readFile(OUT_FILE, 'utf8');
    } catch {
      console.error(
        `${target} is missing; run pnpm --filter @openelement/ui run generate:ui-manifest`,
      );
      process.exit(1);
    }
    if (existing !== text) {
      console.error(
        `${target} is stale; run pnpm --filter @openelement/ui run generate:ui-manifest`,
      );
      process.exit(1);
    }
    console.log(`UI manifest check passed (${manifest.declarations.length} declarations).`);
  } else {
    await writeFile(OUT_FILE, text);
    console.log(`Wrote ${manifest.declarations.length} declarations to ${target}`);
  }
}
