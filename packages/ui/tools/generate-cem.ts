/**
 * Build-time generator for the @openelement/ui Custom Elements Manifest (CEM).
 *
 * Reads the internal OpenElement manifest (`src/generated-manifest.json`),
 * projects every declaration onto a CEM 2.1.0 module + custom-element class,
 * validates the result against the official schema shipped by the
 * `custom-elements-manifest` package, and writes `custom-elements.json` at the
 * package root (shipped in the tarball via package.json `files`).
 *
 * Usage:
 *   node tools/generate-cem.ts
 *     -> (re)write the manifest.
 *   node tools/generate-cem.ts --check
 *     -> regenerate + validate in memory and fail (exit 1) when the tracked
 *        manifest is missing or stale. Wired into `gate:release` as
 *        ui-cem:check.
 */

import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';
import { formatJson } from '@openelement/element/build-utils';
import type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementDeclaration,
  OpenElementEvent,
  OpenElementPackageManifest,
  OpenElementSlot,
} from '@openelement/element';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

const UI_PACKAGE_JSON = new URL('../package.json', import.meta.url);
const UI_MANIFEST = new URL('../src/generated-manifest.json', import.meta.url);
const OUT_FILE = new URL('../custom-elements.json', import.meta.url);
const PACKAGE_NAME = '@openelement/ui';

/**
 * The official CEM schema ships as a plain file in the `custom-elements-manifest`
 * package (no `exports` map, so `createRequire` resolves the subpath exactly).
 */
const require = createRequire(import.meta.url);
const CEM_SCHEMA_PATH = require.resolve('custom-elements-manifest/schema.json');

/** CEM `Type` value. */
interface CemType {
  text: string;
}

interface CemAttribute {
  name: string;
  type: CemType;
  default?: string;
  description?: string;
}

interface CemEvent {
  name: string;
  type: CemType;
  description?: string;
}

interface CemSlot {
  name: string;
  description?: string;
}

interface CemCssPart {
  name: string;
  description?: string;
}

/**
 * `cssProperties` is not emitted by `generate-ui-manifest.ts` today, but the
 * projection below is generic so a future manifest field of that name is
 * carried instead of silently dropped.
 */
interface CemCssProperty {
  name: string;
  description?: string;
  default?: string;
  syntax?: string;
}

interface CemClassDeclaration {
  kind: 'class';
  name: string;
  tagName: string;
  customElement: true;
  description?: string;
  /**
   * Emitted only when the internal declaration names a truthful public
   * superclass. The generated native element's parent is the non-public
   * `OpenElementBase`, so the emitted-class declaration carries no
   * `superclass` (a fabricated `OpenElement` fallback was removed).
   */
  superclass?: { name: string; package: string };
  attributes?: CemAttribute[];
  members: unknown[];
  events?: CemEvent[];
  slots?: CemSlot[];
  cssParts?: CemCssPart[];
  cssProperties?: CemCssProperty[];
}

interface CemModule {
  kind: 'javascript-module';
  path: string;
  declarations: CemClassDeclaration[];
}

export interface CustomElementsManifest {
  schemaVersion: '2.1.0';
  modules: CemModule[];
}

/**
 * The internal manifest's declaration shape (see packages/protocol
 * `OpenElementDeclaration`). `file` is not emitted today; when a future
 * generator adds it, the CEM path follows the declared file instead of the
 * package export map.
 */
export interface UiDeclaration extends OpenElementDeclaration {
  file?: string;
  cssProperties?: Array<{
    name: string;
    description?: string;
    default?: string;
    syntax?: string;
  }>;
}

export interface UiManifest extends OpenElementPackageManifest {
  declarations: UiDeclaration[];
}

interface UiPackageJson {
  exports?: Record<string, unknown>;
}

function readJson(file: URL): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function withDescription<T extends object>(
  value: T,
  description: string | undefined,
): T & { description?: string } {
  return description ? { ...value, description } : value;
}

function buildAttribute(attribute: OpenElementAttribute): CemAttribute {
  return {
    name: attribute.name,
    type: { text: attribute.type ?? 'string' },
    ...(attribute.default !== undefined ? { default: attribute.default } : {}),
    ...(attribute.description ? { description: attribute.description } : {}),
  };
}

function buildEvent(event: OpenElementEvent): CemEvent {
  return {
    name: event.name,
    type: { text: event.type ?? 'CustomEvent' },
    ...(event.description ? { description: event.description } : {}),
  };
}

function buildSlot(slot: OpenElementSlot): CemSlot {
  return withDescription({ name: slot.name }, slot.description);
}

function buildCssPart(part: OpenElementCssPart): CemCssPart {
  return withDescription({ name: part.name }, part.description);
}

function buildCssProperty(property: {
  name: string;
  description?: string;
  default?: string;
  syntax?: string;
}): CemCssProperty {
  const { name, description, default: defaultValue, syntax } = property;
  return {
    name,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(syntax ? { syntax } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * The CEM module path for one declaration, relative to the package root.
 * `generate-ui-manifest.ts` does not persist its scan `file` today, so the
 * path derives from the declaration's own package subpath through the
 * package.json export map (e.g. `@openelement/ui/open-button` ->
 * `./src/open-button.tsx`). A future `file` field wins when present.
 */
function modulePathFor(declaration: UiDeclaration, exportsMap: Record<string, unknown>): string {
  if (typeof declaration.file === 'string' && declaration.file !== '') {
    return `src/${declaration.file.replace(/^\.?\//, '')}`;
  }
  const specifier = declaration.openElement?.module;
  if (typeof specifier !== 'string' || !specifier.startsWith(`${PACKAGE_NAME}/`)) {
    throw new Error(
      `Declaration '${declaration.tagName}' has no '${PACKAGE_NAME}/…' module specifier; ` +
        'cannot derive its CEM module path',
    );
  }
  const subpath = `.${specifier.slice(PACKAGE_NAME.length)}`;
  const target = exportsMap[subpath];
  if (typeof target !== 'string' || !target.startsWith('./src/')) {
    throw new Error(
      `Declaration '${declaration.tagName}' subpath '${subpath}' does not resolve to a ./src/ ` +
        `target in ${UI_PACKAGE_JSON.pathname} (got ${JSON.stringify(target)})`,
    );
  }
  return target.slice(2);
}

function buildClassDeclaration(
  declaration: UiDeclaration,
  exportsMap: Record<string, unknown>,
): CemModule {
  const name = declaration.className;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`Declaration '${declaration.tagName}' has no className`);
  }
  const attributes = (declaration.attributes ?? []).map(buildAttribute);
  const events = (declaration.events ?? []).map(buildEvent);
  const slots = (declaration.slots ?? []).map(buildSlot);
  const cssParts = (declaration.cssParts ?? []).map(buildCssPart);
  const cssProperties = (declaration.cssProperties ?? []).map(buildCssProperty);

  return {
    kind: 'javascript-module',
    path: modulePathFor(declaration, exportsMap),
    declarations: [
      {
        kind: 'class',
        name,
        tagName: declaration.tagName,
        customElement: true,
        description: declaration.description ?? '',
        // No `?? 'OpenElement'` fallback: a declaration without a superclass
        // (the emitted generated element) must not claim a public parent.
        ...(typeof declaration.superclassName === 'string' && declaration.superclassName !== ''
          ? {
              superclass: {
                name: declaration.superclassName,
                package: '@openelement/element',
              },
            }
          : {}),
        members: [],
        ...(attributes.length > 0 ? { attributes } : {}),
        ...(events.length > 0 ? { events } : {}),
        ...(slots.length > 0 ? { slots } : {}),
        ...(cssParts.length > 0 ? { cssParts } : {}),
        ...(cssProperties.length > 0 ? { cssProperties } : {}),
      },
    ],
  };
}

/**
 * In-memory projection input: an internal package manifest plus the package
 * `exports` map that resolves each declaration's module path. The no-argument
 * form of {@link buildCustomElementsManifest} reads the tracked files exactly
 * as before, so the CLI/`--check` bytes are unchanged.
 */
export interface CustomElementsProjectionInput {
  readonly manifest: UiManifest;
  /** Package `exports` map; omit to read the tracked `packages/ui/package.json`. */
  readonly exportsMap?: Record<string, unknown>;
}

export function buildCustomElementsManifest(
  input?: CustomElementsProjectionInput,
): CustomElementsManifest {
  const manifest = input?.manifest ?? (readJson(UI_MANIFEST) as UiManifest);
  const exportsMap =
    input?.exportsMap ?? (readJson(UI_PACKAGE_JSON) as UiPackageJson).exports ?? {};

  // Declaration order is the generated manifest's own policy order, so the
  // output is deterministic without a second sort key.
  const modules = manifest.declarations.map((declaration) =>
    buildClassDeclaration(declaration, exportsMap),
  );

  return { schemaVersion: '2.1.0', modules };
}

/**
 * Fail with one readable path per schema error. Ajv's `instancePath` is the
 * JSON pointer inside the emitted manifest; `schemaPath` names the violated
 * rule.
 */
function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => {
      const at = error.instancePath === '' ? '/' : error.instancePath;
      return `  ${at}: ${error.message ?? 'is invalid'} (${error.schemaPath})`;
    })
    .join('\n');
}

export function validateCustomElementsManifest(manifest: CustomElementsManifest): void {
  const schema = JSON.parse(readFileSync(CEM_SCHEMA_PATH, 'utf8')) as object;
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    throw new Error(
      `Emitted Custom Elements Manifest does not satisfy the official CEM schema ` +
        `(${CEM_SCHEMA_PATH}):\n${formatSchemaErrors(validate.errors)}`,
    );
  }
}

if (import.meta.main) {
  const manifest = buildCustomElementsManifest();
  validateCustomElementsManifest(manifest);
  const text = formatJson(manifest);
  const target = OUT_FILE.pathname;
  if (process.argv.slice(2).includes('--check')) {
    let existing: string;
    try {
      existing = await readFile(OUT_FILE, 'utf8');
    } catch {
      console.error(`${target} is missing; run pnpm --filter @openelement/ui run generate:ui-cem`);
      process.exit(1);
    }
    if (existing !== text) {
      console.error(`${target} is stale; run pnpm --filter @openelement/ui run generate:ui-cem`);
      process.exit(1);
    }
    console.log(`CEM check passed (${manifest.modules.length} modules).`);
  } else {
    await writeFile(OUT_FILE, text);
    console.log(`Wrote ${manifest.modules.length} CEM modules to ${target}`);
  }
}
