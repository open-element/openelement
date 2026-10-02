#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/**
 * Web Components interoperability qualification (#1175).
 *
 * This is a qualification harness, not an Element-core adapter. It validates
 * the compiler-facing CEM artifact, builds a temporary OpenElement app from
 * the owned corpus, and probes the browser's native Custom Element contract.
 * Unknown SSR capability is deliberately classified as client-only; there is
 * no framework fallback or second rendering path in this harness.
 *
 * Artifact consumption: this fixture consumes workspace SOURCE artifacts —
 * the temporary app aliases every workspace package to its in-repo source and
 * builds with the in-repo Router build CLI.
 *
 * Single source of truth: corpus.json is the canonical corpus. The CEM
 * artifact (compiler-output.cem.json) and the qualification evidence
 * (interop-evidence.json) are GENERATED artifacts, regenerated on every run
 * into the temporary work directory — they are gitignored and must never be
 * committed as a second hand-written source of truth.
 */

import { readdirSync } from 'node:fs';
import { dirname, fromFileUrl, join, resolve } from '@std/path';
import type {
  CustomElementDeclaration,
  CustomElementField,
  JavaScriptModule,
  Package as CemPackage,
} from 'custom-elements-manifest';
import { extractSsrAdmissionPlan } from '../../lib/qualify-harness/admission-plan.ts';
import {
  findFile,
  findServerEntry,
  runRouterBuild,
} from '../../lib/qualify-harness/build-router.ts';
import { launchQualifyBrowser } from '../../lib/qualify-harness/drive-chromium.ts';
import { jsonText, readJson } from '../../lib/qualify-harness/json-file.ts';
import { scaffoldApp } from '../../lib/qualify-harness/scaffold-app.ts';
import {
  applyWorkspaceAliases,
  primeAppNodeModules,
} from '../../lib/qualify-harness/workspace-alias.ts';
import { escapeRegExp } from '../../../tools/lib/text.ts';

/**
 * The regenerated CEM artifact, typed by the upstream Custom Elements
 * Manifest schema package — the generic metadata authority for tags,
 * attributes, members, events, slots, and CSS parts. `$schema` is the one
 * customary field the upstream `Package` interface does not declare.
 */
export type InteropCemManifest = CemPackage & { $schema?: string };

const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), '..', '..', '..');
const defaultFixtureRoot = new URL('./', import.meta.url);
const requiredFrameworks = ['native', 'lit', 'fast', 'stencil'] as const;
const requiredProbes = [
  'property',
  'attribute',
  'event',
  'slot',
  'css-part',
  'root',
  'upgrade-order',
] as const;
const requiredPlacements = ['child', 'application-dependency'] as const;
const browserNames = ['chromium', 'firefox', 'webkit'] as const;
const appProjectName = 'web-component-interop-corpus-app';

export type InteropFramework = (typeof requiredFrameworks)[number];
export type InteropProbe = (typeof requiredProbes)[number];
export type InteropPlacement = (typeof requiredPlacements)[number];
export type BrowserName = (typeof browserNames)[number];

export interface InteropComponent {
  framework: InteropFramework;
  tag: string;
  className: string;
  property: string;
  attribute: string;
  event: string;
  slotText: string;
  cssPart: string;
  ids: Record<InteropPlacement, string>;
  placements: InteropPlacement[];
  probes: InteropProbe[];
}

interface InteropApplication {
  route: string;
  fixtureTag: string;
  childHostTag: string;
  childHostId: string;
  dependencyRootId: string;
}

interface CorpusConfig {
  schemaVersion: number;
  cem: string;
  application: InteropApplication;
  components: InteropComponent[];
}

export interface InteropCorpus extends Omit<CorpusConfig, 'cem'> {
  cem: InteropCemManifest;
}

export interface SsrCapabilityDecision {
  renderPath: 'ssr+client' | 'client-only';
  code: 'OEI1000' | 'OEI2000' | 'OEI2001';
  message: string;
}

interface SsrComponentEvidence {
  tag: string;
  tagPresent: boolean;
  lightDomChildPresent: boolean;
  dsdTemplate: boolean;
  admission: { renderPath: string; reason: string } | null;
}

export interface SsrEvidence {
  htmlPath: string;
  fixture: { tag: string; tagPresent: boolean; dsdTemplate: boolean };
  foreignComponents: SsrComponentEvidence[];
}

interface BrowserComponentEvidence {
  id: string;
  tag: string;
  placement: InteropPlacement;
  upgraded: boolean;
  propertyAttribute: boolean;
  event: boolean;
  slot: boolean;
  cssPart: boolean;
  root: boolean;
  upgradeOrder: boolean;
  identityPreserved: boolean;
  liveStatePreserved: boolean;
  propertyValue?: string | boolean;
  attributeValue?: string | null;
  assignedSlotNodes?: number;
}

interface BrowserFreshComponentEvidence {
  id: string;
  tag: string;
  upgraded: boolean;
  propertyAttribute: boolean;
  event: boolean;
  slot: boolean;
  cssPart: boolean;
  root: boolean;
  upgradeOrder: boolean;
  propertyValue?: string | boolean;
  attributeValue?: string | null;
  assignedSlotNodes?: number;
}

export interface BrowserEvidence {
  browser: BrowserName;
  childHost: boolean;
  components: BrowserComponentEvidence[];
  fresh: BrowserFreshComponentEvidence[];
  upgradeOrder: string[];
  pageErrors: string[];
}

export interface InteropQualificationEvidence {
  schemaVersion: 1;
  source: 'tests/fixtures/web-component-interop/qualify.ts';
  corpus: {
    frameworks: InteropFramework[];
    componentCount: number;
    probes: InteropProbe[];
    placements: InteropPlacement[];
  };
  cem: { schemaVersion: string; tags: string[] };
  ssr: SsrEvidence;
  admission: Record<string, SsrCapabilityDecision>;
  browsers: Record<BrowserName, BrowserEvidence>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? (value[key] as string) : undefined;
}

function pathFromRoot(root: URL | string, relativePath: string): string {
  return root instanceof URL ? fromFileUrl(new URL(relativePath, root)) : join(root, relativePath);
}

function equalArrays(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validCustomElementTag(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(value);
}

/**
 * Validate the deliberately small CEM surface regenerated from the interop
 * corpus, fail-closed. The upstream CEM schema (npm:custom-elements-manifest)
 * owns the interchange TYPES (see InteropCemManifest), but its draft-07 JSON
 * schema cannot express this contract: it accepts empty `modules`, empty
 * module paths, empty declaration names, duplicate or non-hyphenated tag
 * names, and any `schemaVersion` string (verified against
 * custom-elements-manifest@2.1.0 schema.json with ajv@8.17.1). Swapping this
 * validator for schema validation would break the fail-closed corpus
 * contract, and layering both would duplicate validation — so runtime
 * validation stays here until the upstream schema expresses these invariants.
 * The shape follows CEM 1.0.0: javascript modules, class declarations,
 * custom-element tags, members, attributes, events, slots and CSS parts.
 */
export function validateCemManifest(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['manifest must be an object'];
  if (raw.schemaVersion !== '1.0.0') {
    errors.push('schemaVersion must be "1.0.0"');
  }

  const modules = raw.modules;
  if (!Array.isArray(modules) || modules.length === 0) {
    errors.push('modules must be a non-empty array');
    return errors;
  }

  const tags = new Set<string>();
  for (const [moduleIndex, moduleValue] of modules.entries()) {
    const modulePath = `modules[${moduleIndex}]`;
    if (!isRecord(moduleValue)) {
      errors.push(`${modulePath} must be an object`);
      continue;
    }
    if (moduleValue.kind !== 'javascript-module') {
      errors.push(`${modulePath}.kind must be "javascript-module"`);
    }
    if (!stringField(moduleValue, 'path')) {
      errors.push(`${modulePath}.path must be a non-empty string`);
    }

    const declarations = moduleValue.declarations;
    if (!Array.isArray(declarations) || declarations.length === 0) {
      errors.push(`${modulePath}.declarations must be a non-empty array`);
      continue;
    }
    for (const [declarationIndex, declarationValue] of declarations.entries()) {
      const declarationPath = `${modulePath}.declarations[${declarationIndex}]`;
      if (!isRecord(declarationValue)) {
        errors.push(`${declarationPath} must be an object`);
        continue;
      }
      if (declarationValue.kind !== 'class') {
        errors.push(`${declarationPath}.kind must be "class"`);
      }
      if (declarationValue.customElement !== true) {
        errors.push(`${declarationPath}.customElement must be true`);
      }
      const tag = declarationValue.tagName;
      if (!validCustomElementTag(tag)) {
        errors.push(`${declarationPath}.tagName must be a lowercase hyphenated tag`);
      } else if (tags.has(tag)) {
        errors.push(`${declarationPath}.tagName duplicates ${tag}`);
      } else {
        tags.add(tag);
      }
      if (!stringField(declarationValue, 'name')) {
        errors.push(`${declarationPath}.name must be a non-empty string`);
      }

      const superclass = declarationValue.superclass;
      if (!isRecord(superclass) || !stringField(superclass, 'name')) {
        errors.push(`${declarationPath}.superclass.name must be a non-empty string`);
      }

      const members = declarationValue.members;
      if (!Array.isArray(members)) {
        errors.push(`${declarationPath}.members must be an array`);
      } else {
        for (const [memberIndex, memberValue] of members.entries()) {
          const memberPath = `${declarationPath}.members[${memberIndex}]`;
          if (!isRecord(memberValue)) {
            errors.push(`${memberPath} must be an object`);
            continue;
          }
          if (!['field', 'method', 'getter', 'setter'].includes(String(memberValue.kind))) {
            errors.push(`${memberPath}.kind is not a CEM member kind`);
          }
          if (!stringField(memberValue, 'name')) {
            errors.push(`${memberPath}.name must be a non-empty string`);
          }
          if ('attribute' in memberValue && typeof memberValue.attribute !== 'string') {
            errors.push(`${memberPath}.attribute must be a string when present`);
          }
          if ('reflects' in memberValue && typeof memberValue.reflects !== 'boolean') {
            errors.push(`${memberPath}.reflects must be boolean when present`);
          }
        }
      }

      for (const field of ['attributes', 'events', 'slots', 'cssParts'] as const) {
        const entries = declarationValue[field];
        if (!Array.isArray(entries)) {
          errors.push(`${declarationPath}.${field} must be an array`);
          continue;
        }
        for (const [entryIndex, entryValue] of entries.entries()) {
          const entryPath = `${declarationPath}.${field}[${entryIndex}]`;
          if (
            !isRecord(entryValue) ||
            typeof entryValue.name !== 'string' ||
            (field !== 'slots' && entryValue.name.length === 0)
          ) {
            errors.push(`${entryPath}.name must be a non-empty string`);
          }
        }
      }
    }
  }
  return errors;
}

function customElementTags(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.modules)) return [];
  const tags: string[] = [];
  for (const moduleValue of raw.modules) {
    if (!isRecord(moduleValue) || !Array.isArray(moduleValue.declarations)) {
      continue;
    }
    for (const declarationValue of moduleValue.declarations) {
      if (!isRecord(declarationValue) || declarationValue.customElement !== true) continue;
      const tag = declarationValue.tagName;
      if (typeof tag === 'string') tags.push(tag);
    }
  }
  return tags;
}

function validateCorpusConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['corpus must be an object'];
  if (raw.schemaVersion !== 1) errors.push('corpus schemaVersion must be 1');
  if (!stringField(raw, 'cem')) {
    errors.push('corpus cem must be a relative manifest path');
  }

  const application = raw.application;
  if (!isRecord(application)) {
    errors.push('corpus application must be an object');
  } else {
    for (const field of [
      'route',
      'fixtureTag',
      'childHostTag',
      'childHostId',
      'dependencyRootId',
    ]) {
      if (!stringField(application, field)) {
        errors.push(`corpus application.${field} must be a string`);
      }
    }
  }

  const components = raw.components;
  if (!Array.isArray(components) || components.length !== requiredFrameworks.length) {
    errors.push(`corpus components must contain exactly ${requiredFrameworks.length} entries`);
    return errors;
  }
  const seenFrameworks = new Set<string>();
  const seenTags = new Set<string>();
  for (const [index, componentValue] of components.entries()) {
    const path = `corpus.components[${index}]`;
    if (!isRecord(componentValue)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const framework = stringField(componentValue, 'framework');
    if (!framework || !(requiredFrameworks as readonly string[]).includes(framework)) {
      errors.push(`${path}.framework is unsupported`);
    } else if (seenFrameworks.has(framework)) {
      errors.push(`${path}.framework duplicates ${framework}`);
    } else {
      seenFrameworks.add(framework);
    }
    const tag = stringField(componentValue, 'tag');
    if (!validCustomElementTag(tag)) {
      errors.push(`${path}.tag is not a valid custom-element tag`);
    } else if (seenTags.has(tag)) errors.push(`${path}.tag duplicates ${tag}`);
    else seenTags.add(tag);

    for (const field of ['className', 'property', 'attribute', 'event', 'slotText', 'cssPart']) {
      if (!stringField(componentValue, field)) {
        errors.push(`${path}.${field} must be a string`);
      }
    }
    const placements = componentValue.placements;
    if (!Array.isArray(placements) || !equalArrays(placements, requiredPlacements)) {
      errors.push(`${path}.placements must be child and application-dependency in order`);
    }
    const probes = componentValue.probes;
    if (!Array.isArray(probes) || !equalArrays(probes, requiredProbes)) {
      errors.push(`${path}.probes must list every required probe in order`);
    }
    const ids = componentValue.ids;
    if (!isRecord(ids)) {
      errors.push(`${path}.ids must contain both placement ids`);
    } else {
      for (const placement of requiredPlacements) {
        if (!stringField(ids, placement)) {
          errors.push(`${path}.ids.${placement} must be a string`);
        }
      }
    }
  }
  if (!equalArrays([...seenFrameworks], requiredFrameworks)) {
    errors.push('corpus framework order must be native, lit, fast, stencil');
  }
  return errors;
}

/**
 * Resolve SSR admission without inventing a fallback. A missing or unknown
 * capability is an explicit client-only decision with a stable diagnostic.
 */
export function classifySsrCapability(capability: unknown): SsrCapabilityDecision {
  if (capability === 'ssr' || capability === 'ssr+client') {
    return {
      renderPath: 'ssr+client',
      code: 'OEI1000',
      message: 'validated SSR capability permits the ssr+client path',
    };
  }
  if (capability === 'client-only') {
    return {
      renderPath: 'client-only',
      code: 'OEI2000',
      message: 'client-only capability is explicit; no SSR output is claimed',
    };
  }
  return {
    renderPath: 'client-only',
    code: 'OEI2001',
    message:
      `unknown SSR capability ${JSON.stringify(capability)}; fail closed to client-only ` +
      'without a compatibility fallback',
  };
}

const SUPERCLASS_BY_FRAMEWORK: Record<InteropFramework, string> = {
  native: 'HTMLElement',
  lit: 'LitElement',
  fast: 'FASTElement',
  stencil: 'IonButton',
};

/**
 * Regenerate the compiler-facing CEM artifact from the canonical corpus,
 * typed and shaped by the upstream CEM schema (npm:custom-elements-manifest):
 * members use the upstream `reflects` field and every member `attribute` is
 * cross-listed in the declaration's `attributes` array, as the upstream
 * schema requires. corpus.json is the single source of truth; the CEM (named
 * by the corpus `cem` field, e.g. compiler-output.cem.json) is derived
 * evidence and is never committed.
 *
 * The upstream analyzer (@custom-elements-manifest/analyzer) is deliberately
 * NOT used for this generation: the corpus is synthetic, the analyzer expects
 * real per-framework source files (plus framework plugins for FAST/Stencil
 * and JSDoc annotations for slots/cssParts/events), and its output is not
 * byte-deterministic across versions — all incompatible with a canonical
 * corpus whose derived artifact must be reproducible on every run.
 */
export function generateCemManifest(components: readonly InteropComponent[]): InteropCemManifest {
  const modules: JavaScriptModule[] = components.map((component) => {
    const member: CustomElementField = {
      kind: 'field',
      name: component.property,
      type: {
        text: component.property === 'disabled' ? 'boolean' : 'string',
      },
      attribute: component.attribute,
      reflects: true,
    };
    const declaration: CustomElementDeclaration = {
      kind: 'class',
      name: component.className,
      customElement: true,
      tagName: component.tag,
      superclass: { name: SUPERCLASS_BY_FRAMEWORK[component.framework] },
      members: [member],
      attributes: [{ name: component.attribute, fieldName: component.property }],
      events: [{ name: component.event, type: { text: 'CustomEvent' } }],
      slots: [{ name: '', description: 'Default content slot' }],
      cssParts: [{ name: component.cssPart }],
    };
    return {
      kind: 'javascript-module',
      path: `./${component.framework}.ts`,
      declarations: [declaration],
    };
  });
  return {
    $schema:
      'https://raw.githubusercontent.com/webcomponents/custom-elements-manifest/main/schema.json',
    schemaVersion: '1.0.0',
    modules,
  };
}

/**
 * Load and validate the deterministic interop corpus, then regenerate and
 * validate its derived CEM artifact.
 */
export async function loadInteropCorpus(
  root: URL | string = defaultFixtureRoot,
): Promise<InteropCorpus> {
  const configPath = pathFromRoot(root, 'corpus.json');
  const config = await readJson<unknown>(configPath);
  const configErrors = validateCorpusConfig(config);
  if (configErrors.length > 0) {
    throw new Error(`Invalid interop corpus:\n- ${configErrors.join('\n- ')}`);
  }
  const typedConfig = config as CorpusConfig;
  const cem = generateCemManifest(typedConfig.components);
  const cemErrors = validateCemManifest(cem);
  if (cemErrors.length > 0) {
    throw new Error(`Invalid regenerated CEM output:\n- ${cemErrors.join('\n- ')}`);
  }
  const expectedTags = typedConfig.components.map((component) => component.tag);
  const actualTags = customElementTags(cem);
  if (!equalArrays(actualTags, expectedTags)) {
    throw new Error(
      `CEM tags ${JSON.stringify(actualTags)} do not match corpus tags ${JSON.stringify(
        expectedTags,
      )}`,
    );
  }
  return { ...typedConfig, cem };
}

function localPackageImports(root: string): Record<string, string> {
  const imports: Record<string, string> = {};
  try {
    const rootJson = JSON.parse(Deno.readTextFileSync(join(root, 'deno.json'))) as Record<
      string,
      unknown
    >;
    if (isRecord(rootJson.imports)) {
      for (const [specifier, target] of Object.entries(rootJson.imports)) {
        if (typeof target === 'string' && !specifier.startsWith('@openelement/')) {
          imports[specifier] = target;
        }
      }
    }
  } catch {
    // The repository root manifest is required by the build, but keep the
    // helper diagnostic-free if a caller supplies a different root.
  }
  for (const packageEntry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const packagePath = join(root, 'packages', packageEntry.name, 'deno.json');
    try {
      const packageJson = JSON.parse(Deno.readTextFileSync(packagePath)) as Record<string, unknown>;
      const packageImports = packageJson.imports;
      if (!isRecord(packageImports)) continue;
      for (const [specifier, target] of Object.entries(packageImports)) {
        if (typeof target === 'string' && !specifier.startsWith('@openelement/')) {
          imports[specifier] = target;
        }
      }
    } catch {
      // A package without a readable manifest contributes no temp-app imports.
    }
  }
  return imports;
}

async function patchApp(appDir: string): Promise<void> {
  await applyWorkspaceAliases(appDir, {
    repoRoot,
    extraImports: {
      lit: 'npm:lit@3.3.3',
      '@microsoft/fast-element': 'npm:@microsoft/fast-element@3.0.2',
      '@ionic/core': 'npm:@ionic/core@8.8.18',
      '@ionic/core/': 'npm:@ionic/core@8.8.18/',
      ...localPackageImports(repoRoot),
    },
    externalViteAliases: ['@preact/signals-core'],
  });
  // The app-local vite alias for @preact/signals-core needs its node_modules
  // entry to exist: priming installs the app's npm dependencies up front.
  await primeAppNodeModules(appDir, '@preact/signals-core');
}

const FIXTURE_SOURCE_FILES = [
  'app/routes/index.tsx',
  'app/components/page-interop-home.tsx',
  'app/islands/interop-fixture.tsx',
  'app/client/interop-client.ts',
] as const;

async function prepareInteropApp(tmpRoot: string, root: URL | string): Promise<string> {
  const appDir = await scaffoldApp({
    workDir: tmpRoot,
    projectName: appProjectName,
    createCli: join(repoRoot, 'packages', 'create', 'src', 'cli.ts'),
    copySources: { fromRoot: root, files: FIXTURE_SOURCE_FILES },
  });
  await patchApp(appDir);
  await runRouterBuild(appDir);
  return appDir;
}

async function verifySsr(appDir: string, corpus: InteropCorpus): Promise<SsrEvidence> {
  const distDir = join(appDir, 'dist');
  const htmlPath = await findFile(distDir, 'index.html');
  if (!htmlPath) throw new Error(`SSG index.html not found under ${distDir}`);
  const html = await Deno.readTextFile(htmlPath);
  const entryPath = await findServerEntry(distDir);
  const plan = extractSsrAdmissionPlan(await Deno.readTextFile(entryPath));
  const decisions = new Map(plan.decisions.map((decision) => [decision.tagName, decision]));
  const foreignComponents: SsrComponentEvidence[] = [];
  const failures: string[] = [];

  for (const component of corpus.components) {
    const escapedTag = escapeRegExp(component.tag);
    const tagPresent = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`, 'i').test(html);
    const lightDomChildPresent = html.includes(component.slotText);
    const dsdTemplate = new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>\\s*<template\\s+shadowrootmode`,
      'i',
    ).test(html);
    const decision = decisions.get(component.tag) ?? null;
    foreignComponents.push({
      tag: component.tag,
      tagPresent,
      lightDomChildPresent,
      dsdTemplate,
      admission: decision ? { renderPath: decision.renderPath, reason: decision.reason } : null,
    });
    if (!tagPresent) {
      failures.push(`${component.tag}: tag missing from SSR HTML`);
    }
    if (!lightDomChildPresent) {
      failures.push(`${component.tag}: authored light-DOM child missing`);
    }
    if (dsdTemplate) {
      failures.push(`${component.tag}: unknown foreign tag received a DSD template`);
    }
    if (!decision) {
      failures.push(`${component.tag}: no admission decision was emitted`);
    } else if (decision.renderPath !== 'client-only') {
      failures.push(`${component.tag}: admission=${decision.renderPath}, expected client-only`);
    }
  }

  const fixtureTag = corpus.application.fixtureTag;
  const escapedFixture = escapeRegExp(fixtureTag);
  const fixtureTagPresent = new RegExp(`<${escapedFixture}(?:\\s[^>]*)?>`, 'i').test(html);
  const fixtureDsd = new RegExp(
    `<${escapedFixture}(?:\\s[^>]*)?>\\s*<template\\s+shadowrootmode`,
    'i',
  ).test(html);
  if (!fixtureTagPresent) {
    failures.push(`${fixtureTag}: OpenElement fixture missing from SSR HTML`);
  }
  if (!fixtureDsd) {
    failures.push(`${fixtureTag}: expected DSD fixture root missing`);
  }
  if (failures.length > 0) {
    throw new Error(`SSR interoperability mismatches:\n- ${failures.join('\n- ')}`);
  }
  return {
    htmlPath: 'dist/index.html',
    fixture: {
      tag: fixtureTag,
      tagPresent: fixtureTagPresent,
      dsdTemplate: fixtureDsd,
    },
    foreignComponents,
  };
}

export async function verifyBrowser(
  distDir: string,
  corpus: InteropCorpus,
  browserName: BrowserName,
): Promise<BrowserEvidence> {
  const session = await launchQualifyBrowser({ distDir, browserName });
  try {
    const page = await session.browser.newPage();
    session.watchPageErrors(page);
    const pageErrors = session.pageErrors;
    await page.goto(`${session.origin}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        (
          globalThis as typeof globalThis & {
            __interopState?: { ready?: boolean };
          }
        ).__interopState?.ready === true,
      undefined,
      { timeout: 20_000 },
    );

    const components = corpus.components.map((component) => ({
      framework: component.framework,
      tag: component.tag,
      property: component.property,
      attribute: component.attribute,
      event: component.event,
      slotText: component.slotText,
      cssPart: component.cssPart,
      ids: component.ids,
      placements: component.placements,
    }));
    const observed = await page.evaluate(async (input) => {
      type Placement = 'child' | 'application-dependency';
      type ComponentInput = {
        framework: string;
        tag: string;
        property: string;
        attribute: string;
        event: string;
        slotText: string;
        cssPart: string;
        ids: Record<Placement, string>;
        placements: Placement[];
      };
      type UpgradeEntry = { phase: string; tag: string; id: string };
      const componentInput = input as ComponentInput[];

      const findTag = (root: Document | ShadowRoot, tag: string): HTMLElement | null => {
        const direct = root.querySelector(tag);
        if (direct) return direct as HTMLElement;
        for (const element of root.querySelectorAll('*')) {
          const shadow = (element as HTMLElement).shadowRoot;
          if (!shadow) continue;
          const found = findTag(shadow, tag);
          if (found) return found;
        }
        return null;
      };
      const fixture = findTag(document, 'interop-fixture');
      const fixtureRoot = fixture?.shadowRoot;
      if (!fixtureRoot) {
        throw new Error('interop-fixture shadow root is missing');
      }
      const childHost = fixtureRoot.querySelector('#children') as HTMLElement | null;
      const childSlot = childHost?.shadowRoot?.querySelector('slot') as HTMLSlotElement | null;
      const childHostWorks =
        !!childHost &&
        !!childHost.shadowRoot &&
        (childSlot?.assignedElements().length ?? 0) === componentInput.length;
      const state = (
        globalThis as typeof globalThis & {
          __interopState?: {
            upgradeOrder?: UpgradeEntry[];
            events?: string[];
            existingIdentity?: Record<string, boolean>;
            existingLiveState?: Record<string, boolean>;
          };
        }
      ).__interopState;
      const upgradeOrder = state?.upgradeOrder ?? [];
      const results: Array<{
        id: string;
        tag: string;
        placement: Placement;
        upgraded: boolean;
        propertyAttribute: boolean;
        event: boolean;
        slot: boolean;
        cssPart: boolean;
        root: boolean;
        upgradeOrder: boolean;
        identityPreserved: boolean;
        liveStatePreserved: boolean;
        propertyValue?: string | boolean;
        attributeValue?: string | null;
        assignedSlotNodes?: number;
      }> = [];

      for (const component of componentInput) {
        for (const placement of component.placements) {
          const id = component.ids[placement];
          const element = fixtureRoot.querySelector(`#${id}`) as HTMLElement | null;
          if (!element) {
            results.push({
              id,
              tag: component.tag,
              placement,
              upgraded: false,
              propertyAttribute: false,
              event: false,
              slot: false,
              cssPart: false,
              root: false,
              upgradeOrder: false,
              identityPreserved: false,
              liveStatePreserved: false,
            });
            continue;
          }
          const shadow = element.shadowRoot;
          let propertyAttribute = false;
          let propertyValue: string | boolean;
          let attributeValue: string | null;
          if (component.property === 'disabled') {
            element.setAttribute(component.attribute, '');
            await Promise.resolve();
            propertyValue =
              (element as HTMLElement & Record<string, unknown>)[component.property] === true
                ? true
                : false;
            attributeValue = element.getAttribute(component.attribute);
            propertyAttribute = propertyValue === true && element.hasAttribute(component.attribute);
            element.removeAttribute(component.attribute);
          } else {
            const value = `${placement}-${component.framework}-property`;
            (element as HTMLElement & Record<string, unknown>)[component.property] = value;
            const updateComplete = (element as HTMLElement & { updateComplete?: Promise<unknown> })
              .updateComplete;
            if (updateComplete) await updateComplete;
            propertyValue = String(
              (element as HTMLElement & Record<string, unknown>)[component.property],
            );
            attributeValue = element.getAttribute(component.attribute);
            propertyAttribute =
              element.getAttribute(component.attribute) === value && propertyValue === value;
          }

          const slots = Array.from(shadow?.querySelectorAll('slot') ?? []) as HTMLSlotElement[];
          const assignedSlotNodes = slots.reduce(
            (count, slot) => count + slot.assignedNodes({ flatten: true }).length,
            0,
          );
          const slotWorks = slots.some((slot) =>
            slot
              .assignedNodes({ flatten: true })
              .some((node) => node.textContent?.includes(component.slotText) === true),
          );
          const partWorks =
            !!shadow &&
            Array.from(shadow.querySelectorAll('[part]')).some((part) =>
              (part.getAttribute('part') ?? '').split(/\s+/).includes(component.cssPart),
            );
          let eventObserved = false;
          element.addEventListener(component.event, () => (eventObserved = true));
          const control = shadow?.querySelector('[part]') as HTMLElement | null;
          control?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (component.event === 'click' && !eventObserved) element.click();
          const entries = upgradeOrder.filter((entry) => entry.id === id);
          const constructorIndex = entries.findIndex((entry) => entry.phase === 'constructor');
          const connectedIndex = entries.findIndex((entry) => entry.phase === 'connected');
          results.push({
            id,
            tag: component.tag,
            placement,
            upgraded:
              customElements.get(component.tag) !== undefined &&
              element.constructor !== HTMLElement,
            propertyAttribute,
            event: eventObserved,
            slot: slotWorks,
            cssPart: partWorks,
            root: !!shadow,
            upgradeOrder: constructorIndex >= 0 && connectedIndex > constructorIndex,
            identityPreserved: state?.existingIdentity?.[id] === true,
            liveStatePreserved: state?.existingLiveState?.[id] === true,
            propertyValue,
            attributeValue,
            assignedSlotNodes,
          });
        }
      }
      type FreshResult = {
        id: string;
        tag: string;
        upgraded: boolean;
        propertyAttribute: boolean;
        event: boolean;
        slot: boolean;
        cssPart: boolean;
        root: boolean;
        upgradeOrder: boolean;
        propertyValue?: string | boolean;
        attributeValue?: string | null;
        assignedSlotNodes?: number;
      };
      const fresh: FreshResult[] = [];
      const freshRoot = fixtureRoot.querySelector('#fresh-probes') as HTMLElement | null;
      if (freshRoot) {
        for (const component of componentInput) {
          const id = `fresh-${component.tag}`;
          const upgradeStart = upgradeOrder.length;
          const element = document.createElement(component.tag) as HTMLElement;
          element.id = id;
          element.textContent = component.slotText;
          freshRoot.appendChild(element);

          let propertyAttribute = false;
          let propertyValue: string | boolean;
          let attributeValue: string | null;
          if (component.property === 'disabled') {
            element.setAttribute(component.attribute, '');
            await Promise.resolve();
            propertyValue =
              (element as HTMLElement & Record<string, unknown>)[component.property] === true
                ? true
                : false;
            attributeValue = element.getAttribute(component.attribute);
            propertyAttribute = propertyValue === true && element.hasAttribute(component.attribute);
            element.removeAttribute(component.attribute);
          } else {
            const value = `fresh-${component.framework}-property`;
            (element as HTMLElement & Record<string, unknown>)[component.property] = value;
            const updateComplete = (element as HTMLElement & { updateComplete?: Promise<unknown> })
              .updateComplete;
            if (updateComplete) await updateComplete;
            propertyValue = String(
              (element as HTMLElement & Record<string, unknown>)[component.property],
            );
            attributeValue = element.getAttribute(component.attribute);
            propertyAttribute =
              element.getAttribute(component.attribute) === value && propertyValue === value;
          }

          const shadow = element.shadowRoot;
          const slots = Array.from(shadow?.querySelectorAll('slot') ?? []) as HTMLSlotElement[];
          const assignedSlotNodes = slots.reduce(
            (count, slot) => count + slot.assignedNodes({ flatten: true }).length,
            0,
          );
          const slotWorks = slots.some((slot) =>
            slot
              .assignedNodes({ flatten: true })
              .some((node) => node.textContent?.includes(component.slotText) === true),
          );
          const partWorks =
            !!shadow &&
            Array.from(shadow.querySelectorAll('[part]')).some((part) =>
              (part.getAttribute('part') ?? '').split(/\s+/).includes(component.cssPart),
            );
          let eventObserved = false;
          element.addEventListener(component.event, () => (eventObserved = true));
          const control = shadow?.querySelector('[part]') as HTMLElement | null;
          control?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (component.event === 'click' && !eventObserved) element.click();
          const entries = upgradeOrder.slice(upgradeStart);
          const constructorIndex = entries.findIndex(
            (entry) => entry.phase === 'constructor' && entry.tag === component.tag,
          );
          const connectedIndex = entries.findIndex(
            (entry) => entry.phase === 'connected' && entry.id === id,
          );
          fresh.push({
            id,
            tag: component.tag,
            upgraded:
              customElements.get(component.tag) !== undefined &&
              element.constructor !== HTMLElement,
            propertyAttribute,
            event: eventObserved,
            slot: slotWorks,
            cssPart: partWorks,
            root: !!shadow,
            upgradeOrder: constructorIndex >= 0 && connectedIndex > constructorIndex,
            propertyValue,
            attributeValue,
            assignedSlotNodes,
          });
        }
      }
      const dependencyRoot = fixtureRoot.querySelector('#application-dependencies');
      const dependencyTags = componentInput.map((component) => component.tag);
      const dependencyWorks =
        !!dependencyRoot &&
        componentInput.every((component) => {
          const element = dependencyRoot.querySelector(
            `#${component.ids['application-dependency']}`,
          );
          return (
            !!element &&
            element.parentElement === dependencyRoot &&
            element.localName === component.tag
          );
        });
      return {
        childHost:
          childHostWorks && dependencyWorks && dependencyTags.length === componentInput.length,
        freshRoot:
          !!freshRoot &&
          fresh.length === componentInput.length &&
          fresh.every((component) => {
            const element = freshRoot.querySelector(`#${component.id}`);
            return !!element && element.parentElement === freshRoot;
          }),
        components: results,
        fresh,
        upgradeOrder: upgradeOrder.map((entry) => `${entry.phase}:${entry.tag}#${entry.id}`),
      };
    }, components);

    if (pageErrors.length > 0) {
      throw new Error(`${browserName}: browser errors: ${pageErrors.join(' | ')}`);
    }
    const failedComponents = observed.components.filter(
      (component) =>
        !component.upgraded ||
        !component.propertyAttribute ||
        !component.event ||
        !component.slot ||
        !component.cssPart ||
        !component.root ||
        !component.upgradeOrder ||
        !component.identityPreserved ||
        !component.liveStatePreserved,
    );
    if (!observed.childHost) {
      throw new Error(`${browserName}: child/dependency placement probe failed`);
    }
    const failedFresh = observed.fresh.filter(
      (component) =>
        !component.upgraded ||
        !component.propertyAttribute ||
        !component.event ||
        !component.slot ||
        !component.cssPart ||
        !component.root ||
        !component.upgradeOrder,
    );
    if (!observed.freshRoot || failedFresh.length > 0) {
      throw new Error(`${browserName}: fresh DOM probes failed: ${JSON.stringify(failedFresh)}`);
    }
    if (failedComponents.length > 0) {
      throw new Error(
        `${browserName}: component probes failed: ${JSON.stringify(failedComponents)}`,
      );
    }
    return {
      browser: browserName,
      childHost: observed.childHost,
      components: observed.components,
      fresh: observed.fresh,
      upgradeOrder: observed.upgradeOrder,
      pageErrors,
    };
  } finally {
    await session.close();
  }
}

async function qualify(
  root: URL | string = defaultFixtureRoot,
): Promise<InteropQualificationEvidence> {
  const corpus = await loadInteropCorpus(root);
  const admission = Object.fromEntries(
    corpus.components.map((component) => [component.tag, classifySsrCapability(undefined)]),
  ) as Record<string, SsrCapabilityDecision>;
  const tmpRoot = await Deno.makeTempDir({
    prefix: 'openelement-web-component-interop-',
  });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_INTEROP') === '1';
  try {
    const appDir = await prepareInteropApp(tmpRoot, root);
    const ssr = await verifySsr(appDir, corpus);
    const browsers = {} as Record<BrowserName, BrowserEvidence>;
    for (const browserName of browserNames) {
      browsers[browserName] = await verifyBrowser(join(appDir, 'dist'), corpus, browserName);
    }
    const evidence: InteropQualificationEvidence = {
      schemaVersion: 1,
      source: 'tests/fixtures/web-component-interop/qualify.ts',
      corpus: {
        frameworks: corpus.components.map((component) => component.framework),
        componentCount: corpus.components.length,
        probes: [...requiredProbes],
        placements: [...requiredPlacements],
      },
      cem: {
        schemaVersion: corpus.cem.schemaVersion,
        tags: customElementTags(corpus.cem),
      },
      ssr,
      admission,
      browsers,
    };
    // Generated artifacts land in the temporary work directory only: the CEM
    // is regenerated from corpus.json and the evidence is regenerated on
    // every run. Neither is committed (see .gitignore).
    await Deno.writeTextFile(join(tmpRoot, 'compiler-output.cem.json'), jsonText(corpus.cem));
    await Deno.writeTextFile(join(tmpRoot, 'interop-evidence.json'), jsonText(evidence));
    console.log(JSON.stringify(evidence, null, 2));
    console.log('Web Components interoperability qualification passed');
    return evidence;
  } finally {
    if (keep) console.log(`Keeping interop temporary app at ${tmpRoot}`);
    else await Deno.remove(tmpRoot, { recursive: true });
  }
}

if (import.meta.main) {
  await qualify();
}
