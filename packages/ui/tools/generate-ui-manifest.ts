/**
 * Build-time generator for the @openelement/ui package manifest.
 *
 * Scans `src/open-*.tsx`, parses component metadata, and writes a
 * static JSON file to `src/generated-manifest.json`. This keeps
 * runtime-free packages free of Deno.readDirSync/Deno.readFileSync.
 *
 * Usage:
 *   deno run --allow-read --allow-write tools/generate-ui-manifest.ts
 *     -> (re)write the manifest.
 *   deno run --allow-read --allow-write tools/generate-ui-manifest.ts --check
 *     -> regenerate in memory and fail (exit 1) when the tracked manifest is
 *        missing or stale. Wired into `gate:release` as ui-manifest:check.
 */

import { walkSync } from '@std/fs/walk';
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

const UI_SRC_DIR = new URL('../src/', import.meta.url);
const UI_DENO_JSON = new URL('../deno.json', import.meta.url);
const OUT_FILE = new URL('../src/generated-manifest.json', import.meta.url);

const pkgVersion = JSON.parse(Deno.readTextFileSync(UI_DENO_JSON)).version;

interface ComponentMeta {
  file: string;
  tagName: string;
  className: string;
  description: string;
  attributes: OpenElementAttribute[];
  events: OpenElementEvent[];
  slots: OpenElementSlot[];
  cssParts: OpenElementCssPart[];
  layer: 'dsd-static' | 'dsd-interactive';
  // Hand-aligned with HYDRATION_STRATEGIES in
  // packages/element/src/internal/protocol/framework.ts (source of truth);
  // tools cannot import element runtime code.
  hydrate: 'load' | 'idle' | 'visible' | 'only';
}

const COMPONENT_ORDER = [
  'open-card',
  'open-callout',
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-badge',
  'open-dialog',
  'open-dropdown',
  'open-tabs',
];

// Fail-loud registry: every @openelement/ui component class must have an
// explicit layer/hydrate policy here. An unlisted class means a new component
// shipped without a layering decision — throw instead of silently defaulting.
// Hand-aligned with HYDRATION_STRATEGIES in
// packages/element/src/internal/protocol/framework.ts (source of truth);
// tools cannot import element runtime code.
const POLICY_BY_CLASS: Record<string, Pick<ComponentMeta, 'layer' | 'hydrate'>> = {
  OpenCard: { layer: 'dsd-static', hydrate: 'idle' },
  OpenCallout: { layer: 'dsd-static', hydrate: 'idle' },
  OpenButton: { layer: 'dsd-interactive', hydrate: 'load' },
  OpenInput: { layer: 'dsd-interactive', hydrate: 'load' },
  OpenThemeToggle: { layer: 'dsd-interactive', hydrate: 'load' },
  OpenCodeBlock: { layer: 'dsd-static', hydrate: 'idle' },
  OpenBadge: { layer: 'dsd-static', hydrate: 'idle' },
  OpenDialog: { layer: 'dsd-interactive', hydrate: 'idle' },
  OpenDropdown: { layer: 'dsd-interactive', hydrate: 'load' },
  OpenTabs: { layer: 'dsd-interactive', hydrate: 'load' },
};

function policyForClass(className: string): Pick<ComponentMeta, 'layer' | 'hydrate'> {
  const policy = POLICY_BY_CLASS[className];
  if (!policy) {
    throw new Error(
      `No layer/hydrate policy for component class '${className}': ` +
        'add it to POLICY_BY_CLASS in tools/generate-ui-manifest.ts',
    );
  }
  return policy;
}

export function layerFromClass(className: string): ComponentMeta['layer'] {
  return policyForClass(className).layer;
}

export function hydrateFromClass(className: string): ComponentMeta['hydrate'] {
  return policyForClass(className).hydrate;
}

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
        const inferred = type !== 'string'
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

export function parseEvents(text: string): OpenElementEvent[] {
  const events: OpenElementEvent[] = [];
  const seen = new Set<string>();
  const source = parseTypeScript(text, 'component.tsx');
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'CustomEvent'
    ) {
      const [nameNode, optionsNode] = node.arguments ?? [];
      if (!nameNode || !ts.isStringLiteralLike(nameNode) || seen.has(nameNode.text)) return;
      const name = nameNode.text;
      seen.add(name);
      let detailType: string | undefined;
      if (optionsNode && ts.isObjectLiteralExpression(optionsNode)) {
        const detail = optionsNode.properties.find((property) =>
          ts.isPropertyAssignment(property) && property.name.getText(source) === 'detail'
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
      // The header line is followed by a blank comment line before the prose
      // description — skip blank lines instead of giving up on the first one.
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].replace(/^\s*\*\s?/, '').trim();
        if (!next) continue;
        // Stop at the tag block (@csspart/@slot/...) or the comment end
        // without finding prose.
        if (next.startsWith('@') || next.startsWith('/')) return '';
        return next;
      }
    }
  }
  return '';
}

function buildMeta(file: string, source: string): ComponentMeta {
  const tagName = parseTagName(source);
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
    file,
    tagName,
    className,
    description: parseDescription(source),
    attributes,
    events: parseEvents(source),
    slots: parseSlots(source),
    cssParts: parseCssParts(source),
    layer: layerFromClass(className),
    hydrate: hydrateFromClass(className),
  };
}

function readComponentSources(): ComponentMeta[] {
  const metas: ComponentMeta[] = [];
  for (const entry of walkSync(UI_SRC_DIR, { includeDirs: false })) {
    if (!entry.isFile || !entry.name.startsWith('open-') || !entry.name.endsWith('.tsx')) continue;
    const source = Deno.readTextFileSync(entry.path);
    if (!source.includes('extends OpenElement')) continue;
    metas.push(buildMeta(entry.name, source));
  }
  const order = new Map(COMPONENT_ORDER.map((t, i) => [t, i]));
  metas.sort((a, b) => (order.get(a.tagName) ?? 999) - (order.get(b.tagName) ?? 999));
  return metas;
}

function buildDeclaration(meta: ComponentMeta): OpenElementDeclaration {
  return {
    tagName: meta.tagName,
    className: meta.className,
    superclassName: 'OpenElement',
    description: meta.description,
    attributes: meta.attributes.length ? meta.attributes : undefined,
    events: meta.events.length ? meta.events : undefined,
    slots: meta.slots.length ? meta.slots : undefined,
    cssParts: meta.cssParts.length ? meta.cssParts : undefined,
    openElement: {
      ssr: true,
      dsd: true,
      layer: meta.layer,
      hydrate: meta.hydrate,
      module: `@openelement/ui/${meta.file.replace(/\.tsx$/, '')}`,
      export: meta.className,
    },
  };
}

export type GeneratedUiManifest = OpenElementPackageManifest & {
  /** JSON has no comment syntax; this is the generated-file header. */
  $comment: string;
};

export function buildManifest(): GeneratedUiManifest {
  const metas = readComponentSources();
  const declarations = metas.map(buildDeclaration);
  // No `modules` block (#797): it emitted CEM-style paths like
  // `./open-card.js` that do not exist in the published package (`src/**`),
  // and the only manifest consumer (island-scanner) reads `declarations`.

  return {
    $comment:
      'GENERATED FILE - do not edit. Regenerate with: deno task generate:ui-manifest (drift gate: ui-manifest:check).',
    schemaVersion: '1.0.0',
    packageName: '@openelement/ui',
    version: pkgVersion,
    description: 'Open Props Web Component library for openElement',
    author: 'openElement',
    license: 'MIT',
    homepage: 'https://openelement.org',
    repository: 'https://github.com/open-element/openelement',
    declarations,
  };
}

if (import.meta.main) {
  const manifest = buildManifest();
  const text = formatJson(manifest);
  const target = OUT_FILE.pathname;
  if (Deno.args.includes('--check')) {
    let existing: string;
    try {
      existing = await Deno.readTextFile(OUT_FILE);
    } catch {
      console.error(`${target} is missing; run deno task --cwd packages/ui generate:ui-manifest`);
      Deno.exit(1);
    }
    if (existing !== text) {
      console.error(
        `${target} is stale; run deno task --cwd packages/ui generate:ui-manifest`,
      );
      Deno.exit(1);
    }
    console.log(`UI manifest check passed (${manifest.declarations.length} declarations).`);
  } else {
    await Deno.writeTextFile(OUT_FILE, text);
    console.log(`Wrote ${manifest.declarations.length} declarations to ${target}`);
  }
}
