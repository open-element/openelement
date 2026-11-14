#!/usr/bin/env node
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

import { readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CustomElementDeclaration,
  CustomElementField,
  JavaScriptModule,
  Package as CemPackage,
} from 'custom-elements-manifest';
import { extractSsrAdmissionPlan } from '../../lib/qualify-harness/admission-plan.ts';
import { findServerEntry, runRouterBuild } from '../../lib/qualify-harness/build-router.ts';
import { launchQualifyBrowser } from '../../lib/qualify-harness/drive-chromium.ts';
import { jsonText, readJson } from '../../lib/qualify-harness/json-file.ts';
import { pathFromRoot, scaffoldApp } from '../../lib/qualify-harness/scaffold-app.ts';
import {
  applyWorkspaceAliases,
  installAppDependencies,
} from '../../lib/qualify-harness/workspace-alias.ts';
import { escapeRegExp } from '../../../tools/lib/text.ts';

/**
 * The regenerated CEM artifact, typed by the upstream Custom Elements
 * Manifest schema package — the generic metadata authority for tags,
 * attributes, members, events, slots, and CSS parts. `$schema` is the one
 * customary field the upstream `Package` interface does not declare.
 */
export type InteropCemManifest = CemPackage & { $schema?: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
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

/**
 * The admission-plan reason the build writes for a local island whose sidecar
 * declares `ssr: false` (island-scanner.ts writes it as scanned island
 * metadata). Pinned as data because it records the M09-3 client-only boundary:
 * entry-level DSD SSR for generated islands (the `__ssrHost` call target) has
 * no production caller yet and belongs to M11 wiring, so this fixture must not
 * pretend the host is server-rendered.
 */
const GENERATED_HOST_CLIENT_ONLY_REASON = 'local island exports openElement.ssr=false';

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

/**
 * The M09-3 generated-host block: the real generated Native Custom Element
 * (compiled from the function island by the M09-1 lane) hosts the four
 * canonical foreign probe tags as its light DOM children, and the authored
 * caption is the named-slot projection.
 */
export interface GeneratedHostConfig {
  /** The generated island's derived tag (`app/islands/interop-generated-host.tsx`). */
  tag: string;
  /** The host element's page id. */
  id: string;
  /** The authored named-slot light child's id. */
  lightCaptionId: string;
  /** The named slot the caption is assigned to. */
  captionSlotName: string;
  /** The authored shadow control's id. */
  controlId: string;
  /** The authored shadow control's `part` token. */
  controlPart: string;
  /** The global state counter the authored `onClick` handler increments. */
  hitsStateKey: string;
  /** The generated-host placement id of each foreign framework's probe. */
  ids: Record<InteropFramework, string>;
}

interface CorpusConfig {
  schemaVersion: number;
  cem: string;
  application: InteropApplication;
  generatedHost: GeneratedHostConfig;
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

/** The generated host's SSR form: a plain tag with the authored light children. */
export interface GeneratedHostSsrEvidence {
  tag: string;
  id: string;
  /** The rendered host tag carries exactly the corpus host id. */
  idMatches: boolean;
  tagPresent: boolean;
  lightCaptionPresent: boolean;
  lightChildrenPresent: Record<InteropFramework, boolean>;
  dsdTemplate: boolean;
  admission: { renderPath: string; reason: string } | null;
}

export interface SsrEvidence {
  htmlPath: string;
  fixture: { tag: string; tagPresent: boolean; dsdTemplate: boolean };
  foreignComponents: SsrComponentEvidence[];
  generatedHost: GeneratedHostSsrEvidence;
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

/**
 * One foreign probe rendered as the generated host's light child. The seven
 * probes are the same contract as the two canonical placements; the extra
 * `eventReachedDocument` fact proves the probe's own composed event crosses the
 * generated host boundary to the document without any host-dispatched event.
 */
interface GeneratedHostComponentEvidence {
  id: string;
  tag: string;
  framework: InteropFramework;
  upgraded: boolean;
  propertyAttribute: boolean;
  event: boolean;
  slot: boolean;
  cssPart: boolean;
  root: boolean;
  upgradeOrder: boolean;
  identityPreserved: boolean;
  liveStatePreserved: boolean;
  eventReachedDocument: boolean;
  propertyValue?: string | boolean;
  attributeValue?: string | null;
  assignedSlotNodes?: number;
}

/** Host-level facts that only the generated Native CE can provide (M09-3). */
interface GeneratedHostEvidence {
  tag: string;
  id: string;
  /** The live host element carries exactly the corpus host id. */
  hostIdMatches: boolean;
  hostDefined: boolean;
  hostUpgraded: boolean;
  shadowRoot: boolean;
  captionSlotAssigned: boolean;
  defaultSlotAssigned: boolean;
  defaultSlotAssignedIds: string[];
  controlPartPresent: boolean;
  controlPartToken: string | null;
  authoredNoDomHandlerAttribute: boolean;
  authoredHandlerHits: number;
  authoredClickCrossedShadowBoundary: boolean;
  foreignTagsRegisteredBeforeFixtureClient: boolean;
  components: GeneratedHostComponentEvidence[];
}

export interface BrowserEvidence {
  browser: BrowserName;
  /** The exact engine build reported by Playwright (LOCAL evidence, not CI identity). */
  browserVersion: string;
  childHost: boolean;
  components: BrowserComponentEvidence[];
  fresh: BrowserFreshComponentEvidence[];
  generatedHost: GeneratedHostEvidence;
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

  // The M09-3 generated-host block is validated with the same fail-closed
  // discipline as the canonical corpus: it is hand-maintained source, and a
  // missing or colliding id would silently turn a browser probe into a no-op.
  const generatedHost = raw.generatedHost;
  if (!isRecord(generatedHost)) {
    errors.push('corpus generatedHost must be an object');
    return errors;
  }
  for (const field of [
    'tag',
    'id',
    'lightCaptionId',
    'captionSlotName',
    'controlId',
    'controlPart',
    'hitsStateKey',
  ]) {
    if (!stringField(generatedHost, field)) {
      errors.push(`corpus.generatedHost.${field} must be a string`);
    }
  }
  const generatedHostTag = stringField(generatedHost, 'tag');
  if (!validCustomElementTag(generatedHostTag)) {
    errors.push('corpus.generatedHost.tag is not a valid custom-element tag');
  } else if (seenTags.has(generatedHostTag)) {
    errors.push(`corpus.generatedHost.tag collides with corpus component ${generatedHostTag}`);
  }

  const generatedIds = generatedHost.ids;
  if (!isRecord(generatedIds)) {
    errors.push('corpus.generatedHost.ids must cover native, lit, fast, stencil');
    return errors;
  }
  const usedIds = new Set<string>();
  for (const field of ['id', 'lightCaptionId', 'controlId']) {
    const value = stringField(generatedHost, field);
    if (value !== undefined) usedIds.add(value);
  }
  for (const component of components) {
    if (!isRecord(component) || !isRecord(component.ids)) continue;
    for (const placement of requiredPlacements) {
      const value = stringField(component.ids, placement);
      if (value !== undefined) usedIds.add(value);
    }
  }
  for (const framework of requiredFrameworks) {
    const id = stringField(generatedIds, framework);
    if (id === undefined) {
      errors.push(`corpus.generatedHost.ids.${framework} must be a string`);
      continue;
    }
    if (usedIds.has(id)) {
      errors.push(`corpus.generatedHost.ids.${framework} duplicates the DOM id ${id}`);
    }
    usedIds.add(id);
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

async function patchApp(appDir: string): Promise<void> {
  await applyWorkspaceAliases(appDir, {
    repoRoot,
    extraImports: {
      lit: 'npm:lit@3.3.3',
      '@microsoft/fast-element': 'npm:@microsoft/fast-element@3.0.2',
      '@ionic/core': 'npm:@ionic/core@8.8.18',
      // The app-local vite alias for @preact/signals-core needs its
      // node_modules entry to exist: the install below materializes it.
      '@preact/signals-core': 'npm:@preact/signals-core@^1.12.1',
    },
    externalViteAliases: ['@preact/signals-core'],
  });
  await installAppDependencies(appDir);
}

const FIXTURE_SOURCE_FILES = [
  'app/routes/index.tsx',
  'app/components/page-interop-home.tsx',
  'app/islands/interop-fixture.tsx',
  'app/islands/interop-generated-host.tsx',
  'app/client/interop-client.ts',
] as const;

async function prepareInteropApp(tmpRoot: string, root: URL | string): Promise<string> {
  const appDir = await scaffoldApp({
    workDir: tmpRoot,
    projectName: appProjectName,
    createCli: join(repoRoot, 'packages', 'create', 'src', 'cli.ts'),
    // --no-install: the scaffold's default install resolves `^<version>`
    // framework ranges against the registry, and the candidate version is
    // unpublished at gate time — that install is the release:check
    // ERR_PNPM_NO_MATCHING_VERSION trap (T3). applyWorkspaceAliases rewrites
    // those deps to workspace `link:` entries and installAppDependencies below
    // runs the real install against them.
    extraArgs: ['--no-install'],
    copySources: { fromRoot: root, files: FIXTURE_SOURCE_FILES },
  });
  await patchApp(appDir);
  await runRouterBuild(appDir);
  return appDir;
}

/**
 * Read the ROOT page's generated HTML (`dist/index.html`).
 *
 * The qualification's SSR assertions describe the fixture route `/`. A tree
 * walk that returns the first `index.html` it meets is order-dependent, and on
 * case-insensitive macOS volumes `dist/about/index.html` sorts before
 * `dist/index.html`. The canonical build output path is therefore read
 * directly, and a missing root page is a hard failure: silently asserting
 * against another route's page would turn the SSR contract into a false pass
 * or an unexplainable mismatch, so this never guesses.
 */
async function readRootPageHtml(distDir: string): Promise<string> {
  const rootPagePath = join(distDir, 'index.html');
  try {
    return await readFile(rootPagePath, 'utf8');
  } catch {
    throw new Error(
      `SSG root page missing at ${rootPagePath} (canonical dist layout); refusing to ` +
        'fall back to another index.html because the SSR assertions must read the fixture route "/"',
    );
  }
}

async function verifySsr(appDir: string, corpus: InteropCorpus): Promise<SsrEvidence> {
  const distDir = join(appDir, 'dist');
  const html = await readRootPageHtml(distDir);
  const entryPath = await findServerEntry(distDir);
  const plan = extractSsrAdmissionPlan(await readFile(entryPath, 'utf8'));
  const decisions = new Map(plan.decisions.map((decision) => [decision.tagName, decision]));
  const foreignComponents: SsrComponentEvidence[] = [];
  const failures: string[] = [];

  // The canonical fixture island's region. The generated-host block authors the
  // same foreign tags and the same child texts, so the pre-existing
  // `html.includes` / root-tag checks stay green even if the canonical
  // placement regresses. Every pre-existing foreign-tag assertion therefore
  // reads ONLY this region; the generated-host block has its own scoped region
  // below.
  const fixtureTag = corpus.application.fixtureTag;
  const escapedFixture = escapeRegExp(fixtureTag);
  const fixtureTagPattern = new RegExp(`<${escapedFixture}(?:\\s[^>]*)?>`, 'i');
  const fixtureTagPresent = fixtureTagPattern.test(html);
  const fixtureOpen = html.search(fixtureTagPattern);
  const fixtureClose = html.lastIndexOf(`</${fixtureTag}>`);
  const fixtureRegion =
    fixtureOpen >= 0 && fixtureClose > fixtureOpen ? html.slice(fixtureOpen, fixtureClose) : '';
  if (fixtureRegion === '') {
    failures.push(`${fixtureTag}: canonical fixture region missing from SSR HTML`);
  }

  for (const component of corpus.components) {
    const escapedTag = escapeRegExp(component.tag);
    const tagPresent = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`, 'i').test(fixtureRegion);
    const lightDomChildPresent = fixtureRegion.includes(component.slotText);
    const dsdTemplate = new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>\\s*<template\\s+shadowrootmode`,
      'i',
    ).test(fixtureRegion);
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

  // M09-3 generated-host block. The generated island declares `ssr: false`
  // (M11 wiring owns entry-level DSD SSR), so its only honest server form is a
  // plain host tag carrying the authored light children; the admission plan
  // must say client-only and must not list the tag as renderable.
  const generated = corpus.generatedHost;
  const escapedGenerated = escapeRegExp(generated.tag);
  const generatedTagPattern = new RegExp(`<${escapedGenerated}(?:\\s[^>]*)?>`, 'i');
  const generatedTagPresent = generatedTagPattern.test(html);
  const generatedDsdTemplate = new RegExp(
    `<${escapedGenerated}(?:\\s[^>]*)?>\\s*<template\\s+shadowrootmode`,
    'i',
  ).test(html);
  const generatedOpen = html.search(generatedTagPattern);
  const generatedClose = html.lastIndexOf(`</${generated.tag}>`);
  const generatedRegion =
    generatedOpen >= 0 && generatedClose > generatedOpen
      ? html.slice(generatedOpen, generatedClose)
      : '';
  const generatedOpenTag = new RegExp(`<${escapedGenerated}([^>]*)>`, 'i').exec(html);
  const generatedIdMatches =
    generatedOpenTag !== null &&
    new RegExp(`\\sid="${escapeRegExp(generated.id)}"`, 'i').test(generatedOpenTag[1] ?? '');
  const escapedCaption = escapeRegExp(generated.lightCaptionId);
  const escapedSlotName = escapeRegExp(generated.captionSlotName);
  const lightCaptionPresent =
    new RegExp(`<span[^>]*\\sid="${escapedCaption}"[^>]*\\sslot="${escapedSlotName}"`, 'i').test(
      generatedRegion,
    ) ||
    new RegExp(`<span[^>]*\\sslot="${escapedSlotName}"[^>]*\\sid="${escapedCaption}"`, 'i').test(
      generatedRegion,
    );
  const lightChildrenPresent = Object.fromEntries(
    corpus.components.map((component) => {
      const id = escapeRegExp(generated.ids[component.framework]);
      const tag = escapeRegExp(component.tag);
      return [
        component.framework,
        new RegExp(`<${tag}[^>]*\\sid="${id}"`, 'i').test(generatedRegion),
      ];
    }),
  ) as Record<InteropFramework, boolean>;
  const generatedDecision = decisions.get(generated.tag) ?? null;
  const generatedHostEvidence: GeneratedHostSsrEvidence = {
    tag: generated.tag,
    id: generated.id,
    idMatches: generatedIdMatches,
    tagPresent: generatedTagPresent,
    lightCaptionPresent,
    lightChildrenPresent,
    dsdTemplate: generatedDsdTemplate,
    admission: generatedDecision
      ? { renderPath: generatedDecision.renderPath, reason: generatedDecision.reason }
      : null,
  };

  if (!generatedTagPresent) {
    failures.push(`${generated.tag}: generated host tag missing from SSR HTML`);
  }
  if (!generatedIdMatches) {
    failures.push(
      `${generated.tag}: generated host id is not ${JSON.stringify(generated.id)} in SSR HTML`,
    );
  }
  if (generatedOpen < 0 || generatedClose <= generatedOpen) {
    failures.push(`${generated.tag}: generated host is not a plain tag carrying light children`);
  }
  if (generatedDsdTemplate) {
    failures.push(
      `${generated.tag}: generated host received a DSD template (client-only boundary violated)`,
    );
  }
  if (!lightCaptionPresent) {
    failures.push(`${generated.lightCaptionId}: authored named-slot light child missing`);
  }
  for (const framework of requiredFrameworks) {
    if (!lightChildrenPresent[framework]) {
      failures.push(
        `${generated.ids[framework]}: ${framework} probe missing from the generated host's light DOM`,
      );
    }
  }
  if (!generatedDecision) {
    failures.push(`${generated.tag}: no admission decision was emitted`);
  } else if (generatedDecision.renderPath !== 'client-only') {
    failures.push(
      `${generated.tag}: admission=${generatedDecision.renderPath}, expected client-only`,
    );
  } else if (generatedDecision.reason !== GENERATED_HOST_CLIENT_ONLY_REASON) {
    failures.push(
      `${generated.tag}: admission reason=${JSON.stringify(generatedDecision.reason)}, ` +
        `expected ${JSON.stringify(GENERATED_HOST_CLIENT_ONLY_REASON)}`,
    );
  }
  if (!plan.clientOnlyTags.includes(generated.tag)) {
    failures.push(`${generated.tag}: tag is not in the admission plan's client-only set`);
  }
  if (plan.renderableTags.includes(generated.tag)) {
    failures.push(
      `${generated.tag}: tag was admitted as server-rendered without entry-level DSD SSR`,
    );
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
    generatedHost: generatedHostEvidence,
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

    // The generated host is a real compiled Native CE registered by its island
    // client entry; its shadow root is mounted by the shell on upgrade. Wait
    // for both facts with a bounded, fail-closed timeout: a missing define or
    // shadow root must report the generated host boundary, never silently skip
    // the M09-3 probes.
    const generatedHostInput = {
      tag: corpus.generatedHost.tag,
      id: corpus.generatedHost.id,
      lightCaptionId: corpus.generatedHost.lightCaptionId,
      captionSlotName: corpus.generatedHost.captionSlotName,
      controlId: corpus.generatedHost.controlId,
      controlPart: corpus.generatedHost.controlPart,
      hitsStateKey: corpus.generatedHost.hitsStateKey,
      ids: corpus.generatedHost.ids,
    };
    try {
      await page.waitForFunction(
        (tag) => {
          if (customElements.get(tag) === undefined) return false;
          const find = (root: Document | ShadowRoot): HTMLElement | null => {
            const direct = root.querySelector(tag) as HTMLElement | null;
            if (direct) return direct;
            for (const element of root.querySelectorAll('*')) {
              const shadow = (element as HTMLElement).shadowRoot;
              if (!shadow) continue;
              const found = find(shadow);
              if (found) return found;
            }
            return null;
          };
          const host = find(document);
          return host !== null && host.shadowRoot !== null;
        },
        generatedHostInput.tag,
        { timeout: 20_000 },
      );
    } catch (error) {
      // Fail closed with the tag and the recorded admission boundary instead
      // of a bare timeout: a generated island that never defines, or defines
      // without a mounted shadow root, must be named here.
      throw new Error(
        `${browserName}: generated host <${generatedHostInput.tag}> did not define a mounted ` +
          `shadow root within the bounded wait (client-only island, admission reason ` +
          `${JSON.stringify(GENERATED_HOST_CLIENT_ONLY_REASON)}; entry-level DSD SSR is M11 wiring): ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }

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
    const evaluateInput = { components, generatedHost: generatedHostInput };
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
      type GeneratedHostInput = {
        tag: string;
        id: string;
        lightCaptionId: string;
        captionSlotName: string;
        controlId: string;
        controlPart: string;
        hitsStateKey: string;
        ids: Record<string, string>;
      };
      type GeneratedHostFramework = 'native' | 'lit' | 'fast' | 'stencil';
      type GeneratedHostComponentResult = {
        id: string;
        tag: string;
        framework: GeneratedHostFramework;
        upgraded: boolean;
        propertyAttribute: boolean;
        event: boolean;
        slot: boolean;
        cssPart: boolean;
        root: boolean;
        upgradeOrder: boolean;
        identityPreserved: boolean;
        liveStatePreserved: boolean;
        eventReachedDocument: boolean;
        propertyValue?: string | boolean;
        attributeValue?: string | null;
        assignedSlotNodes?: number;
      };
      type UpgradeEntry = { phase: string; tag: string; id: string };
      const componentInput = input.components as ComponentInput[];
      const generatedHostInput = input.generatedHost as GeneratedHostInput;

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
            generatedExistingIdentity?: Record<string, boolean>;
            generatedExistingLiveState?: Record<string, boolean>;
            foreignTagsRegisteredBeforeFixtureClient?: boolean;
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

      // ---- M09-3 generated host block -----------------------------------
      // The real generated Native CE hosts the four foreign probes as light
      // children. The host's authored shadow projects them through native
      // slots; everything below is a platform fact, not a host-dispatched
      // custom-event vocabulary (D-events stays closed).
      const generatedHostElement = findTag(document, generatedHostInput.tag);
      const generatedRoot = generatedHostElement?.shadowRoot ?? null;
      const hostIdMatches = generatedHostElement?.id === generatedHostInput.id;
      const generatedCaptionSlot = generatedRoot
        ? (generatedRoot.querySelector(
            `slot[name="${generatedHostInput.captionSlotName}"]`,
          ) as HTMLSlotElement | null)
        : null;
      const captionSlotAssigned = generatedCaptionSlot
        ? generatedCaptionSlot
            .assignedElements()
            .some((element) => (element as HTMLElement).id === generatedHostInput.lightCaptionId)
        : false;
      const generatedDefaultSlots = generatedRoot
        ? (Array.from(generatedRoot.querySelectorAll('slot')) as HTMLSlotElement[]).filter(
            (slot) => !slot.hasAttribute('name'),
          )
        : [];
      const generatedDefaultSlot =
        generatedDefaultSlots.length === 1 ? generatedDefaultSlots[0]! : null;
      const defaultSlotAssignedIds = generatedDefaultSlot
        ? generatedDefaultSlot.assignedElements().map((element) => (element as HTMLElement).id)
        : [];
      const expectedGeneratedIds = Object.values(generatedHostInput.ids);
      const defaultSlotAssigned =
        defaultSlotAssignedIds.length === expectedGeneratedIds.length &&
        expectedGeneratedIds.every((id) => defaultSlotAssignedIds.includes(id));

      const generatedControl = generatedRoot
        ? (generatedRoot.querySelector(`#${generatedHostInput.controlId}`) as HTMLElement | null)
        : null;
      const controlPartToken = generatedControl?.getAttribute('part') ?? null;
      const controlPartPresent =
        !!generatedRoot &&
        !!generatedRoot.querySelector(`[part="${generatedHostInput.controlPart}"]`) &&
        (controlPartToken ?? '').split(/\s+/).includes(generatedHostInput.controlPart);
      const authoredNoDomHandlerAttribute = generatedControl
        ? !Array.from(generatedControl.attributes).some((attribute) => /^on/i.test(attribute.name))
        : false;

      const authoredClickPaths: Array<{
        host: boolean;
        root: boolean;
        control: boolean;
      }> = [];
      const onAuthoredClick = (event: Event): void => {
        authoredClickPaths.push({
          host:
            generatedHostElement !== null && event.composedPath().includes(generatedHostElement),
          root: generatedRoot !== null && event.composedPath().includes(generatedRoot),
          control: generatedControl !== null && event.composedPath().includes(generatedControl),
        });
      };
      // The counter key is corpus data (`hitsStateKey`), read dynamically:
      // the fixture must not quietly depend on a second hard-coded name that
      // only the browser probe and the authored island share.
      const hitsState = state as unknown as Record<string, unknown> | undefined;
      const readGeneratedHits = (): number => {
        const value = hitsState?.[generatedHostInput.hitsStateKey];
        return typeof value === 'number' ? value : 0;
      };
      const hitsBefore = readGeneratedHits();
      document.addEventListener('click', onAuthoredClick);
      generatedControl?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.removeEventListener('click', onAuthoredClick);
      const authoredHandlerHits = readGeneratedHits() - hitsBefore;
      const authoredClickCrossedShadowBoundary = authoredClickPaths.some(
        (path) => path.host && path.root && path.control,
      );

      const generatedComponents: GeneratedHostComponentResult[] = [];
      for (const component of componentInput) {
        const id = generatedHostInput.ids[component.framework] ?? '';
        const element = generatedHostElement
          ? (generatedHostElement.querySelector(`#${id}`) as HTMLElement | null)
          : null;
        if (!element) {
          generatedComponents.push({
            id,
            tag: component.tag,
            framework: component.framework as GeneratedHostFramework,
            upgraded: false,
            propertyAttribute: false,
            event: false,
            slot: false,
            cssPart: false,
            root: false,
            upgradeOrder: false,
            identityPreserved: false,
            liveStatePreserved: false,
            eventReachedDocument: false,
          });
          continue;
        }

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
          const value = `generated-host-${component.framework}-property`;
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
        const eventReachedDocumentPaths: boolean[] = [];
        const onDocumentEvent = (event: Event): void => {
          if (event.composedPath().includes(element)) {
            eventReachedDocumentPaths.push(
              generatedHostElement !== null && event.composedPath().includes(generatedHostElement),
            );
          }
        };
        const componentControl = shadow?.querySelector('[part]') as HTMLElement | null;
        document.addEventListener(component.event, onDocumentEvent);
        componentControl?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (component.event === 'click' && !eventObserved) element.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        document.removeEventListener(component.event, onDocumentEvent);
        const eventReachedDocument =
          eventReachedDocumentPaths.length > 0 && eventReachedDocumentPaths.every(Boolean);

        const entries = upgradeOrder.filter((entry) => entry.id === id);
        const constructorIndex = entries.findIndex((entry) => entry.phase === 'constructor');
        const connectedIndex = entries.findIndex((entry) => entry.phase === 'connected');
        generatedComponents.push({
          id,
          tag: component.tag,
          framework: component.framework as GeneratedHostFramework,
          upgraded:
            customElements.get(component.tag) !== undefined && element.constructor !== HTMLElement,
          propertyAttribute,
          event: eventObserved,
          slot: slotWorks,
          cssPart: partWorks,
          root: !!shadow,
          upgradeOrder: constructorIndex >= 0 && connectedIndex > constructorIndex,
          identityPreserved: state?.generatedExistingIdentity?.[id] === true,
          liveStatePreserved: state?.generatedExistingLiveState?.[id] === true,
          eventReachedDocument,
          propertyValue,
          attributeValue,
          assignedSlotNodes,
        });
      }

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
        generatedHost: {
          tag: generatedHostInput.tag,
          id: generatedHostInput.id,
          hostIdMatches,
          hostDefined: customElements.get(generatedHostInput.tag) !== undefined,
          hostUpgraded:
            generatedHostElement !== null && generatedHostElement.constructor !== HTMLElement,
          shadowRoot: generatedRoot !== null,
          captionSlotAssigned,
          defaultSlotAssigned,
          defaultSlotAssignedIds,
          controlPartPresent,
          controlPartToken,
          authoredNoDomHandlerAttribute,
          authoredHandlerHits,
          authoredClickCrossedShadowBoundary,
          foreignTagsRegisteredBeforeFixtureClient:
            state?.foreignTagsRegisteredBeforeFixtureClient === true,
          components: generatedComponents,
        },
        upgradeOrder: upgradeOrder.map((entry) => `${entry.phase}:${entry.tag}#${entry.id}`),
      };
    }, evaluateInput);

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
    const generated = observed.generatedHost;
    const generatedFailures: string[] = [];
    if (!generated.hostDefined) {
      generatedFailures.push(`${generated.tag}: generated host was not defined`);
    }
    if (!generated.hostUpgraded) {
      generatedFailures.push(`${generated.tag}: generated host did not upgrade in place`);
    }
    if (!generated.hostIdMatches) {
      generatedFailures.push(`${generated.tag}: host id does not match the corpus id`);
    }
    if (!generated.shadowRoot) {
      generatedFailures.push(`${generated.tag}: generated host shadow root is missing`);
    }
    if (!generated.captionSlotAssigned) {
      generatedFailures.push(`${generated.tag}: named-slot light child is not projected`);
    }
    if (!generated.defaultSlotAssigned) {
      generatedFailures.push(
        `${generated.tag}: default slot did not assign every foreign probe ` +
          `(assigned ${JSON.stringify(generated.defaultSlotAssignedIds)})`,
      );
    }
    if (!generated.controlPartPresent) {
      generatedFailures.push(`${generated.tag}: authored control part is missing or mis-tokened`);
    }
    if (!generated.authoredNoDomHandlerAttribute) {
      generatedFailures.push(`${generated.tag}: authored handler leaked to a DOM event attribute`);
    }
    if (generated.authoredHandlerHits !== 1) {
      generatedFailures.push(
        `${generated.tag}: authored onClick handler ran ${generated.authoredHandlerHits} time(s), expected 1`,
      );
    }
    if (!generated.authoredClickCrossedShadowBoundary) {
      generatedFailures.push(
        `${generated.tag}: composed click did not cross the generated host shadow boundary`,
      );
    }
    if (!generated.foreignTagsRegisteredBeforeFixtureClient) {
      generatedFailures.push(
        `${generated.tag}: a foreign probe tag was registered before the fixture client`,
      );
    }
    const failedGeneratedComponents = generated.components.filter(
      (component) =>
        !component.upgraded ||
        !component.propertyAttribute ||
        !component.event ||
        !component.slot ||
        !component.cssPart ||
        !component.root ||
        !component.upgradeOrder ||
        !component.identityPreserved ||
        !component.liveStatePreserved ||
        !component.eventReachedDocument,
    );
    if (generated.components.length !== corpus.components.length) {
      generatedFailures.push(
        `${generated.tag}: probed ${generated.components.length} of ${corpus.components.length} foreign children`,
      );
    }
    if (generatedFailures.length > 0 || failedGeneratedComponents.length > 0) {
      throw new Error(
        `${browserName}: generated host probes failed: ${JSON.stringify({
          host: generatedFailures,
          components: failedGeneratedComponents,
        })}`,
      );
    }
    return {
      browser: browserName,
      browserVersion: await session.browser.version(),
      childHost: observed.childHost,
      components: observed.components,
      fresh: observed.fresh,
      generatedHost: generated,
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
  const tmpRoot = await mkdtemp(join(tmpdir(), 'openelement-web-component-interop-'));
  const keep = process.env.OPEN_ELEMENT_KEEP_INTEROP === '1';
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
    await writeFile(join(tmpRoot, 'compiler-output.cem.json'), jsonText(corpus.cem));
    await writeFile(join(tmpRoot, 'interop-evidence.json'), jsonText(evidence));
    console.log(JSON.stringify(evidence, null, 2));
    console.log('Web Components interoperability qualification passed');
    return evidence;
  } finally {
    if (keep) console.log(`Keeping interop temporary app at ${tmpRoot}`);
    else await rm(tmpRoot, { recursive: true });
  }
}

if (import.meta.main) {
  await qualify();
}
