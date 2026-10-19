/**
 * doc-claims: every machine-checkable factual claim in the covered docs must
 * agree with the source that owns the fact.
 *
 * WHY this exists. The docs carry numbers, commands, subpaths, versions and
 * gate counts that are derived from code. Those derived copies drift silently:
 * a task is renamed, a subpath is retired, a step joins a gate, a package
 * reference moves — and the prose keeps asserting the old world until a reader
 * trips over it. This gate reads the prose and the authorities in one pass, so
 * a change to the fact fails the change that made it, at the moment it lands.
 *
 * THE BOUNDARY (honest by construction). This checker only owns claims that a
 * machine can decide:
 *
 *   1. version literals      -> release-state + package manifests + dep pins
 *   2. install commands      -> packages/create/src/install-command.ts
 *   3. CLI / task commands   -> the workspace's own package.json scripts
 *   4. package subpaths      -> the packages' own `exports` maps
 *   5. gate step counts      -> tools/repo|release package.json gate definitions
 *   6. CI job names/counts   -> .github/workflows/*.yml
 *   7. ADR references        -> docs/adr/ADR-*.md
 *   8. repo path references  -> the tree itself
 *   9. bilingual parity      -> the content tree's own file pairs
 *  10. description budget    -> POLICY (a declared bound, not a fact): the
 *      frontmatter `lede` is the meta description, and search snippets are
 *      budgeted at 160 characters.
 *
 * Everything else is narrative — comparisons, design rationale, cost stories,
 * benchmark prose, "why" sentences. Narrative is NOT checked here and the
 * `--report` mode lists the classes it excludes, so the gate's coverage cannot
 * be mistaken for "all prose is verified".
 *
 * ALLOWLIST. Every entry needs a reason a reviewer can judge; an entry whose
 * reason is empty or too short fails the check itself. An allowlist entry is a
 * debt note, not a mute button: it names the claim class, the exact value and
 * why the authority cannot express it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Claim classes the gate does NOT decide (printed by --report).
// ─────────────────────────────────────────────────────────────────────────────

export const NARRATIVE_CLASSES: ReadonlyArray<{ name: string; why: string }> = [
  {
    name: 'comparisons and positioning',
    why: 'relative judgements ("leaner than X", "the faster path") have no authority file to agree with',
  },
  {
    name: 'design rationale and history',
    why: 'why a decision was taken is an argument, not a derived fact; ADRs own it',
  },
  {
    name: 'cost and performance prose',
    why:
      'measured OUTPUT is owned by check:doc-figures for the pages it measures (comparison.md, ±1% raw / ±3% gzip rows); ' +
      'rounded figures stated in prose ("about 2 KB gzipped", a pasted dev-server transcript) are approximations with no ' +
      'authority file, so this gate only asserts that the measured pages stay inside the corpus',
  },
  {
    name: 'roadmap and maturity statements',
    why: 'future intent is a plan, not a fact; the roadmap page derives its version rows from release-state',
  },
  {
    name: 'API semantics and examples',
    why: 'behaviour is owned by the code and its tests; check:content compiles example fences',
  },
  {
    name: 'translated prose',
    why: 'the zh pages must carry the same facts, but their wording is a translation choice — parity is checked at the file level, not sentence by sentence',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Allowlist — each entry is a debt note with a reason.
// ─────────────────────────────────────────────────────────────────────────────

export interface AllowEntry {
  rule: ClaimRule;
  /** Exact value the rule would otherwise flag. */
  value: string;
  /** Restrict to one covered file; omitted = any covered file. */
  file?: string;
  reason: string;
}

export type ClaimRule =
  | 'version'
  | 'subpath'
  | 'install-command'
  | 'cli-command'
  | 'task-command'
  | 'gate-count'
  | 'gate-count-ci'
  | 'ci-job'
  | 'ci-instances'
  | 'adr'
  | 'path'
  | 'parity'
  | 'lede'
  | 'measured';

export const ALLOWLIST: readonly AllowEntry[] = [
  {
    rule: 'version',
    value: '1.0.0',
    reason:
      'the 1.0 line / final release identifier, named as a target; no manifest can carry an unpublished final version',
  },
  {
    rule: 'version',
    value: '1.0.0-alpha.1',
    reason: 'the historic first public baseline, documented as history in releasing.md',
  },
  {
    rule: 'version',
    value: '1.0.3',
    reason: 'the retired Deno-era line, recorded as history in the Deno diagnostic exception',
  },
  {
    rule: 'version',
    value: '2.9.0',
    reason: 'the retired Deno-era pin, recorded as history in deno-pack/node-porting docs',
  },
  {
    rule: 'version',
    value: '2.9.6',
    reason: 'the retired Deno-era pin, recorded as history in the Deno diagnostic exception',
  },
  {
    rule: 'version',
    value: '3.0.0',
    reason:
      'nitro@3.0.0 is named to explain why nitro is not declared as a peer; it is not a workspace pin',
  },
  {
    rule: 'version',
    value: '3.0.260610',
    reason: 'a Cloudflare compatibility date (nitro@3.0.260610-beta), not a release version',
  },
  {
    rule: 'path',
    value: 'packages/router/src/vite/internal/island-css.ts',
    reason:
      'a historical path in the shim inventory: the module moved; the row records the retired shim',
  },
  {
    rule: 'path',
    value: 'tools/release/native-pack-check.ts',
    reason:
      'a deleted verdict in the historic alpha7 design review; the doc records what was retired',
  },
  {
    rule: 'path',
    value: 'tools/repo/check-deno-floor.ts',
    reason:
      'a deleted check in the historic alpha7 design review; the doc records what was retired',
  },
  {
    rule: 'path',
    value: 'www/app/data/_generated-release-line.ts',
    reason:
      'a generated (gitignored) module: it exists after generate:all, never in a fresh checkout; check:content-data owns its content',
  },
  {
    rule: 'parity',
    value: 'www/content/blog/2026-09-13-1-0-0-alpha-1-baseline.md',
    reason:
      'the release-note blog post ships in English only by decision; it is not a docs article pair',
  },
];

/** Check the allowlist itself: every entry carries a reason a reviewer can judge. */
export function validateAllowlist(entries: readonly AllowEntry[] = ALLOWLIST): string[] {
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    const where = `allowlist[${index}] (${entry.rule}:${entry.value})`;
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      problems.push(
        `${where} needs a reason of at least 20 characters — an unexplained exemption is a mute button`,
      );
    }
    if (typeof entry.value !== 'string' || entry.value.trim() === '') {
      problems.push(`${where} has no value to exempt`);
    }
  });
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorities
// ─────────────────────────────────────────────────────────────────────────────

export interface Authorities {
  /** Versions a covered file may name: tree manifests, dep pins, registry truth. */
  versions: Set<string>;
  /** `@openelement/x` -> its `exports` keys (`./foo`). */
  exportsByPackage: Map<string, Set<string>>;
  /** package name (or `root`) -> script names. */
  scriptsByPackage: Map<string, Set<string>>;
  /** workspace-relative directory -> script names, for `pnpm --dir <dir> run`. */
  scriptsByDirectory: Map<string, Set<string>>;
  /** The scaffold template's scripts: the generated project's own command set. */
  templateScripts: Set<string>;
  /** Router bin subcommands (`dev`, `build`, `start`, `version`). */
  cliSubcommands: Set<string>;
  /** Gate task -> its expanded step list. */
  gateSteps: Map<string, string[]>;
  /** gate:source steps that AutoFlow CI actually runs, with their layer. */
  ciSteps: Map<string, CiStepEvidence>;
  /** CI job id -> job instances (matrix legs), from the AutoFlow CI workflow. */
  ciJobs: Map<string, number>;
  /** Every job id any workflow in .github/workflows declares. */
  workflowJobs: Set<string>;
  /** The required qualification job ids the release train demands. */
  requiredCiJobs: string[];
  /** Published package names, from release-state.json. */
  publishedPackages: string[];
  /** ADR ids, four digits, from docs/adr/ADR-*.md. */
  adrIds: Set<string>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walkFiles(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.'))
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, match, out);
    else if (entry.isFile() && match(entry.name)) out.push(path);
  }
  return out;
}

/** Every workspace manifest that can pin a dependency version. */
export function workspaceManifests(root: string): string[] {
  const manifests = [join(root, 'package.json')];
  for (const group of ['packages', 'tools', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, 'package.json');
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  const www = join(root, 'www/package.json');
  if (existsSync(www)) manifests.push(www);
  manifests.push(...walkFiles(join(root, 'tests'), (name) => name === 'package.json'));
  return manifests;
}

const VERSION_IN_RANGE = /\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?/g;

/** `@openelement/x` -> `exports` keys, and package name / directory -> scripts. */
function readPackages(root: string): {
  exportsByPackage: Map<string, Set<string>>;
  scriptsByPackage: Map<string, Set<string>>;
  scriptsByDirectory: Map<string, Set<string>>;
} {
  const exportsByPackage = new Map<string, Set<string>>();
  const scriptsByPackage = new Map<string, Set<string>>();
  const scriptsByDirectory = new Map<string, Set<string>>();
  for (const manifest of workspaceManifests(root)) {
    const json = readJson(manifest) as {
      name?: string;
      exports?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };
    const scripts = new Set(Object.keys(json.scripts ?? {}));
    if (typeof json.name === 'string') {
      if (json.exports) exportsByPackage.set(json.name, new Set(Object.keys(json.exports)));
      scriptsByPackage.set(json.name, scripts);
    }
    const directory = relative(root, manifest).replace(/\/package\.json$/, '');
    scriptsByDirectory.set(directory === 'package.json' ? '.' : directory, scripts);
  }
  const rootJson = readJson(join(root, 'package.json')) as { scripts?: Record<string, string> };
  scriptsByPackage.set('root', new Set(Object.keys(rootJson.scripts ?? {})));
  scriptsByDirectory.set('.', new Set(Object.keys(rootJson.scripts ?? {})));
  return { exportsByPackage, scriptsByPackage, scriptsByDirectory };
}

/** The router CLI's subcommands, read from its own usage text. */
export function routerSubcommands(root: string): Set<string> {
  const source = readFileSync(join(root, 'packages/router/src/cli/cli.ts'), 'utf8');
  const start = source.indexOf("'Commands:'");
  const end = source.indexOf("'Options:'", start === -1 ? 0 : start);
  const block = start === -1 ? source : source.slice(start, end === -1 ? undefined : end);
  const found = new Set<string>();
  for (const match of block.matchAll(/' {2}([a-z][a-z0-9-]*)/g)) found.add(match[1]!);
  return found;
}

/** task -> expanded steps, for every gate.ts-driven script in the workspace. */
export function gateDefinitions(root: string): Map<string, string[]> {
  const gates = new Map<string, string[]>();
  const add = (key: string, script: string): void => {
    const tokens = script.split(/\s+/);
    const gateIndex = tokens.findIndex((token) => token.endsWith('gate.ts'));
    if (gateIndex === -1) return;
    gates.set(
      key,
      tokens.slice(gateIndex + 1).filter((token) => token !== '' && !token.startsWith('--')),
    );
  };
  for (const manifest of workspaceManifests(root)) {
    const json = readJson(manifest) as { name?: string; scripts?: Record<string, string> };
    for (const [name, script] of Object.entries(json.scripts ?? {})) {
      add(name, script);
      if (typeof json.name === 'string') add(`${json.name}#${name}`, script);
    }
  }
  return gates;
}

/**
 * The gate:source steps AutoFlow CI runs, with the step that runs each one and
 * WHICH layer runs it. This map is the authority for every "which run in CI"
 * claim: a step that joins gate:source without joining this map makes the count
 * claims in the docs go red — exactly the reminder its author needs — and a
 * step that joins CI must be recorded here before the docs may say so.
 * `base` = the four fast jobs (lint/test/e2e/pack) on every pull request and
 * push; `full` = the heavy jobs (e2e-full and friends) on a main push or a
 * `full_qualification` dispatch.
 */
export interface CiStepEvidence {
  layer: 'base' | 'full';
  where: string;
}

export const CI_STEP_EVIDENCE: ReadonlyMap<string, CiStepEvidence> = new Map([
  [
    '@openelement/tools-repo#generate:all',
    { layer: 'base', where: 'lint job, "Generate all artifacts"' },
  ],
  [
    '@openelement/tools-repo#typecheck',
    { layer: 'base', where: 'lint job, "Tools typecheck (gate:source)"' },
  ],
  ['check:dep-age', { layer: 'base', where: 'lint job, "Dependency age gate (gate:source)"' }],
  ['@openelement/element#test', { layer: 'base', where: 'test job, "Element tests"' }],
  ['@openelement/router#test', { layer: 'base', where: 'test job, "Router tests"' }],
  [
    '@openelement/tools-repo#lint:markdown',
    { layer: 'base', where: 'lint job, `vp run check` includes lint:markdown' },
  ],
  [
    '@openelement/tools-repo#vp:selector-flags:check',
    { layer: 'base', where: 'lint job, "vp selector flags"' },
  ],
  [
    '@openelement/tools-repo#seams:check',
    { layer: 'base', where: 'lint job, "Seams registry (P8 reader)"' },
  ],
  [
    '@openelement/www#check:content-dates',
    { layer: 'base', where: 'lint job, "Content-date manifest check (gate:source)"' },
  ],
  [
    '@openelement/tools-repo#interface:snapshot',
    { layer: 'base', where: 'lint job, "Interface snapshot check"' },
  ],
  [
    '@openelement/element#browser:gate',
    { layer: 'base', where: 'test job, "Element browser gate (chromium)"' },
  ],
  [
    '@openelement/fixture-router-request-time#gate',
    { layer: 'full', where: 'e2e-full fixture-gates leg (main push / full_qualification)' },
  ],
  [
    '@openelement/fixture-router-base-path#gate',
    { layer: 'full', where: 'e2e-full fixture-gates leg (main push / full_qualification)' },
  ],
]);

/**
 * Job ids in one workflow's `jobs:` block, with their instance counts (the
 * product of their inline matrix legs). A line-based read is enough here: the
 * checker needs job NAMES and matrix sizes, and a full YAML parser would be a
 * dependency the repository does not carry.
 */
export function workflowJobInstances(path: string): Map<string, number> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const jobs = new Map<string, number>();
  let inJobs = false;
  let current: string | null = null;
  let matrixLegs = 1;
  const flush = (): void => {
    if (current !== null) jobs.set(current, matrixLegs);
  };
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line) && line.trim() !== '') {
      flush();
      current = null;
      inJobs = false;
      continue;
    }
    const jobHeader = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (jobHeader) {
      flush();
      current = jobHeader[1]!;
      matrixLegs = 1;
      continue;
    }
    const matrixRow = /^ {8}([a-z][a-z0-9-]*): \[(.*)\]\s*$/.exec(line);
    if (matrixRow && current !== null) {
      const legs = matrixRow[2]!
        .split(',')
        .map((leg) => leg.trim())
        .filter((leg) => leg !== '');
      matrixLegs *= Math.max(legs.length, 1);
    }
  }
  flush();
  return jobs;
}

/** Job ids and their instance counts, read from the AutoFlow CI workflow. */
export function ciJobInstances(root: string): Map<string, number> {
  return workflowJobInstances(join(root, '.github/workflows/autoflow-ci.yml'));
}

/** Every job id declared by any workflow under .github/workflows. */
export function allWorkflowJobs(root: string): Set<string> {
  const jobs = new Set<string>();
  const dir = join(root, '.github/workflows');
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    for (const job of workflowJobInstances(join(dir, entry)).keys()) jobs.add(job);
  }
  return jobs;
}

/** The release train's required qualification job ids, read from its own check. */
export function requiredCiJobs(root: string): string[] {
  const text = readFileSync(join(root, '.github/workflows/autoflow-release.yml'), 'utf8');
  const match = /--arg required "([^"]+)"/.exec(text);
  return match ? match[1]!.split(/\s+/).filter(Boolean) : [];
}

export function readAuthorities(root: string = repoRoot): Authorities {
  const release = readJson(join(root, 'docs/release/release-state.json')) as {
    sourceVersion: string;
    activeTarget: string;
    packages: Array<{ name: string; registry?: Record<string, string> }>;
    latestPrerelease?: { version?: string };
  };
  const versions = new Set<string>();
  const addVersion = (value: string): void => {
    for (const match of value.matchAll(VERSION_IN_RANGE)) versions.add(match[0]);
  };
  addVersion(release.sourceVersion);
  addVersion(release.activeTarget);
  const publishedPackages: string[] = [];
  for (const pkg of release.packages) {
    publishedPackages.push(pkg.name);
    for (const distTag of Object.values(pkg.registry ?? {})) addVersion(distTag);
  }
  if (release.latestPrerelease?.version) addVersion(release.latestPrerelease.version);

  for (const manifest of workspaceManifests(root)) {
    const json = readJson(manifest) as Record<string, unknown>;
    addVersion(String(json.version ?? ''));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const range of Object.values((json[field] as Record<string, string>) ?? {})) {
        addVersion(String(range));
      }
    }
    addVersion(String(json.packageManager ?? ''));
  }
  const templateManifest = join(root, 'packages/create/templates/package.json.tmpl');
  if (existsSync(templateManifest)) {
    const json = readJson(templateManifest) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies']) {
      for (const range of Object.values((json[field] as Record<string, string>) ?? {})) {
        addVersion(String(range));
      }
    }
  }
  const nodePin = join(root, '.node-version');
  if (existsSync(nodePin)) addVersion(readFileSync(nodePin, 'utf8').trim());
  const nodeFloorSource = join(root, 'packages/create/src/node-version.ts');
  if (existsSync(nodeFloorSource)) {
    const floor = /MINIMUM_NODE_VERSION = '([^']+)'/.exec(readFileSync(nodeFloorSource, 'utf8'));
    if (floor) addVersion(floor[1]!);
  }

  const { exportsByPackage, scriptsByPackage, scriptsByDirectory } = readPackages(root);
  const templateScripts = new Set<string>();
  if (existsSync(templateManifest)) {
    const json = readJson(templateManifest) as { scripts?: Record<string, string> };
    for (const name of Object.keys(json.scripts ?? {})) templateScripts.add(name);
  }

  const adrIds = new Set<string>();
  for (const entry of readdirSync(join(root, 'docs/adr'))) {
    const match = /^ADR-(\d{4})/.exec(entry);
    if (match) adrIds.add(match[1]!);
  }

  return {
    versions,
    exportsByPackage,
    scriptsByPackage,
    scriptsByDirectory,
    templateScripts,
    cliSubcommands: routerSubcommands(root),
    gateSteps: gateDefinitions(root),
    ciSteps: new Map(CI_STEP_EVIDENCE),
    ciJobs: ciJobInstances(root),
    workflowJobs: allWorkflowJobs(root),
    requiredCiJobs: requiredCiJobs(root),
    publishedPackages,
    adrIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The covered corpus. Derived, not hand-listed: a new guide article, package
 * README or maintainer page joins the coverage the moment it exists.
 */
export function coveredFiles(root: string = repoRoot): string[] {
  const files: string[] = [];
  for (const name of ['README.md', 'README.zh.md', 'CONTRIBUTING.md']) {
    if (existsSync(join(root, name))) files.push(name);
  }
  const packages = join(root, 'packages');
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const readme = `packages/${entry.name}/README.md`;
    if (existsSync(join(root, readme))) files.push(readme);
  }
  const maintainers = join(root, 'docs/maintainers');
  for (const entry of readdirSync(maintainers)) {
    if (entry.endsWith('.md')) files.push(`docs/maintainers/${entry}`);
  }
  for (const path of walkFiles(join(root, 'www/content'), (name) => name.endsWith('.md'))) {
    files.push(relative(root, path));
  }
  return files.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding + helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface Finding {
  rule: ClaimRule;
  file: string;
  line: number;
  value: string;
  message: string;
}

interface Corpus {
  authorities: Authorities;
  allowlist: readonly AllowEntry[];
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function allowed(corpus: Corpus, rule: ClaimRule, value: string, file: string): boolean {
  return corpus.allowlist.some(
    (entry) =>
      entry.rule === rule &&
      entry.value === value &&
      (entry.file === undefined || entry.file === file),
  );
}

function report(
  findings: Finding[],
  corpus: Corpus,
  rule: ClaimRule,
  file: string,
  text: string,
  index: number,
  value: string,
  message: string,
): void {
  if (allowed(corpus, rule, value, file)) return;
  findings.push({ rule, file, line: lineOf(text, index), value, message });
}

/** Inline `code spans` and fenced line starts, without placeholders. */
export function codeSpans(text: string): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = [];
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    out.push({ value: match[1]!.trim(), index: match.index! });
  }
  let fence: string | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const fenceMatch = /^\s*```(\w*)/.exec(line);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1]! : null;
      offset += line.length + 1;
      continue;
    }
    if (fence !== null) {
      const trimmed = line.trim();
      if (trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        out.push({ value: trimmed.replace(/^\$\s+/, ''), index: offset });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

const PLACEHOLDER = /[<>{}$…]|\.\.\./;

/**
 * Engine-version claims: `chromium 147.0.7727.15`, `firefox 148.0.2`,
 * `webkit 26.4`, `Safari 16.4`.
 *
 * A browser build number is not a release version. It names the engine that
 * produced a qualification result, and the exact build IS the evidence: an
 * "engine unchanged" claim, a three-engine pass and a flake attribution all
 * lose their value if the number is rounded, and a value-shaped allowlist entry
 * would let a typo (`firefox 999.999.999`) pass. So this class is exempt BY
 * SHAPE — any engine build number passes, whatever its digits — and BY SCOPE:
 * the exemption holds only in the evidence files that record qualification
 * results (`docs/release/**`).
 * Everywhere else an engine number stays a red unknown-version finding, with a
 * message that names this class and where it belongs. That keeps the rule's
 * default intact: a version literal no manifest can explain must fail unless it
 * is a browser build in an evidence record.
 */
export const ENGINE_EVIDENCE_FILES: readonly string[] = [];

/** Whether a file may state engine build numbers as evidence. */
export function isEngineEvidenceFile(file: string): boolean {
  return ENGINE_EVIDENCE_FILES.includes(file) || file.startsWith('docs/release/');
}

const ENGINE_PREFIX =
  /(?:^|[^\w-])(firefox|chromium|webkit|chrome|safari|gecko|playwright|edge)[\s:=]{0,2}v?$/i;

/**
 * The engine name immediately preceding the version literal at `index`, or null
 * when the literal is an ordinary version. Reads the same line only, so a
 * sentence that mentions an engine earlier cannot exempt an unrelated number.
 */
export function engineVersionContext(text: string, index: number): string | null {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const match = ENGINE_PREFIX.exec(text.slice(lineStart, index));
  return match ? match[1]! : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Version literals must be a version the tree or the registry actually has —
 * except an engine build number inside an evidence record (see
 * {@link ENGINE_EVIDENCE_FILES}).
 */
export function checkVersions(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const pattern = /(?<![\w.])v?(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)(?![\w])(?!\.\d)/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const version = match[1]!;
      if (corpus.authorities.versions.has(version)) continue;
      if (
        allowed(corpus, 'version', version, file) ||
        allowed(corpus, 'version', `v${version}`, file)
      ) {
        continue;
      }
      const engine = engineVersionContext(text, match.index!);
      if (engine !== null) {
        // The claim is an engine build number: exempt in an evidence record,
        // still red anywhere else (the default the rule exists to keep).
        if (isEngineEvidenceFile(file)) continue;
        findings.push({
          rule: 'version',
          file,
          line: lineOf(text, match.index!),
          value: version,
          message:
            `names the engine build "${engine} ${version}". An engine build number is evidence-class: ` +
            `state it in ${ENGINE_EVIDENCE_FILES.join(' or ')} / docs/release/** (where the exact build is the record), ` +
            'or drop the number — a version literal here must match a tree version, a dependency pin, or the registry',
        });
        continue;
      }
      findings.push({
        rule: 'version',
        file,
        line: lineOf(text, match.index!),
        value: version,
        message:
          `names version ${version}, which is not a tree version, a dependency pin, or a registry version. ` +
          `Known: ${[...corpus.authorities.versions].sort().join(', ')}`,
      });
    }
  }
  return findings;
}

/** 2. `@openelement/<pkg>/<subpath>` must exist in that package's `exports`. */
export function checkSubpaths(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const pattern = /@openelement\/([a-z][a-z0-9-]*)\/([A-Za-z0-9._/-]+)/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const packageName = `@openelement/${match[1]!}`;
      const subpath = `./${match[2]!.replace(/[.,;:)]+$/, '')}`;
      const known = corpus.authorities.exportsByPackage.get(packageName);
      if (!known) {
        report(
          findings,
          corpus,
          'subpath',
          file,
          text,
          match.index!,
          `${packageName}/${match[2]}`,
          `names ${packageName}, which is not a published package in this workspace`,
        );
        continue;
      }
      if (known.has(subpath) || known.has(subpath.replace(/\/$/, ''))) continue;
      report(
        findings,
        corpus,
        'subpath',
        file,
        text,
        match.index!,
        `${packageName}${subpath.slice(1)}`,
        `${packageName} has no \`${subpath}\` export. Known: ${[...known].sort().join(', ')}`,
      );
    }
  }
  return findings;
}

/** 3a. Every documented install command must keep the canonical shape. */
export function checkInstallCommands(
  files: Map<string, string>,
  corpus: Corpus,
  canonical: { command: string; shape: (command: string) => string },
): Finding[] {
  const findings: Finding[] = [];
  const pattern = /(?:npm create|npm exec|npx|pnpm dlx)[^\n`]*@openelement[^\n`]*/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const command = match[0]!.trim();
      if (PLACEHOLDER.test(command.replace(/<name>|<project-name>|<version>|<pkg>|<tag>/g, '')))
        continue;
      if (canonical.shape(command) === canonical.shape(canonical.command)) continue;
      report(
        findings,
        corpus,
        'install-command',
        file,
        text,
        match.index!,
        command,
        `documents an install command whose shape differs from the create CLI's "${canonical.command}"`,
      );
    }
  }
  return findings;
}

const TASK_TOKEN = /^[A-Za-z@][\w@./:-]*$/;

/**
 * 3b. `vp run`/`pnpm run`/`npm run` tasks, and the router bin's subcommands.
 *
 * The task universe is every script the workspace declares plus the scaffold
 * template's scripts: a doc may legitimately describe a generated project's
 * `dev`/`build` (its scripts are manager-neutral) or a workspace task, and the
 * rule's job is to catch the task that no longer exists anywhere — a renamed or
 * retired command. It deliberately does not police WHICH package a page meant.
 */
export function checkCommands(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const a = corpus.authorities;
  const hasTask = (task: string): boolean => {
    if (a.templateScripts.has(task)) return true;
    for (const scripts of a.scriptsByPackage.values()) if (scripts.has(task)) return true;
    return false;
  };
  const packageHasTask = (packageName: string, task: string): boolean =>
    a.scriptsByPackage.get(packageName)?.has(task) === true;
  const directoryHasTask = (directory: string, task: string): boolean =>
    a.scriptsByDirectory.get(directory.replace(/\/$/, ''))?.has(task) === true;
  const push = (
    file: string,
    text: string,
    index: number,
    rule: 'cli-command' | 'task-command',
    value: string,
    message: string,
  ): void => report(findings, corpus, rule, file, text, index, value, message);

  for (const [file, text] of files) {
    for (const { value, index } of codeSpans(text)) {
      if (PLACEHOLDER.test(value)) continue;
      const words = value.split(/\s+/);
      const head = words[0];

      if (head === 'vp' && words[1] === 'run') {
        const rest = words.slice(2).filter((word) => !word.startsWith('-'));
        const task = rest.find((word) => TASK_TOKEN.test(word));
        if (task === undefined) continue;
        const known = task.includes('#')
          ? packageHasTask(task.split('#')[0]!, task.split('#')[1]!)
          : hasTask(task);
        if (!known) {
          push(
            file,
            text,
            index,
            'task-command',
            value,
            `runs "${task}", which is not a script in this workspace`,
          );
        }
        continue;
      }

      if (head === 'pnpm') {
        const rest = words.slice(1);
        if (rest[0] === 'dlx' || rest[0] === 'install' || rest[0] === 'view' || rest[0] === 'exec')
          continue;
        let directory: string | null = null;
        let packageName: string | null = null;
        let cursor = 0;
        while (cursor < rest.length && rest[cursor]!.startsWith('-')) {
          const flag = rest[cursor]!;
          const argument = rest[cursor + 1] ?? '';
          if (flag === '--dir') {
            directory = argument;
            cursor += 2;
            continue;
          }
          if (flag === '--filter') {
            packageName = argument;
            cursor += 2;
            continue;
          }
          cursor += 1;
        }
        const task = rest[cursor] === 'run' ? rest[cursor + 1] : rest[cursor];
        if (task === undefined || !TASK_TOKEN.test(task)) continue;
        const known =
          (directory !== null && directoryHasTask(directory, task)) ||
          (packageName !== null && packageHasTask(packageName, task)) ||
          hasTask(task);
        if (!known) {
          push(
            file,
            text,
            index,
            'task-command',
            value,
            `runs "pnpm ${words.slice(1).join(' ')}": "${task}" is not a script anywhere in this workspace`,
          );
        }
        continue;
      }

      if (head === 'npm') {
        const rest = words.slice(1);
        const isRun = rest[0] === 'run';
        const shorthands = new Set(['test', 'start', 'build', 'dev', 'fmt', 'lint', 'typecheck']);
        const task = isRun
          ? rest.slice(1).find((word) => TASK_TOKEN.test(word))
          : rest.find((word) => TASK_TOKEN.test(word) && shorthands.has(word));
        if (task === undefined || (!isRun && !shorthands.has(task))) continue;
        if (!hasTask(task)) {
          push(
            file,
            text,
            index,
            'task-command',
            value,
            `runs "npm ${isRun ? 'run ' : ''}${task}", which is neither a repository script nor a generated-project script`,
          );
        }
        continue;
      }

      if (head === 'oe' || head === 'openelement') {
        const subcommand = words[1];
        if (subcommand === undefined || subcommand.startsWith('-')) continue;
        if (!a.cliSubcommands.has(subcommand)) {
          push(
            file,
            text,
            index,
            'cli-command',
            value,
            `${head} has no "${subcommand}" subcommand. Known: ${[...a.cliSubcommands].sort().join(', ')}`,
          );
        }
        continue;
      }
    }
  }
  return findings;
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
};

/** A count word or digit at the start of a capture. */
export function countValue(text: string): number | null {
  const word = COUNT_WORDS[text.toLowerCase()];
  if (word !== undefined) return word;
  const digits = Number.parseInt(text, 10);
  return Number.isFinite(digits) ? digits : null;
}

/**
 * 5. Gate counts: a documented step count must equal the gate script's own
 * expansion, a documented "runs in CI" count must equal the step set the fast
 * CI layer actually runs, and every step with no CI path must be named as
 * local-only on the page that describes the gate.
 */
export function checkGateCounts(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const sourceGate = '@openelement/tools-repo#gate:source';
  const steps = corpus.authorities.gateSteps.get(sourceGate) ?? [];
  const a = corpus.authorities;
  const atTasks = steps.filter((step) => step.startsWith('@')).length;
  const baseLayer = steps.filter((step) => a.ciSteps.get(step)?.layer === 'base');
  const fullLayer = steps.filter((step) => a.ciSteps.get(step)?.layer === 'full');
  const localOnly = steps.filter((step) => !a.ciSteps.has(step));

  interface Site {
    file: string;
    pattern: RegExp;
    /** One expected number per capture group, in order. */
    expected: number[];
    rule: ClaimRule;
    what: string;
  }
  const sites: Site[] = [
    {
      file: 'docs/maintainers/releasing.md',
      pattern:
        /gate:source` — the local source gate \((\w+)\s+steps: (\w+)\s+`@`-qualified tasks plus `check:dep-age`/,
      expected: [steps.length, atTasks],
      rule: 'gate-count',
      what: 'gate:source step count',
    },
    {
      file: 'CONTRIBUTING.md',
      pattern:
        /`tools\/repo#gate:source` \((\w+)\s+steps: (\w+)\s+`@`-qualified tasks plus `check:dep-age`/,
      expected: [steps.length, atTasks],
      rule: 'gate-count',
      what: 'gate:source step count',
    },
    {
      file: 'docs/maintainers/releasing.md',
      pattern: /(\w+)\s+of those steps also run in AutoFlow CI/,
      expected: [baseLayer.length],
      rule: 'gate-count-ci',
      what: 'gate:source steps in the fast CI layer',
    },
    {
      file: 'CONTRIBUTING.md',
      pattern: /(\w+)\s+of those steps also\s+run in CI through the fast jobs/,
      expected: [baseLayer.length],
      rule: 'gate-count-ci',
      what: 'gate:source steps in the fast CI layer',
    },
  ];
  for (const site of sites) {
    const text = files.get(site.file);
    if (text === undefined) {
      findings.push({
        rule: site.rule,
        file: site.file,
        line: 1,
        value: site.file,
        message: `the ${site.what} claim lives in ${site.file}, which the covered corpus does not read`,
      });
      continue;
    }
    const match = site.pattern.exec(text);
    if (!match) {
      findings.push({
        rule: site.rule,
        file: site.file,
        line: 1,
        value: site.pattern.source,
        message: `the ${site.what} claim is missing; the checker cannot verify a sentence it cannot find`,
      });
      continue;
    }
    site.expected.forEach((want, index) => {
      const said = match[index + 1];
      if (said === undefined || countValue(said) === want) return;
      findings.push({
        rule: site.rule,
        file: site.file,
        line: lineOf(text, match.index),
        value: match[0]!,
        message: `says "${said}" for the ${site.what}, but the workspace says ${want}`,
      });
    });
  }

  // Every gate step must be accounted for in prose: a step with no CI path is
  // named as local-only, and a step that only the full-qualification layer runs
  // is named there. Otherwise "which run in CI" is silently wrong.
  const releasing = files.get('docs/maintainers/releasing.md') ?? '';
  for (const step of localOnly) {
    const task = step.includes('#') ? step.split('#')[1]! : step;
    if (releasing.includes(task)) continue;
    findings.push({
      rule: 'gate-count-ci',
      file: 'docs/maintainers/releasing.md',
      line: 1,
      value: step,
      message: `gate:source step ${step} has no CI path and releasing.md never names it as local-only`,
    });
  }
  for (const step of fullLayer) {
    const task = step.includes('#') ? step.split('#')[1]! : step;
    if (releasing.includes(task)) continue;
    findings.push({
      rule: 'gate-count-ci',
      file: 'docs/maintainers/releasing.md',
      line: 1,
      value: step,
      message: `gate:source step ${step} runs only in the full-qualification layer and releasing.md never names it`,
    });
  }
  return findings;
}

/** 6. CI job names and the qualification job/instance counts. */
export function checkCiClaims(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const a = corpus.authorities;
  const requiredInstances = a.requiredCiJobs.reduce(
    (sum, job) => sum + (a.ciJobs.get(job) ?? 0),
    0,
  );

  interface Site {
    file: string;
    pattern: RegExp;
    /** One expected number per capture group, in order. */
    expected: number[];
    rule: ClaimRule;
    what: string;
  }
  const sites: Site[] = [
    {
      file: 'docs/maintainers/releasing.md',
      pattern: /every instance of the (\w+) required qualification job IDs/,
      expected: [a.requiredCiJobs.length],
      rule: 'ci-job',
      what: 'required qualification job IDs',
    },
    {
      file: 'docs/maintainers/releasing.md',
      pattern: /— (\w+) job instances in total/,
      expected: [requiredInstances],
      rule: 'ci-instances',
      what: 'qualification job instances',
    },
    {
      file: 'CONTRIBUTING.md',
      pattern: /every one of the (\w+) qualification job IDs \((\w+) instances\)/,
      expected: [a.requiredCiJobs.length, requiredInstances],
      rule: 'ci-job',
      what: 'release-train qualification set',
    },
  ];
  for (const site of sites) {
    const text = files.get(site.file);
    if (text === undefined) {
      findings.push({
        rule: site.rule,
        file: site.file,
        line: 1,
        value: site.file,
        message: `the ${site.what} claim lives in ${site.file}, which the covered corpus does not read`,
      });
      continue;
    }
    const match = site.pattern.exec(text);
    if (!match) {
      findings.push({
        rule: site.rule,
        file: site.file,
        line: 1,
        value: site.pattern.source,
        message: `the ${site.what} claim is missing; the checker cannot verify a sentence it cannot find`,
      });
      continue;
    }
    site.expected.forEach((want, index) => {
      const said = match[index + 1];
      if (said === undefined || countValue(said) === want) return;
      findings.push({
        rule: site.rule,
        file: site.file,
        line: lineOf(text, match.index),
        value: match[0]!,
        message: `says "${said}" for the ${site.what}, but the workflow says ${want}`,
      });
    });
  }

  // Backticked CI job names: `<name>` job(s) must name a real job.
  const jobRun = /((?:`[a-z][a-z0-9-]*`(?:,\s*(?:and\s+)?|\s+and\s+)?)+)\s*jobs?\b/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(jobRun)) {
      for (const name of match[1]!.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
        const job = name[1]!;
        if (a.workflowJobs.has(job)) continue;
        report(
          findings,
          corpus,
          'ci-job',
          file,
          text,
          match.index!,
          job,
          `names the "${job}" job, which no workflow declares. Known: ${[...a.workflowJobs].sort().join(', ')}`,
        );
      }
    }
  }
  return findings;
}

/** 7. `ADR-NNNN` must name an ADR that exists. */
export function checkAdrReferences(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    for (const match of text.matchAll(/ADR-(\d{4})/g)) {
      if (corpus.authorities.adrIds.has(match[1]!)) continue;
      report(
        findings,
        corpus,
        'adr',
        file,
        text,
        match.index!,
        `ADR-${match[1]}`,
        `references ADR-${match[1]}, which has no docs/adr/ADR-${match[1]}-*.md file`,
      );
    }
  }
  return findings;
}

/** 8. Backticked repository paths must exist. */
export function checkPathReferences(
  files: Map<string, string>,
  corpus: Corpus,
  root: string,
): Finding[] {
  const findings: Finding[] = [];
  const pattern =
    /`((?:packages|tools|tests|docs|www|apps|benchmarks)\/[A-Za-z0-9._/-]+\.(?:ts|tsx|json|md|yml|yaml|css|tmpl))`/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const path = match[1]!;
      if (existsSync(join(root, path))) continue;
      report(
        findings,
        corpus,
        'path',
        file,
        text,
        match.index!,
        path,
        `references ${path}, which does not exist in the tree`,
      );
    }
  }
  return findings;
}

/** 9. Every content file has its locale twin. */
export function checkParity(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    if (!file.startsWith('www/content/')) continue;
    const twin = file.endsWith('.zh.md')
      ? file.replace(/\.zh\.md$/, '.md')
      : file.replace(/\.md$/, '.zh.md');
    if (files.has(twin)) continue;
    report(
      findings,
      corpus,
      'parity',
      file,
      text,
      0,
      file,
      `${file} has no ${twin} counterpart (bilingual parity)`,
    );
  }
  return findings;
}

/** 10. POLICY: the frontmatter `lede` is the meta description; budget is 160. */
export function checkLedeBudget(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    if (!file.startsWith('www/content/')) continue;
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!frontmatter) continue;
    const lede = /^lede:\s*['"]?(.*?)['"]?\s*$/m.exec(frontmatter[1]!);
    if (!lede) continue;
    if (lede[1]!.length <= 160) continue;
    report(
      findings,
      corpus,
      'lede',
      file,
      1,
      file,
      `lede is ${lede[1]!.length} characters; the meta-description budget is 160`,
    );
  }
  return findings;
}

/** 11. "the six packages (…)" must name exactly the published packages. */
export function checkPackageCounts(files: Map<string, string>, corpus: Corpus): Finding[] {
  const findings: Finding[] = [];
  const pattern = /\bthe (\w+) packages \(([^)]*)\)/g;
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const count = countValue(match[1]!);
      const names = [...match[2]!.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]!);
      const published = corpus.authorities.publishedPackages;
      const unknown = names.filter(
        (name) => !published.some((pkg) => pkg === `@openelement/${name}`),
      );
      if (count === published.length && unknown.length === 0) continue;
      findings.push({
        rule: 'version',
        file,
        line: lineOf(text, match.index!),
        value: match[0]!,
        message:
          `says "${match[1]} packages" naming [${names.join(', ')}], but the release line publishes ` +
          `${published.length}: ${published.join(', ')}${unknown.length > 0 ? ` (unknown: ${unknown.join(', ')})` : ''}`,
      });
    }
  }
  return findings;
}

/**
 * 12. Measured-number coverage: the pages whose numbers check:doc-figures owns
 * must be inside this gate's corpus. The numbers themselves are NOT re-measured
 * here — one measurement authority, not two — but a measured page that drops
 * out of the prose corpus would silently stop being read by either gate.
 */
export function checkMeasuredCoverage(
  files: Map<string, string>,
  corpus: Corpus,
  measuredPages: string[],
): Finding[] {
  const findings: Finding[] = [];
  for (const page of measuredPages) {
    if (files.has(page)) continue;
    findings.push({
      rule: 'measured',
      file: 'www/tools/check-doc-figures.ts',
      line: 1,
      value: page,
      message:
        `${page} carries measured numbers owned by check:doc-figures but is outside the doc-claims corpus; ` +
        'add it to the covered set so its prose stays checked',
    });
  }
  return findings;
}

/** The page list check:doc-figures owns, read from its own source. */
export function measuredPages(root: string): string[] {
  const source = readFileSync(join(root, 'www/tools/check-doc-figures.ts'), 'utf8');
  const block = /const docs = \[([\s\S]*?)\]/.exec(source);
  if (!block) return [];
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckInput {
  root: string;
  files: Map<string, string>;
  authorities: Authorities;
  allowlist?: readonly AllowEntry[];
  canonical: { command: string; shape: (command: string) => string };
  ciStepEvidence?: ReadonlyMap<string, CiStepEvidence>;
  /** Pages whose measured numbers check:doc-figures owns (coverage assertion). */
  measuredPages?: string[];
}

export function checkDocClaims(input: CheckInput): Finding[] {
  const corpus: Corpus = {
    authorities: {
      ...input.authorities,
      ciSteps: input.ciStepEvidence ?? input.authorities.ciSteps,
    },
    allowlist: input.allowlist ?? ALLOWLIST,
  };
  const { files } = input;
  return [
    ...validateAllowlist(corpus.allowlist).map((message) => ({
      rule: 'path' as ClaimRule,
      file: '(allowlist)',
      line: 1,
      value: '',
      message,
    })),
    ...checkVersions(files, corpus),
    ...checkSubpaths(files, corpus),
    ...checkInstallCommands(files, corpus, input.canonical),
    ...checkCommands(files, corpus),
    ...checkGateCounts(files, corpus),
    ...checkCiClaims(files, corpus),
    ...checkAdrReferences(files, corpus),
    ...checkPathReferences(files, corpus, input.root),
    ...checkParity(files, corpus),
    ...checkLedeBudget(files, corpus),
    ...checkPackageCounts(files, corpus),
    ...checkMeasuredCoverage(files, corpus, input.measuredPages ?? []),
  ].sort((left, right) =>
    left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
  );
}

async function main(): Promise<void> {
  const reportMode = process.argv.includes('--report');
  const allowProblems = validateAllowlist();
  if (allowProblems.length > 0) {
    console.error('doc-claims: the allowlist itself is invalid:');
    for (const problem of allowProblems) console.error(`- ${problem}`);
    process.exit(1);
  }

  const files = new Map<string, string>();
  for (const file of coveredFiles(repoRoot)) {
    files.set(file, readFileSync(join(repoRoot, file), 'utf8'));
  }
  const authorities = readAuthorities(repoRoot);
  const { buildInstallCommand } = await import('./generate-install-command.ts');
  const { commandShape } = await import('./lib/install-command-shape.ts');
  const install = await buildInstallCommand();
  const findings = checkDocClaims({
    root: repoRoot,
    files,
    authorities,
    canonical: { command: install.command, shape: commandShape },
    measuredPages: measuredPages(repoRoot),
  });

  const counts = new Map<ClaimRule, number>();
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);

  if (reportMode) {
    console.log(`doc-claims inventory: ${files.size} covered files`);
    console.log(
      `authorities: ${authorities.versions.size} known versions, ${authorities.exportsByPackage.size} package export maps, ` +
        `${authorities.gateSteps.size} gate definitions, ${authorities.ciJobs.size} CI jobs, ${authorities.adrIds.size} ADRs`,
    );
    console.log(`claims failing: ${findings.length}`);
    for (const [rule, count] of [...counts].sort()) console.log(`  ${rule}: ${count}`);
    console.log('narrative classes excluded from machine checking:');
    for (const narrative of NARRATIVE_CLASSES)
      console.log(`  - ${narrative.name}: ${narrative.why}`);
    console.log(`allowlist entries (each with a reason): ${ALLOWLIST.length}`);
    if (findings.length === 0) return;
  }

  if (findings.length > 0) {
    console.error('doc-claims check failed (a documented fact disagrees with its authority):');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
    }
    process.exit(1);
  }
  console.log(
    `doc-claims check passed (${files.size} files, ${authorities.versions.size} known versions, ` +
      `${authorities.gateSteps.size} gates, ${authorities.ciJobs.size} CI jobs).`,
  );
}

if (import.meta.main) await main();
