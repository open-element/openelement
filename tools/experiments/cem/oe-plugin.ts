/**
 * OE provenance plugin PoC for @custom-elements-manifest/analyzer (#1156, Beta.2.2).
 *
 * Demonstrates the adoption boundary evaluated in
 * docs/evidence/2026-09-10-beta2-2-cem-experiment.md: the upstream analyzer owns
 * generic AST extraction (classes, members, attributes, events, superclass
 * resolution); this plugin supplies only OE-specific provenance that upstream
 * has no concept of:
 *
 *   1. tagName from the `@element('tag', ...)` decorator (authored sources) or
 *      from the compiled `__elementMetadata` const (compiled Part Program form);
 *   2. slots/cssParts from TSX templates (`<slot name='...'>`, `part='...'`) and
 *      `@slot`/`@csspart` doc comments, or from the compiled `__partProgram`
 *      template walk;
 *   3. the file-header description convention (`@openelement/ui - <name>` prose);
 *   4. OE attribute-name kebab-casing (generate-ui-manifest.ts convention).
 *
 * It deliberately does NOT derive layer/hydrate/ssr/dsd policy: that stays in
 * the fail-loud POLICY_BY_CLASS registry in tools/generate-ui-manifest.ts and is
 * joined onto the manifest afterwards by OE tooling. The plugin is parse-only and
 * never executes component code.
 */

import type * as Ts from 'typescript';
import { headerDescription } from './header-description.ts';

export interface AttributeDoc {
  name: string;
  type?: { text: string };
  default?: string;
  fieldName?: string;
  reflect?: boolean;
  description?: string;
}

export interface ClassDoc {
  kind?: string;
  name?: string;
  tagName?: string;
  customElement?: boolean;
  description?: string;
  attributes?: AttributeDoc[];
  events?: { name?: string; type?: { text: string } }[];
  slots?: { name: string; description?: string }[];
  cssParts?: { name: string; description?: string }[];
  members?: unknown[];
}

export interface ModuleDoc {
  path?: string;
  declarations?: ClassDoc[];
  exports?: unknown[];
}

export interface AnalyzePhaseParams {
  ts: typeof Ts;
  node: Ts.Node;
  moduleDoc: ModuleDoc;
  context?: Record<string, unknown>;
}

export interface AnalyzerPlugin {
  name: string;
  analyzePhase?(params: AnalyzePhaseParams): void;
  moduleLinkPhase?(params: { moduleDoc: ModuleDoc }): void;
}

interface ElementMetadataProperty {
  name: string;
  attribute: string | null;
  type: string;
  reflect: boolean;
  default: unknown;
}

interface ElementMetadata {
  tag: string;
  className: string;
  properties: ElementMetadataProperty[];
}

interface PartProgramNode {
  k?: string;
  tag?: string;
  attrs?: [string, string][];
  children?: PartProgramNode[];
}

interface PartProgram {
  tag: string;
  template?: PartProgramNode[];
}

/** OE attribute-name convention (tools/generate-ui-manifest.ts kebab rule). */
const kebab = (value: string): string => value.replace(/([A-Z])/g, '-$1').toLowerCase();

function findClassDoc(moduleDoc: ModuleDoc, name: string | undefined): ClassDoc | undefined {
  return moduleDoc.declarations?.find((declaration) => declaration.name === name);
}

function addCustomElementExport(moduleDoc: ModuleDoc, tagName: string, className: string): void {
  moduleDoc.exports ??= [];
  (moduleDoc.exports as unknown[]).push({
    kind: 'custom-element-definition',
    name: tagName,
    declaration: { name: className, module: moduleDoc.path },
  });
}

/**
 * The OE provenance plugin. Composes with upstream framework plugins (the
 * analyzer's litPlugin handles `@property` attribute extraction); this plugin
 * runs after them and fills what they cannot know.
 */
export function oePlugin(): AnalyzerPlugin {
  // Facts found before the class declaration is analyzed must be deferred:
  // analyzePhase visits nodes in source order, and the compiled metadata consts
  // precede the class. Stash them; apply in moduleLinkPhase when moduleDoc is
  // complete.
  let pendingMeta: ElementMetadata | undefined;
  let pendingProgram: PartProgram | undefined;

  return {
    name: 'oe-provenance-poc',

    moduleLinkPhase({ moduleDoc }) {
      if (pendingMeta) {
        const classDoc = findClassDoc(moduleDoc, pendingMeta.className);
        if (classDoc) {
          classDoc.tagName = pendingMeta.tag;
          classDoc.customElement = true;
          classDoc.attributes = pendingMeta.properties
            .filter((property) => property.attribute !== null)
            .map((property) => ({
              name: kebab(property.attribute!),
              type: { text: property.type },
              default: property.default === null ? undefined : JSON.stringify(property.default),
              fieldName: property.name,
              reflect: property.reflect,
            }));
          addCustomElementExport(moduleDoc, pendingMeta.tag, pendingMeta.className);
        }
      }
      if (pendingProgram) {
        const classDoc = moduleDoc.declarations?.find((d) => d.tagName === pendingProgram!.tag);
        if (classDoc) {
          const slots = new Set<string>();
          const parts = new Set<string>();
          const walk = (node: PartProgramNode): void => {
            if (node.tag === 'slot') {
              const name = (node.attrs ?? []).find(([key]) => key === 'name')?.[1] ?? '';
              slots.add(name);
            }
            for (const [key, value] of node.attrs ?? []) {
              if (key === 'part') value.split(/\s+/).forEach((part) => part && parts.add(part));
            }
            for (const child of node.children ?? []) if (child.k === 'el') walk(child);
          };
          for (const node of pendingProgram.template ?? []) walk(node);
          if (slots.size) classDoc.slots = [...slots].sort().map((name) => ({ name }));
          if (parts.size) classDoc.cssParts = [...parts].sort().map((name) => ({ name }));
        }
      }
      pendingMeta = undefined;
      pendingProgram = undefined;
    },

    analyzePhase({ ts, node, moduleDoc }) {
      const sourceFile = node.getSourceFile?.();
      if (!sourceFile) return;

      // Authored form: @element('tag', {...}) on a class declaration.
      if (ts.isClassDeclaration(node) && node.name) {
        const classDoc = findClassDoc(moduleDoc, node.name.text);
        const decorators = ts.getDecorators(node) ?? [];
        for (const decorator of decorators) {
          const call = decorator.expression;
          if (!ts.isCallExpression(call) || call.expression.getText(sourceFile) !== 'element') {
            continue;
          }
          const [tagArg] = call.arguments;
          const tagName = tagArg && ts.isStringLiteralLike(tagArg) ? tagArg.text : undefined;
          if (tagName && classDoc) {
            classDoc.tagName = tagName;
            classDoc.customElement = true;
            addCustomElementExport(moduleDoc, tagName, node.name.text);
          }
        }
        if (!classDoc?.tagName) return;

        // Slots/cssParts from the OE TSX + doc-comment conventions; upstream has
        // no template scanning, so the plugin supplies them (mirrors parseSlots/
        // parseCssParts in tools/generate-ui-manifest.ts).
        const text = sourceFile.getFullText();
        const slots: { name: string; description?: string }[] = [];
        const cssParts: { name: string; description?: string }[] = [];
        const seenSlots = new Set<string>();
        const seenParts = new Set<string>();
        const addSlot = (name: string, description?: string): void => {
          if (seenSlots.has(name)) return;
          seenSlots.add(name);
          slots.push(description === undefined ? { name } : { name, description });
        };
        const addPart = (name: string, description?: string): void => {
          if (!name || seenParts.has(name)) return;
          seenParts.add(name);
          cssParts.push(description === undefined ? { name } : { name, description });
        };
        for (const match of text.matchAll(/\*\s*@slot\s+(\S*)\s*-+(.*)/g)) {
          addSlot(match[1], match[2].trim());
        }
        for (const match of text.matchAll(/<slot\s+name=['"]([^'"]+)['"]/g)) addSlot(match[1]);
        if (/<slot(?![^>]*\bname\s*=)[^>]*>/.test(text) && !seenSlots.has('')) {
          slots.unshift({ name: '', description: 'Default slot' });
        }
        for (const match of text.matchAll(/\*\s*@csspart\s+(\S+)\s*-+(.*)/g)) {
          addPart(match[1], match[2].trim());
        }
        for (const match of text.matchAll(/\bpart=['"]([^'"]+)['"]/g)) {
          for (const name of match[1].trim().split(/\s+/)) addPart(name);
        }
        if (slots.length) classDoc.slots = slots;
        if (cssParts.length) classDoc.cssParts = cssParts;

        // File-header description convention: prose after the `@openelement/ui` line.
        const description = headerDescription(text);
        if (description !== undefined) classDoc.description = description;

        // OE attribute-name kebab convention: the upstream lit plugin keeps the
        // field name verbatim; OE kebab-cases (generate-ui-manifest.ts:108).
        // Identity on today's corpus (all attribute-backed props are single-word)
        // but owns the rule so a future camelCase attribute stays correct.
        for (const attribute of classDoc.attributes ?? []) attribute.name = kebab(attribute.name);
        return;
      }

      // Compiled form: the compiler's provenance lives in JSON consts — read it
      // directly instead of re-inferring from erased-decorator output.
      if (ts.isVariableStatement(node)) {
        const declaration = node.declarationList.declarations[0];
        if (!declaration?.initializer || !ts.isIdentifier(declaration.name)) return;
        if (declaration.name.text === '__elementMetadata') {
          pendingMeta = JSON.parse(declaration.initializer.getText(sourceFile)) as ElementMetadata;
        }
        if (declaration.name.text === '__partProgram') {
          pendingProgram = JSON.parse(declaration.initializer.getText(sourceFile)) as PartProgram;
        }
      }
    },
  };
}

/** Load the analyzer's bundled litPlugin via its deep subpath (no exports map). */
export async function loadLitPlugin(): Promise<AnalyzerPlugin[]> {
  const mod = (await import(
    'npm:@custom-elements-manifest/analyzer@0.11.0/src/features/framework-plugins/lit/lit.js'
  )) as { litPlugin: () => AnalyzerPlugin[] };
  return mod.litPlugin();
}

/** Load the analyzer's bundled FAST plugin (decorator-style FAST only). */
export async function loadFastPlugin(): Promise<AnalyzerPlugin[]> {
  const mod = (await import(
    'npm:@custom-elements-manifest/analyzer@0.11.0/src/features/framework-plugins/fast/fast.js'
  )) as { fastPlugin: () => AnalyzerPlugin[] };
  return mod.fastPlugin();
}

/** Load the analyzer's bundled Stencil plugin (Stencil @Component sources only). */
export async function loadStencilPlugin(): Promise<AnalyzerPlugin> {
  const mod = (await import(
    'npm:@custom-elements-manifest/analyzer@0.11.0/src/features/framework-plugins/stencil/stencil.js'
  )) as { stencilPlugin: () => AnalyzerPlugin };
  return mod.stencilPlugin();
}
