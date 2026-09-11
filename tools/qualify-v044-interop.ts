#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/**
 * v0.44 alpha.6 interoperability qualification (#1175).
 *
 * This is a qualification harness, not an Element-core adapter. It validates
 * the compiler-facing CEM artifact, builds a temporary OpenElement app from
 * the owned corpus, and probes the browser's native Custom Element contract.
 * Unknown SSR capability is deliberately classified as client-only; there is
 * no framework fallback or second rendering path in this harness.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixtureRoot = new URL('../tests/fixtures/v044-interop/', import.meta.url);
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
const appProjectName = 'v044-interop-corpus-app';

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
  cem: unknown;
}

export interface SsrCapabilityDecision {
  renderPath: 'ssr+client' | 'client-only';
  code: 'OEI1000' | 'OEI2000' | 'OEI2001';
  message: string;
}

export interface AdmissionDecision {
  tagName: string;
  modulePath: string;
  source: string;
  renderPath: string;
  reason: string;
}

interface AdmissionPlan {
  decisions: AdmissionDecision[];
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
  source: 'tools/qualify-v044-interop.ts';
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
  return typeof value[key] === 'string' ? value[key] as string : undefined;
}

function readJson<T>(path: string): Promise<T> {
  return Deno.readTextFile(path).then((text) => JSON.parse(text) as T);
}

function pathFromRoot(root: URL | string, relativePath: string): string {
  return root instanceof URL
    ? fileURLToPath(new URL(relativePath, root))
    : join(root, relativePath);
}

function equalArrays(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validCustomElementTag(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(value);
}

/**
 * Validate the deliberately small CEM surface emitted by the alpha.6 fixture.
 * The shape follows CEM 1.0.0: javascript modules, class declarations,
 * custom-element tags, members, events, slots and CSS parts.
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
          if ('reflect' in memberValue && typeof memberValue.reflect !== 'boolean') {
            errors.push(`${memberPath}.reflect must be boolean when present`);
          }
        }
      }

      for (const field of ['events', 'slots', 'cssParts'] as const) {
        const entries = declarationValue[field];
        if (!Array.isArray(entries)) {
          errors.push(`${declarationPath}.${field} must be an array`);
          continue;
        }
        for (const [entryIndex, entryValue] of entries.entries()) {
          const entryPath = `${declarationPath}.${field}[${entryIndex}]`;
          if (
            !isRecord(entryValue) || typeof entryValue.name !== 'string' ||
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
    if (!isRecord(moduleValue) || !Array.isArray(moduleValue.declarations)) continue;
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
  if (!stringField(raw, 'cem')) errors.push('corpus cem must be a relative manifest path');

  const application = raw.application;
  if (!isRecord(application)) {
    errors.push('corpus application must be an object');
  } else {
    for (
      const field of ['route', 'fixtureTag', 'childHostTag', 'childHostId', 'dependencyRootId']
    ) {
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
    if (!validCustomElementTag(tag)) errors.push(`${path}.tag is not a valid custom-element tag`);
    else if (seenTags.has(tag)) errors.push(`${path}.tag duplicates ${tag}`);
    else seenTags.add(tag);

    for (const field of ['className', 'property', 'attribute', 'event', 'slotText', 'cssPart']) {
      if (!stringField(componentValue, field)) errors.push(`${path}.${field} must be a string`);
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
        if (!stringField(ids, placement)) errors.push(`${path}.ids.${placement} must be a string`);
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
    message: `unknown SSR capability ${JSON.stringify(capability)}; fail closed to client-only ` +
      'without a compatibility fallback',
  };
}

/** Load and validate the deterministic alpha.6 corpus and its CEM artifact. */
export async function loadInteropCorpus(
  root: URL | string = defaultFixtureRoot,
): Promise<InteropCorpus> {
  const configPath = pathFromRoot(root, 'corpus.json');
  const config = await readJson<unknown>(configPath);
  const configErrors = validateCorpusConfig(config);
  if (configErrors.length > 0) {
    throw new Error(`Invalid alpha.6 corpus:\n- ${configErrors.join('\n- ')}`);
  }
  const typedConfig = config as CorpusConfig;
  const cemPath = pathFromRoot(root, typedConfig.cem);
  const cem = await readJson<unknown>(cemPath);
  const cemErrors = validateCemManifest(cem);
  if (cemErrors.length > 0) {
    throw new Error(`Invalid alpha.6 CEM output:\n- ${cemErrors.join('\n- ')}`);
  }
  const expectedTags = typedConfig.components.map((component) => component.tag);
  const actualTags = customElementTags(cem);
  if (!equalArrays(actualTags, expectedTags)) {
    throw new Error(
      `CEM tags ${JSON.stringify(actualTags)} do not match corpus tags ${
        JSON.stringify(expectedTags)
      }`,
    );
  }
  return { ...typedConfig, cem };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${cwd}`);
  const output = await new Deno.Command(command, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const text = `${new TextDecoder().decode(output.stdout)}${
    new TextDecoder().decode(output.stderr)
  }`.trim();
  if (!output.success) {
    if (text) console.error(text);
    throw new Error(`command failed with exit code ${output.code}: ${command} ${args.join(' ')}`);
  }
  return text;
}

function localPackageAliases(root: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const packageEntry of Deno.readDirSync(join(root, 'packages'))) {
    if (!packageEntry.isDirectory) continue;
    const packageDir = join(root, 'packages', packageEntry.name);
    let packageJson: { name?: unknown; exports?: unknown };
    try {
      packageJson = JSON.parse(Deno.readTextFileSync(join(packageDir, 'deno.json')));
    } catch {
      continue;
    }
    if (typeof packageJson.name !== 'string') continue;
    const exportsField = packageJson.exports;
    if (typeof exportsField === 'string') {
      entries.push([packageJson.name, pathToFileURL(join(packageDir, exportsField)).href]);
      continue;
    }
    if (!isRecord(exportsField)) continue;
    for (const [subpath, target] of Object.entries(exportsField)) {
      if (typeof target !== 'string') continue;
      const specifier = subpath === '.'
        ? packageJson.name
        : `${packageJson.name}${subpath.slice(1)}`;
      entries.push([specifier, pathToFileURL(join(packageDir, target)).href]);
    }
  }
  return entries.sort((left, right) => right[0].length - left[0].length);
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
  for (const packageEntry of Deno.readDirSync(join(root, 'packages'))) {
    if (!packageEntry.isDirectory) continue;
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
  const denoPath = join(appDir, 'deno.json');
  const denoJson = await readJson<{
    imports?: Record<string, string>;
    tasks?: Record<string, string>;
  }>(denoPath);
  const imports = denoJson.imports ??= {};
  Object.assign(imports, {
    lit: 'npm:lit@3.3.3',
    '@microsoft/fast-element': 'npm:@microsoft/fast-element@3.0.2',
    '@ionic/core': 'npm:@ionic/core@8.8.18',
    '@ionic/core/': 'npm:@ionic/core@8.8.18/',
    ...localPackageImports(repoRoot),
  });
  for (const [specifier, target] of localPackageAliases(repoRoot)) imports[specifier] = target;
  const tasks = denoJson.tasks ??= {};
  tasks.build = `deno run --unstable-sloppy-imports --config deno.json -A ${
    join(repoRoot, 'packages', 'router', 'src', 'cli', 'build.ts')
  }`;
  await Deno.writeTextFile(denoPath, json(denoJson));

  await runCommand(
    Deno.execPath(),
    [
      'eval',
      '--config',
      'deno.json',
      "import '@preact/signals-core'; import 'preact'; import 'preact-render-to-string';",
    ],
    appDir,
  );

  const vitePath = join(appDir, 'vite.config.ts');
  const viteText = await Deno.readTextFile(vitePath);
  const localAliases = localPackageAliases(repoRoot).map(([find, target]) =>
    `{ find: ${JSON.stringify(find)}, replacement: ${JSON.stringify(fileURLToPath(target))} }`
  );
  const externalAliases = ['@preact/signals-core', 'preact', 'preact-render-to-string'].map((
    find,
  ) =>
    `{ find: ${JSON.stringify(find)}, replacement: ${
      JSON.stringify(join(appDir, 'node_modules', ...find.split('/')))
    } }`
  );
  const aliases = [...localAliases, ...externalAliases].join(',\n      ');
  const injected =
    `export default defineConfig({\n  resolve: {\n    alias: [\n      ${aliases}\n    ],\n  },`;
  if (!viteText.includes('resolve:')) {
    await Deno.writeTextFile(vitePath, viteText.replace('export default defineConfig({', injected));
  }
}

async function copyFixtureSources(appDir: string, root: URL | string): Promise<void> {
  for (
    const relativePath of [
      'app/routes/index.tsx',
      'app/islands/v044-interop-fixture.tsx',
      'app/client/v044-interop-client.ts',
    ]
  ) {
    const destination = join(appDir, relativePath);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.copyFile(pathFromRoot(root, relativePath), destination);
  }
}

async function prepareInteropApp(tmpRoot: string, root: URL | string): Promise<string> {
  await runCommand(
    Deno.execPath(),
    ['run', '-A', join(repoRoot, 'packages', 'create', 'src', 'cli.ts'), appProjectName],
    tmpRoot,
  );
  const appDir = join(tmpRoot, appProjectName);
  await patchApp(appDir);
  await copyFixtureSources(appDir, root);
  await runCommand(Deno.execPath(), ['task', 'build'], appDir);
  return appDir;
}

async function findFile(root: string, name: string): Promise<string | null> {
  for await (const entry of Deno.readDir(root)) {
    const path = join(root, entry.name);
    if (entry.isFile && entry.name === name) return path;
    if (entry.isDirectory) {
      const found = await findFile(path, name);
      if (found) return found;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract the generated admission plan without executing generated code. */
export function extractAdmissionPlan(entryJs: string): AdmissionPlan {
  const match = /(?:var|const|let)\s+ssrAdmissionPlan\s*=\s*/.exec(entryJs);
  if (!match) throw new Error('ssrAdmissionPlan not found in generated server entry');
  const begin = match.index + match[0].length;
  if (entryJs[begin] !== '{') throw new Error('ssrAdmissionPlan is not an object literal');
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let end = -1;
  for (let index = begin; index < entryJs.length; index++) {
    const character = entryJs[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error('ssrAdmissionPlan object literal is unbalanced');
  const parsed = JSON.parse(entryJs.slice(begin, end)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.decisions)) {
    throw new Error('ssrAdmissionPlan.decisions is missing');
  }
  return {
    decisions: parsed.decisions.filter(isRecord).map((decision) => ({
      tagName: String(decision.tagName ?? ''),
      modulePath: String(decision.modulePath ?? ''),
      source: String(decision.source ?? ''),
      renderPath: String(decision.renderPath ?? ''),
      reason: String(decision.reason ?? ''),
    })),
  };
}

async function verifySsr(appDir: string, corpus: InteropCorpus): Promise<SsrEvidence> {
  const distDir = join(appDir, 'dist');
  const htmlPath = await findFile(distDir, 'index.html');
  if (!htmlPath) throw new Error(`SSG index.html not found under ${distDir}`);
  const html = await Deno.readTextFile(htmlPath);
  const serverEntryPath = join(distDir, 'server', 'entry.js');
  const entryPath = await Deno.stat(serverEntryPath).then(() => serverEntryPath).catch(async () => {
    const found = await findFile(distDir, 'entry.js');
    if (!found) throw new Error(`generated server entry not found under ${distDir}`);
    return found;
  });
  const plan = extractAdmissionPlan(await Deno.readTextFile(entryPath));
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
    if (!tagPresent) failures.push(`${component.tag}: tag missing from SSR HTML`);
    if (!lightDomChildPresent) failures.push(`${component.tag}: authored light-DOM child missing`);
    if (dsdTemplate) failures.push(`${component.tag}: unknown foreign tag received a DSD template`);
    if (!decision) failures.push(`${component.tag}: no admission decision was emitted`);
    else if (decision.renderPath !== 'client-only') {
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
  if (!fixtureTagPresent) failures.push(`${fixtureTag}: OpenElement fixture missing from SSR HTML`);
  if (!fixtureDsd) failures.push(`${fixtureTag}: expected DSD fixture root missing`);
  if (failures.length > 0) {
    throw new Error(`SSR interoperability mismatches:\n- ${failures.join('\n- ')}`);
  }
  return {
    htmlPath: 'dist/index.html',
    fixture: { tag: fixtureTag, tagPresent: fixtureTagPresent, dsdTemplate: fixtureDsd },
    foreignComponents,
  };
}

interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveStatic(root: string): StaticServer {
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0 },
    async (request) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      if (pathname.includes('..') || pathname.includes('\0')) {
        return new Response('Forbidden', { status: 403 });
      }
      const relative = pathname.replace(/^\/+/, '');
      const candidates = relative.length === 0
        ? ['index.html']
        : [relative, `${relative}.html`, join(relative, 'index.html')];
      for (const candidate of candidates) {
        try {
          const body = await Deno.readFile(join(root, candidate));
          return new Response(body, { headers: { 'content-type': contentType(candidate) } });
        } catch {
          // Try the next deterministic candidate.
        }
      }
      return new Response('Not found', { status: 404 });
    },
  );
  const address = server.addr as Deno.NetAddr;
  return { origin: `http://127.0.0.1:${address.port}`, close: () => server.shutdown() };
}

export async function verifyBrowser(
  distDir: string,
  corpus: InteropCorpus,
  browserName: BrowserName,
): Promise<BrowserEvidence> {
  const playwright = await import('@playwright/test');
  const browserType = playwright[browserName];
  const server = serveStatic(distDir);
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        (globalThis as typeof globalThis & { __v044InteropState?: { ready?: boolean } })
          .__v044InteropState?.ready === true,
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
      const fixture = findTag(document, 'v044-interop-fixture');
      const fixtureRoot = fixture?.shadowRoot;
      if (!fixtureRoot) throw new Error('v044-interop-fixture shadow root is missing');
      const childHost = fixtureRoot.querySelector('#children') as HTMLElement | null;
      const childSlot = childHost?.shadowRoot?.querySelector('slot') as HTMLSlotElement | null;
      const childHostWorks = !!childHost && !!childHost.shadowRoot &&
        (childSlot?.assignedElements().length ?? 0) === componentInput.length;
      const state = (globalThis as typeof globalThis & {
        __v044InteropState?: {
          upgradeOrder?: UpgradeEntry[];
          events?: string[];
          existingIdentity?: Record<string, boolean>;
          existingLiveState?: Record<string, boolean>;
        };
      }).__v044InteropState;
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
            propertyAttribute = propertyValue === true &&
              element.hasAttribute(component.attribute);
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
            propertyAttribute = element.getAttribute(component.attribute) === value &&
              propertyValue === value;
          }

          const slots = Array.from(shadow?.querySelectorAll('slot') ?? []) as HTMLSlotElement[];
          const assignedSlotNodes = slots.reduce(
            (count, slot) => count + slot.assignedNodes({ flatten: true }).length,
            0,
          );
          const slotWorks = slots.some((slot) =>
            slot.assignedNodes({ flatten: true }).some((node) =>
              node.textContent?.includes(component.slotText) === true
            )
          );
          const partWorks = !!shadow &&
            Array.from(shadow.querySelectorAll('[part]')).some((part) =>
              (part.getAttribute('part') ?? '').split(/\s+/).includes(component.cssPart)
            );
          let eventObserved = false;
          element.addEventListener(component.event, () => eventObserved = true);
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
            upgraded: customElements.get(component.tag) !== undefined &&
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
            propertyAttribute = propertyValue === true &&
              element.hasAttribute(component.attribute);
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
            propertyAttribute = element.getAttribute(component.attribute) === value &&
              propertyValue === value;
          }

          const shadow = element.shadowRoot;
          const slots = Array.from(shadow?.querySelectorAll('slot') ?? []) as HTMLSlotElement[];
          const assignedSlotNodes = slots.reduce(
            (count, slot) => count + slot.assignedNodes({ flatten: true }).length,
            0,
          );
          const slotWorks = slots.some((slot) =>
            slot.assignedNodes({ flatten: true }).some((node) =>
              node.textContent?.includes(component.slotText) === true
            )
          );
          const partWorks = !!shadow &&
            Array.from(shadow.querySelectorAll('[part]')).some((part) =>
              (part.getAttribute('part') ?? '').split(/\s+/).includes(component.cssPart)
            );
          let eventObserved = false;
          element.addEventListener(component.event, () => eventObserved = true);
          const control = shadow?.querySelector('[part]') as HTMLElement | null;
          control?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (component.event === 'click' && !eventObserved) element.click();
          const entries = upgradeOrder.slice(upgradeStart);
          const constructorIndex = entries.findIndex((entry) =>
            entry.phase === 'constructor' && entry.tag === component.tag
          );
          const connectedIndex = entries.findIndex((entry) =>
            entry.phase === 'connected' && entry.id === id
          );
          fresh.push({
            id,
            tag: component.tag,
            upgraded: customElements.get(component.tag) !== undefined &&
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
      const dependencyWorks = !!dependencyRoot && componentInput.every((component) => {
        const element = dependencyRoot.querySelector(`#${component.ids['application-dependency']}`);
        return !!element && element.parentElement === dependencyRoot &&
          element.localName === component.tag;
      });
      return {
        childHost: childHostWorks && dependencyWorks &&
          dependencyTags.length === componentInput.length,
        freshRoot: !!freshRoot && fresh.length === componentInput.length &&
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
    const failedComponents = observed.components.filter((component) =>
      !component.upgraded || !component.propertyAttribute || !component.event || !component.slot ||
      !component.cssPart || !component.root || !component.upgradeOrder ||
      !component.identityPreserved || !component.liveStatePreserved
    );
    if (!observed.childHost) {
      throw new Error(`${browserName}: child/dependency placement probe failed`);
    }
    const failedFresh = observed.fresh.filter((component) =>
      !component.upgraded || !component.propertyAttribute || !component.event || !component.slot ||
      !component.cssPart || !component.root || !component.upgradeOrder
    );
    if (!observed.freshRoot || failedFresh.length > 0) {
      throw new Error(
        `${browserName}: fresh DOM probes failed: ${JSON.stringify(failedFresh)}`,
      );
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
    await browser.close();
    await server.close();
  }
}

async function qualify(
  root: URL | string = defaultFixtureRoot,
): Promise<InteropQualificationEvidence> {
  const corpus = await loadInteropCorpus(root);
  const admission = Object.fromEntries(
    corpus.components.map((component) => [component.tag, classifySsrCapability(undefined)]),
  ) as Record<string, SsrCapabilityDecision>;
  const tmpRoot = await Deno.makeTempDir({ prefix: 'openelement-v044-interop-' });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_V044_INTEROP') === '1';
  try {
    const appDir = await prepareInteropApp(tmpRoot, root);
    const ssr = await verifySsr(appDir, corpus);
    const browsers = {} as Record<BrowserName, BrowserEvidence>;
    for (const browserName of browserNames) {
      browsers[browserName] = await verifyBrowser(join(appDir, 'dist'), corpus, browserName);
    }
    const evidence: InteropQualificationEvidence = {
      schemaVersion: 1,
      source: 'tools/qualify-v044-interop.ts',
      corpus: {
        frameworks: corpus.components.map((component) => component.framework),
        componentCount: corpus.components.length,
        probes: [...requiredProbes],
        placements: [...requiredPlacements],
      },
      cem: {
        schemaVersion: String((corpus.cem as Record<string, unknown>).schemaVersion),
        tags: customElementTags(corpus.cem),
      },
      ssr,
      admission,
      browsers,
    };
    await Deno.writeTextFile(pathFromRoot(root, 'interop-evidence.json'), json(evidence));
    console.log(JSON.stringify(evidence, null, 2));
    console.log('v0.44 alpha.6 interoperability qualification passed');
    return evidence;
  } finally {
    if (keep) console.log(`Keeping alpha.6 temporary app at ${tmpRoot}`);
    else await Deno.remove(tmpRoot, { recursive: true });
  }
}

if (import.meta.main) {
  await qualify();
}
