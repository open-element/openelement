/**
 * check-agent-contract.ts — the agent development contract's drift guard
 * (#1613).
 *
 * docs/agent-contract.md states what a coding agent may rely on:
 * the canonical task entry, the generated-file map, the gate semantics, the
 * machine-readable diagnostics consumption (#1612), and the ritual commands.
 * The mechanically checkable facts in it are checked here against the same
 * facts the runtime uses — the derived blocks are never hand-copied (P6):
 *
 *   - The workspace/package inventory and the gate compositions are GENERATED
 *     blocks (markers below), rendered from the canonical discovery
 *     (tools/repo/workspace-tasks.ts) and the root package.json gate scripts.
 *     `--write` regenerates them in place; a hand edit fails the byte compare.
 *   - Every command the contract names must resolve. The executable
 *     package-qualified form is `vp run --no-cache --fail-if-no-match --filter
 *     <pkg> <task>`: it is checked against the workspace's real package name
 *     and script graph, and the shared parser (tools/repo/vp-run-form.ts)
 *     keeps this check and tools/repo/check-vp-selector-flags.ts on the same
 *     definition. The `pkg#task` specifier form is rejected here for the same
 *     reason the scan rejects it: vp resolves that form's package by exact
 *     NAME and exits 0 without running anything when it matches nothing, and
 *     `--fail-if-no-match` is inert on it (measured against vp 1.0.0). Bare
 *     `vp run` commands resolve against the root scripts; `pnpm --dir <ws> run
 *     <task>`, `node <path>`, and the `openelement build` diagnostics flags are
 *     checked against their owning files. A renamed or deleted task therefore
 *     turns the contract red — the drift guard the issue pins.
 *   - The internal gate form (`@pkg#task` inside a `node tools/repo/gate.ts`
 *     step list) is legal and is validated as such: gate.ts parses each step
 *     and dispatches it through the fail-closed filter argv, so a gate step is
 *     not a `vp run` call. Every root and workspace gate composition's steps
 *     must name an existing root script or an existing package + task, which
 *     also rejects the path-shaped `dir#task` selector at parse time.
 *   - The diagnostics-consumption section is anchored both ways: the doc must
 *     carry the envelope facts (format tag, CLI flags, parse entry points)
 *     and the owning sources must still declare them.
 *   - www/public/llms.txt is the published surface: it must exist and every
 *     repository path it links must exist.
 *
 * Scope note: this is static conformance, not execution. It proves every
 * named command RESOLVES and every internal gate step names a real package +
 * task; it does not execute the gates, prove their side effects, or prove that
 * a generated output is Git-tracked. Those are review facts, and the contract
 * says so rather than implying this check proves them. Executing every
 * documented command here would re-run the release train inside a unit check.
 *
 * External binaries named by the contract (zizmor) are recognized but not
 * resolved: they are not workspace facts. Everything else must resolve.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseGateStep, type GateStep } from './gate.ts';
import {
  CANONICAL_PACKAGE_COMMAND,
  isAnglePlaceholder,
  parseVpRunForm,
  unknownVpRunFlags,
  vpRunSpecifier,
  VP_FAIL_IF_NO_MATCH,
  VP_NO_CACHE,
} from './vp-run-form.ts';
import { readWorkspaces, type WorkspaceTasks } from './workspace-tasks.ts';

export const CONTRACT_PATH = 'docs/agent-contract.md';
export const LLMS_TXT_PATH = 'www/public/llms.txt';

/** The generated-block markers. Keep `--` out of the comment text (HTML comments may not contain a double hyphen). */
const DERIVED_BLOCKS = ['workspaces', 'gates'] as const;
export type DerivedBlockName = (typeof DERIVED_BLOCKS)[number];
const blockMarker = (name: DerivedBlockName, edge: 'start' | 'end') =>
  `<!-- derived:${name}:${edge} -->`;

/** The sources the diagnostics claims are anchored against. */
const DIAGNOSTICS_PROTOCOL_SOURCE = 'packages/protocol/src/diagnostics.ts';
const DIAGNOSTICS_CLI_SOURCE = 'packages/router/src/cli/diagnostics-exit.ts';
const DIAGNOSTICS_CLI_DISPATCH = 'packages/router/src/cli/cli.ts';
/** The router manifest must keep mapping the documented bin name. */
const ROUTER_PACKAGE_JSON = 'packages/router/package.json';

export interface ContractFacts {
  workspaces: WorkspaceTasks[];
  /** The root package.json `scripts` object (bare `vp run` targets). */
  rootScripts: Record<string, string>;
}

export async function readContractFacts(repoRoot: string): Promise<ContractFacts> {
  const workspaces = await readWorkspaces(repoRoot);
  const raw = await readFile(join(repoRoot, 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  return { workspaces, rootScripts: parsed.scripts ?? {} };
}

// ─── Command extraction ─────────────────────────────────────────────

/**
 * The command heads the contract may name. Anything else in backticks is
 * prose (a file path, a code token) and is never resolved.
 */
const COMMAND_HEADS: Array<{ head: RegExp; kind: 'vp' | 'pnpm' | 'node' | 'zizmor' | 'cli' }> = [
  { head: /^vp run /, kind: 'vp' },
  { head: /^pnpm (?:--dir \S+ )?run /, kind: 'pnpm' },
  { head: /^node (?:tools|www|packages|tests)\/\S+\.ts(?=\s|$)/, kind: 'node' },
  { head: /^zizmor /, kind: 'zizmor' },
  { head: /^openelement build\b/, kind: 'cli' },
];

/** Whether a candidate string is command-shaped (a candidate for resolution). */
export function isCommandShape(candidate: string): boolean {
  const text = stripTrailingComment(candidate.trim());
  return COMMAND_HEADS.some(({ head }) => head.test(text));
}

function stripTrailingComment(text: string): string {
  // A shell-style trailing comment is prose, never part of the command.
  const hash = text.search(/\s#/);
  return hash === -1 ? text : text.slice(0, hash).trimEnd();
}

/**
 * Extract every command from the contract: inline code spans and fenced
 * block lines, in document order. Duplicated mentions stay duplicated —
 * each site is a claim that must resolve.
 */
export function extractCommands(markdown: string): string[] {
  const commands: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const text = stripTrailingComment(line.trim());
      if (isCommandShape(text)) commands.push(text);
      continue;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const text = stripTrailingComment(match[1].trim());
      if (isCommandShape(text)) commands.push(text);
    }
  }
  return commands;
}

// ─── Command resolution ─────────────────────────────────────────────

/**
 * Resolve one command against the workspace facts. Returns null when the
 * command exists exactly as documented, else the failure reason.
 */
export function resolveCommand(
  command: string,
  facts: ContractFacts,
  repoRootDir: string,
): Promise<string | null> {
  const text = stripTrailingComment(command.trim());
  if (text.startsWith('vp run ')) return Promise.resolve(resolveVpRun(text, facts));
  if (text.startsWith('pnpm ')) return Promise.resolve(resolvePnpmRun(text, facts));
  if (text.startsWith('node ')) return resolveNodeScript(text, repoRootDir);
  if (text.startsWith('zizmor ')) return Promise.resolve(null); // external binary, not a workspace fact
  if (text.startsWith('openelement build')) return Promise.resolve(null); // anchored by the diagnostics source scan
  return Promise.resolve(`unrecognized command shape: ${text}`);
}

function resolveVpRun(text: string, facts: ContractFacts): string | null {
  const argv = text
    .slice('vp run '.length)
    .split(/\s+/)
    .filter((token) => token.length > 0);
  // The executable-form grammar is shared with tools/repo/check-vp-selector-flags.ts:
  // both must treat the `pkg#task` specifier as a defect and the filter +
  // flag + task shape as the only external package selection.
  const form = parseVpRunForm(argv);
  const unknown = unknownVpRunFlags(form);
  if (unknown.length > 0) {
    return `vp run: undocumented flag '${unknown[0]}'`;
  }
  const specifier = vpRunSpecifier(form);
  if (specifier !== undefined) {
    return (
      `vp run: '${specifier}' is the internal pkg#task specifier form; ` +
      `${VP_FAIL_IF_NO_MATCH} is inert on it and vp exits 0 when nothing matches — ` +
      `use '${CANONICAL_PACKAGE_COMMAND}'`
    );
  }
  if (!form.filterRequested) {
    if (form.positionals.length !== 1) {
      return `vp run: expected exactly one root task, got ${form.positionals.length}`;
    }
    const task = form.positionals[0]!;
    // A placeholder form (`vp run <task>`) states the SHAPE, not a runnable
    // claim: the flag checks above are its contract.
    if (isAnglePlaceholder(task)) return null;
    if (!(task in facts.rootScripts)) {
      return `vp run: no root script named '${task}'`;
    }
    return null;
  }

  // Package-qualified: the contract is the form agents copy, so it must show
  // the complete fail-closed argv, not just a flag that happens to be present.
  if (!form.failIfNoMatch) {
    return `vp run: a --filter selection must carry ${VP_FAIL_IF_NO_MATCH} (got '${text}')`;
  }
  if (!form.noCache) {
    return `vp run: a package-qualified command must carry ${VP_NO_CACHE} (a gate step is proof, not a build accelerator)`;
  }
  if (form.filter === undefined) {
    return 'vp run: a --filter selection must name a package';
  }
  if (form.positionals.length !== 1) {
    return `vp run: expected exactly one task after --filter, got ${form.positionals.length}`;
  }
  const pkg = form.filter;
  const task = form.positionals[0]!;
  // The placeholder form (`vp run --filter <pkg> <task>`) is shape-only.
  if (isAnglePlaceholder(pkg) || isAnglePlaceholder(task)) return null;
  const workspace = facts.workspaces.find((candidate) => candidate.name === pkg);
  if (!workspace) return `vp run: no workspace package named '${pkg}'`;
  if (!(task in workspace.tasks)) {
    return `vp run: ${pkg} has no task '${task}' (has: ${Object.keys(workspace.tasks).sort().join(', ')})`;
  }
  return null;
}

/** A placeholder token the contract renders instead of a literal argument. */
const PLACEHOLDER_TOKEN = /^(?:<[^>]+>|\[[^\]]+\])$/;

function resolvePnpmRun(text: string, facts: ContractFacts): string | null {
  // Placeholders are prose (<version>, [--write]); drop them, then the
  // remaining argv must be exactly `run <script>`.
  const argv = text
    .split(/\s+/)
    .filter((token) => token.length > 0 && !PLACEHOLDER_TOKEN.test(token));
  const match = /^pnpm (?:--dir (\S+) )?run (\S+)$/.exec(argv.join(' '));
  if (!match) return `pnpm run: unrecognized shape '${text}'`;
  const [, dir, script] = match;
  if (dir === undefined) {
    if (!(script in facts.rootScripts)) return `pnpm run: no root script named '${script}'`;
    return null;
  }
  const workspace = facts.workspaces.find((candidate) => candidate.workspace === dir);
  if (!workspace) return `pnpm --dir: '${dir}' is not a workspace directory`;
  if (!(script in workspace.tasks)) {
    return `pnpm --dir ${dir}: no script named '${script}'`;
  }
  return null;
}

function resolveNodeScript(text: string, repoRootDir: string): Promise<string | null> {
  // Placeholders (<version>, [--write]) are prose; resolution only cares
  // that the script path exists.
  const match = /^node (\S+\.ts)/.exec(text);
  if (!match) return Promise.resolve(`node: no script path in '${text}'`);
  return pathExists(join(repoRootDir, match[1])).then((present) =>
    present ? null : `node: no such script '${match[1]}'`,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Derived blocks ─────────────────────────────────────────────────

/** Root scripts composed through the gate coordinator, in script order. */
export interface GateComposition {
  script: string;
  steps: string[];
}

export function gateCompositions(rootScripts: Record<string, string>): GateComposition[] {
  const out: GateComposition[] = [];
  for (const [script, command] of Object.entries(rootScripts)) {
    const tokens = command.split(/\s+/);
    if (tokens[0] === 'node' && tokens[1] === 'tools/repo/gate.ts') {
      const steps = tokens.slice(2).filter((token) => token.length > 0);
      if (steps.length > 0) out.push({ script, steps });
    }
  }
  return out.sort((a, b) => a.script.localeCompare(b.script));
}

/** A gate composition plus the manifest that declares it (root or workspace). */
export interface NamedGateComposition extends GateComposition {
  owner: string;
}

/**
 * Every gate composition in the task graph, not only the root aggregate
 * scripts: workspace gates (`tools/repo#gate:source`, fixture gates, ...) run
 * through the same coordinator and use the same internal `pkg#task` step
 * notation. A step with no `#` is a ROOT script because gate.ts always
 * dispatches bare steps against the root package, even from a workspace task.
 */
export function allGateCompositions(facts: ContractFacts): NamedGateComposition[] {
  const out: NamedGateComposition[] = [];
  for (const { script, steps } of gateCompositions(facts.rootScripts)) {
    out.push({ owner: '.', script, steps });
  }
  for (const workspace of facts.workspaces) {
    for (const [script, command] of Object.entries(workspace.tasks)) {
      const tokens = command.split(/\s+/);
      if (tokens[0] !== 'node' || !tokens[1]?.endsWith('gate.ts')) continue;
      const steps = tokens.slice(2).filter((token) => token.length > 0);
      if (steps.length > 0) out.push({ owner: workspace.workspace, script, steps });
    }
  }
  return out.sort((a, b) => a.owner.localeCompare(b.owner) || a.script.localeCompare(b.script));
}

/**
 * Validate the INTERNAL gate form. `@pkg#task` is legal only as a gate.ts
 * step, where gate.ts parses it and rewrites it to the fail-closed
 * `vp run --no-cache --fail-if-no-match --filter pkg task` argv. This check
 * keeps that notation honest: the package must be an exact workspace name and
 * the task must exist, so a stale step fails the contract instead of relying
 * on the gate's runtime dispatch to discover it.
 */
export function validateGateSteps(facts: ContractFacts): string[] {
  const failures: string[] = [];
  for (const { owner, script, steps } of allGateCompositions(facts)) {
    for (const step of steps) {
      let parsed: GateStep;
      try {
        parsed = parseGateStep(step);
      } catch (error) {
        failures.push(
          `agent-contract: gate '${script}' (${owner}) has an invalid step '${step}': ${(error as Error).message}`,
        );
        continue;
      }
      if (parsed.pkg === null) {
        if (!(parsed.task in facts.rootScripts)) {
          failures.push(
            `agent-contract: gate '${script}' (${owner}) step '${step}' names no root script`,
          );
        }
        continue;
      }
      const workspace = facts.workspaces.find((candidate) => candidate.name === parsed.pkg);
      if (!workspace) {
        failures.push(
          `agent-contract: gate '${script}' (${owner}) step '${step}' names no workspace package '${parsed.pkg}'`,
        );
      } else if (!(parsed.task in workspace.tasks)) {
        failures.push(
          `agent-contract: gate '${script}' (${owner}) step '${step}' names no task '${parsed.task}' in ${parsed.pkg}`,
        );
      }
    }
  }
  return failures;
}

export function renderWorkspacesBlock(facts: ContractFacts): string {
  const rows = facts.workspaces
    .filter((ws) => ws.name !== undefined)
    .sort((a, b) => a.name!.localeCompare(b.name!))
    .map((ws) => `| \`${ws.name}\` | \`${ws.workspace}\` |`);
  return ['| Package name | Workspace directory |', '| --- | --- |', ...rows].join('\n');
}

export function renderGatesBlock(facts: ContractFacts): string {
  const compositions = gateCompositions(facts.rootScripts);
  const rows = compositions.map(
    ({ script, steps }) =>
      `| \`vp run ${script}\` | ${steps.map((step) => `\`${step}\``).join(' → ')} |`,
  );
  return [
    '| Gate | Steps, in order (the first failure stops the gate) |',
    '| --- | --- |',
    ...rows,
  ].join('\n');
}

/** Replace (or insert) one derived block's body in the markdown text. */
export function applyDerivedBlock(markdown: string, name: DerivedBlockName, body: string): string {
  const start = blockMarker(name, 'start');
  const end = blockMarker(name, 'end');
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return `${markdown.trimEnd()}\n\n${start}\n${body}\n${end}\n`;
  }
  return `${markdown.slice(0, startIndex + start.length)}\n${body}\n${markdown.slice(endIndex)}`;
}

function extractDerivedBlock(
  markdown: string,
  name: DerivedBlockName,
): { body: string; present: boolean } {
  const start = blockMarker(name, 'start');
  const end = blockMarker(name, 'end');
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { body: '', present: false };
  }
  const body = markdown
    .slice(startIndex + start.length, endIndex)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
  return { body, present: true };
}

// ─── Anchored facts ─────────────────────────────────────────────────

/** The literals the diagnostics-consumption section must share with the code. */
export interface DiagnosticsAnchors {
  formatTag: string;
  protocolLiterals: string[];
  cliLiterals: string[];
  docLiterals: string[];
}

export const DIAGNOSTICS_ANCHORS: DiagnosticsAnchors = {
  formatTag: 'openelement.diagnostics/1',
  // The consumption entry points the doc teaches, pinned to their
  // declaration sites.
  protocolLiterals: [
    'export interface DiagnosticEnvelope',
    'export interface DiagnosticReport',
    'export function parseDiagnosticReport',
    'export function errorToEnvelope',
    'export class DiagnosticReportParseError',
  ],
  cliLiterals: ["command === 'build'", '--diagnostics=json', '--diagnostics-file='],
  docLiterals: [
    'openelement.diagnostics/1',
    '--diagnostics=json',
    '--diagnostics-file=',
    'parseDiagnosticReport',
    'DiagnosticEnvelope',
  ],
};

// ─── The validator ──────────────────────────────────────────────────

/** The minimum command count before the check refuses to vacuously pass. */
export const MIN_COMMANDS = 10;

export interface ContractValidation {
  failures: string[];
  commandCount: number;
}

export async function validateContract(
  repoRootDir: string,
  facts: ContractFacts,
): Promise<ContractValidation> {
  let markdown: string;
  try {
    markdown = await readFile(join(repoRootDir, CONTRACT_PATH), 'utf8');
  } catch {
    return {
      failures: [`agent-contract: ${CONTRACT_PATH} is missing or unreadable`],
      commandCount: 0,
    };
  }
  return validateMarkdown(markdown, facts, repoRootDir);
}

/** Validate one contract document against the facts (the drift-guard core). */
export async function validateMarkdown(
  markdown: string,
  facts: ContractFacts,
  repoRootDir: string,
): Promise<ContractValidation> {
  const failures: string[] = [];

  // 1. The derived blocks must be present and byte-identical to the facts.
  const derivedBodies: Record<DerivedBlockName, string> = {
    workspaces: renderWorkspacesBlock(facts),
    gates: renderGatesBlock(facts),
  };
  for (const name of DERIVED_BLOCKS) {
    const block = extractDerivedBlock(markdown, name);
    if (!block.present) {
      failures.push(
        `agent-contract: the derived:${name} block is missing (regenerate with check-agent-contract.ts in write mode)`,
      );
      continue;
    }
    if (block.body !== derivedBodies[name]) {
      failures.push(
        `agent-contract: the derived:${name} block drifted from package.json facts (regenerate with check-agent-contract.ts in write mode)`,
      );
    }
  }

  // 2. Every gate step must resolve in its legal INTERNAL form. A gate step is
  //    not a vp invocation; gate.ts owns the rewrite to the fail-closed argv.
  failures.push(...validateGateSteps(facts));

  // 3. Every command must resolve.
  const commands = extractCommands(markdown);
  for (const command of commands) {
    const failure = await resolveCommand(command, facts, repoRootDir);
    if (failure) failures.push(`agent-contract: stale command '${command}': ${failure}`);
  }
  if (commands.length < MIN_COMMANDS) {
    failures.push(
      `agent-contract: only ${commands.length} command(s) found (need ${MIN_COMMANDS}) — refusing to vacuously pass`,
    );
  }

  // 4. The diagnostics claims must be anchored in code, and the doc must
  //    still carry them.
  const protocolSource = await readIfExists(join(repoRootDir, DIAGNOSTICS_PROTOCOL_SOURCE));
  const cliSource = await readIfExists(join(repoRootDir, DIAGNOSTICS_CLI_SOURCE));
  const cliDispatch = await readIfExists(join(repoRootDir, DIAGNOSTICS_CLI_DISPATCH));
  if (protocolSource === null) {
    failures.push(`agent-contract: ${DIAGNOSTICS_PROTOCOL_SOURCE} is missing`);
  } else {
    for (const literal of DIAGNOSTICS_ANCHORS.protocolLiterals) {
      if (!protocolSource.includes(literal)) {
        failures.push(
          `agent-contract: ${DIAGNOSTICS_PROTOCOL_SOURCE} no longer declares '${literal}' — update the contract's diagnostics section`,
        );
      }
    }
    if (!protocolSource.includes(DIAGNOSTICS_ANCHORS.formatTag)) {
      failures.push(
        'agent-contract: the diagnostics format tag no longer matches the protocol source',
      );
    }
  }
  if (cliSource === null || cliDispatch === null) {
    failures.push(
      `agent-contract: ${DIAGNOSTICS_CLI_SOURCE} / ${DIAGNOSTICS_CLI_DISPATCH} are missing`,
    );
  } else {
    for (const literal of DIAGNOSTICS_ANCHORS.cliLiterals) {
      const present = cliSource.includes(literal) || cliDispatch.includes(literal);
      if (!present) {
        failures.push(
          `agent-contract: the build CLI no longer carries '${literal}' — update the contract's diagnostics section`,
        );
      }
    }
  }
  const routerManifest = await readIfExists(join(repoRootDir, ROUTER_PACKAGE_JSON));
  if (routerManifest === null || !routerManifest.includes('"openelement"')) {
    failures.push('agent-contract: the router manifest no longer maps the openelement bin name');
  }
  for (const literal of DIAGNOSTICS_ANCHORS.docLiterals) {
    if (!markdown.includes(literal)) {
      failures.push(
        `agent-contract: the contract no longer documents '${literal}' (the diagnostics-consumption section must stay anchored)`,
      );
    }
  }

  // 5. The published llms.txt. (AGENTS.md is intentionally NOT checked: it
  //    is an owner-local, git-excluded file — `.git/info/exclude` — not a
  //    repository fact; a fresh checkout has none.)
  failures.push(...(await validateLlmsTxt(repoRootDir, markdown)));

  return { failures, commandCount: commands.length };
}

/**
 * The published llms.txt must exist and every repository link it carries must
 * resolve. GitHub blob links are checked against the tree; site links must
 * use the site origin the site's own head module declares.
 */
export async function validateLlmsTxt(
  repoRootDir: string,
  contractMarkdown: string,
): Promise<string[]> {
  const failures: string[] = [];
  const llmsPath = join(repoRootDir, LLMS_TXT_PATH);
  let text: string;
  try {
    text = await readFile(llmsPath, 'utf8');
  } catch {
    return [`agent-contract: ${LLMS_TXT_PATH} is missing — the published surface is gone`];
  }

  const siteOrigin = await readSiteOrigin(repoRootDir);
  for (const match of text.matchAll(/\(([^)]+)\)/g)) {
    const link = match[1];
    if (link.startsWith(`${siteOrigin}/`) || link === siteOrigin) {
      // Site-served surface; the site build owns existence.
      continue;
    }
    const blob =
      /^https:\/\/github\.com\/open-element\/openelement\/(?:blob|tree)\/[^/]+\/(.+)$/.exec(link);
    if (blob) {
      const path = blob[1].split('#')[0];
      if (!(await pathExists(join(repoRootDir, path)))) {
        failures.push(
          `agent-contract: ${LLMS_TXT_PATH} links to a missing repository path '${path}'`,
        );
      }
      continue;
    }
    if (link.startsWith('http')) {
      failures.push(
        `agent-contract: ${LLMS_TXT_PATH} links outside the declared surfaces: '${link}'`,
      );
    }
  }

  // The llms.txt entry for the contract must point at the contract, so the
  // published index cannot silently detach from the document it indexes.
  if (!text.includes(CONTRACT_PATH) || !contractMarkdown.includes('llms.txt')) {
    failures.push('agent-contract: llms.txt and the contract must reference each other');
  }
  return failures;
}

/**
 * The site origin, read from the site's own URL module (never restated here).
 * SITE_ORIGIN moved from head.ts to site-url.ts when the outward URL vocabulary
 * gained its single home (owner decision D-02, 2026-10-29); head.ts re-exports
 * it for its existing consumers.
 */
export async function readSiteOrigin(repoRootDir: string): Promise<string> {
  const source = await readFile(join(repoRootDir, 'www/app/site-ui/site-url.ts'), 'utf8');
  const match = /SITE_ORIGIN = '([^']+)'/.exec(source);
  if (!match) throw new Error('check-agent-contract: www/app/site-ui/site-url.ts lost SITE_ORIGIN');
  return match[1];
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

// ─── CLI ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const repoRootDir = fileURLToPath(new URL('../../', import.meta.url));
  const write = process.argv.includes('--write');
  const facts = await readContractFacts(repoRootDir);
  const contractPath = join(repoRootDir, CONTRACT_PATH);

  if (write) {
    const markdown = await readFile(contractPath, 'utf8');
    const updated = applyDerivedBlock(
      applyDerivedBlock(markdown, 'workspaces', renderWorkspacesBlock(facts)),
      'gates',
      renderGatesBlock(facts),
    );
    if (updated !== markdown) {
      await import('node:fs/promises').then((fs) => fs.writeFile(contractPath, updated, 'utf8'));
      console.log('agent-contract: derived blocks regenerated.');
    } else {
      console.log('agent-contract: derived blocks already current.');
    }
  }

  const { failures, commandCount } = await validateContract(repoRootDir, facts);
  if (failures.length > 0) {
    console.error(`agent-contract: ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`agent-contract: contract conforms (${commandCount} commands resolved).`);
}

if (import.meta.main) await main();
