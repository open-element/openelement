/**
 * Agent-workflow packed-consumer qualification (#1617, alpha15 A8) — the
 * break/fix round.
 *
 * The packed-consumer family already qualifies each SURFACE (starter, ui
 * appliance, element, router, uno) as a consumer. This round qualifies a
 * different actor: a coding agent that has **no repository access** — only the
 * packed tarballs it installed, the public build CLI's own output, and the
 * public docs site. The round is therefore not a smoke test of the happy path;
 * it is a proof that a deliberately broken app can be diagnosed and repaired
 * from public artifacts alone:
 *
 *   1. **Break** — the scaffold's app is extended with a documented failure
 *      class: a component whose `static styles` carries the retired inline
 *      sheet string. The one style authoring form is a `.css` file import
 *      arrayed in `static styles` (#1558); every other shape is refused by the
 *      compiler with `OEC9029`.
 *   2. **Diagnose** — the app's own packed build CLI runs with the #1612
 *      machine-readable exit (`--diagnostics-file=<path>`); the report is
 *      parsed with the public `parseDiagnosticReport`
 *      (`@openelement/protocol/diagnostics`) — never by grepping the human log.
 *   3. **Derive the fix from public artifacts alone** — the diagnostic's own
 *      message carries the migration recipe, and the public error reference
 *      (`/errors` on the docs site) must document the code it names. Both are
 *      required: a failure whose output carries no fix hint fails the round,
 *      and so does a docs page that does not resolve the code.
 *   4. **Repair and re-qualify** — the fix the public artifacts prescribe is
 *      applied (the sheet moves to a real `.css` file and is arrayed), the
 *      build must go clean, and the authored rule must actually reach the
 *      built output. A "fix" that builds green while dropping the stylesheet
 *      is not a fix.
 *
 * Failure attribution for the docs lookup (the round's only network input):
 *   - **docs origin unreachable (external)** — DNS/TLS/timeout/connection
 *     failure before any page is read. This says nothing about the candidate;
 *     it fails as DocsUnreachableError so the gate log can attribute the red to
 *     an external outage instead of a candidate defect.
 *   - **the docs page exists but does not carry the code (candidate defect)** —
 *     the origin answered, but the page is missing or lacks the code's entry.
 *     This is a candidate/public-artifact defect and always fails; it is never
 *     converted into a skip. An explicit offline run may skip only the first
 *     class (`docsWhenUnreachable: 'skip'`).
 *
 * Nothing in steps 1-4 reads the repository: every input is the installed app
 * tree, the build's own output, or the public docs origin. The caller
 * (`consumer-packaged-starter.ts`) re-asserts the closed world — no consumer
 * module may resolve into this checkout — immediately before the round runs.
 *
 * Placement: the round rides the existing packed-consumer gate family
 * (`@openelement/tools-release#consumer:packaged`, inside `gate:packed`), on
 * the already-installed packed starter, so it adds no CI lane and no install.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type DiagnosticEnvelope,
  type DiagnosticReport,
  parseDiagnosticReport,
} from '@openelement/protocol/diagnostics';

/** The documented failure class the round introduces (refused style source). */
export const AGENT_ROUND_CODE = 'OEC9029';

/** The probe route: a new route file is discovered by convention, no config. */
export const AGENT_PROBE_ROUTE = 'app/routes/agent-probe.tsx';
/** The deliberately broken component the route renders. */
export const AGENT_PROBE_COMPONENT = 'app/components/agent-probe-card.tsx';
/** The sheet the fix creates (the admitted style source form). */
export const AGENT_PROBE_SHEET = 'app/components/agent-probe-card.css';
/** The probe tag — the token the delivered rule and the built markup carry. */
export const AGENT_PROBE_TAG = 'agent-probe-card';
/** Copy marker proving the repaired page actually rendered. */
export const AGENT_PROBE_MARKER = 'Agent workflow probe';
/** The build's machine-readable exit document (relative to the app root). */
export const AGENT_DIAGNOSTICS_FILE = '.openElement/agent-round-diagnostics.json';

/**
 * The public error reference the failing code must be documented on. This is
 * the docs surface the envelope's code names — `/errors` is the published
 * catalogue "every `OEC####` / `OE_*` diagnostic code with its message"
 * (`www/public/llms.txt`, the published consumer index).
 */
export const DOCS_ERROR_REFERENCE_PATH = '/errors';

/** The public docs origin; overridable for hermetic or mirrored runs. */
export const DEFAULT_DOCS_ORIGIN = 'https://openelement.org';

/**
 * Upper bound on the docs lookup. An external outage must fail the round in
 * bounded time with the external attribution, not hang the packed gate.
 */
const DOCS_FETCH_TIMEOUT_MS = 30_000;

/** One command's outcome, the shape `runProcess` in the shared module returns. */
export interface AgentRoundCommandResult {
  success: boolean;
  output: string;
}

export interface AgentRoundOptions {
  /** The installed consumer app (the packed starter) the round operates on. */
  appDir: string;
  /** Run one command inside the app; the caller owns process wiring. */
  run(command: string, args: readonly string[], label: string): Promise<AgentRoundCommandResult>;
  /** Progress output; defaults to stdout. */
  log?(line: string): void;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Public docs origin; defaults to {@linkcode DEFAULT_DOCS_ORIGIN}. */
  docsOrigin?: string;
  /**
   * What an UNREACHABLE docs origin means. `'fail'` (default) fails the round
   * with DocsUnreachableError, labelled "docs origin unreachable (external)" —
   * an availability failure, not a candidate defect. `'skip'` records a loud
   * skip for an explicitly offline run only. A docs page that RESOLVES but is
   * missing or does not carry the code is a candidate defect and always fails;
   * it is never skippable.
   */
  docsWhenUnreachable?: 'fail' | 'skip';
}

/** What the round leaves behind for the gate log (the closure evidence). */
export interface AgentRoundTranscript {
  failureCode: string;
  failureMessage: string;
  fixHint: string;
  docs: { status: 'resolved' | 'skipped'; url?: string; detail: string };
  brokenBuildFailed: true;
  fixedBuildClean: true;
  deliveredRule: string;
}

/** The fix the public artifacts prescribe, in applicable form. */
export interface StyleFixPlan {
  /** App-relative path of the `.css` sheet the fix writes. */
  sheetPath: string;
  /** The default-import specifier the component must carry. */
  importSpecifier: string;
  /** The binding adopted by `static styles`. */
  binding: string;
  /** The `static styles` initializer the admitted form arrays. */
  stylesInitializer: string;
}

/** A coded failure the round refuses to continue past. */
export class AgentRoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRoundError';
  }
}

/**
 * The public docs origin could not be reached at all (offline, DNS, TLS,
 * timeout) — EXTERNAL, i.e. not evidence about the candidate. The round fails
 * with this class by default so the gate log can distinguish an outage from a
 * candidate docs defect; only an explicit offline run may skip it.
 */
export class DocsUnreachableError extends AgentRoundError {
  constructor(message: string) {
    super(message);
    this.name = 'DocsUnreachableError';
  }
}

/**
 * The broken component: the retired inline sheet string. The compiler refuses
 * it (OEC9029) — the shape is exactly the migration #1558 documented, so the
 * diagnostic's own message names the repair.
 */
const BROKEN_COMPONENT_SOURCE = `/**
 * agent-probe-card — the qualification's deliberately broken component.
 *
 * Presentation is authored as an inline sheet string, the form retired with
 * #1558. The compiler refuses it: a compiled module's sheets are real .css
 * files imported into the module and arrayed in \`static styles\`.
 */
import { element, OpenElement } from '@openelement/element';

@element('${AGENT_PROBE_TAG}', { root: 'light' })
export default class AgentProbeCard extends OpenElement {
  static override styles = \`
.${AGENT_PROBE_TAG} {
  color: rgb(1, 2, 3);
}
\`;

  render() {
    return <div class='${AGENT_PROBE_TAG}'>${AGENT_PROBE_MARKER}</div>;
  }
}
`;

/** The route that renders the probe, so the compiler has to compile it. */
const PROBE_ROUTE_SOURCE = `/** The agent-workflow qualification's probe route (packed-consumer gate only). */
import { definePage } from '@openelement/router';
import AgentProbeCard from '../components/agent-probe-card.tsx';

export default definePage(AgentProbeCard, {
  head: { title: 'Agent workflow probe' },
});
`;

/** The sheet the fix writes — the same rule, now a real style source. */
const PROBE_SHEET_SOURCE = `/* agent-probe-card — written by the documented fix (file-based styles, #1558). */
.${AGENT_PROBE_TAG} {
  color: rgb(1, 2, 3);
}
`;

/** Write one app-relative file, creating the directories it needs. */
async function writeAppFile(appDir: string, relativePath: string, text: string): Promise<void> {
  const path = join(appDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/**
 * The repaired component: the admitted form the diagnostic prescribes — a
 * `.css` file, imported by default, arrayed in `static styles`.
 */
function fixedComponentSource(plan: StyleFixPlan): string {
  return `/**
 * agent-probe-card — repaired from the public artifacts alone: the diagnostic
 * named the form and the docs page resolved the code.
 */
import { element, OpenElement } from '@openelement/element';
import ${plan.binding} from '${plan.importSpecifier}';

@element('${AGENT_PROBE_TAG}', { root: 'light' })
export default class AgentProbeCard extends OpenElement {
  static override styles = ${plan.stylesInitializer};

  render() {
    return <div class='${AGENT_PROBE_TAG}'>${AGENT_PROBE_MARKER}</div>;
  }
}
`;
}

/** Write the break into the app: the probe component and its route. */
export async function breakAppWithRefusedStyleSource(appDir: string): Promise<void> {
  await writeAppFile(appDir, AGENT_PROBE_COMPONENT, BROKEN_COMPONENT_SOURCE);
  await writeAppFile(appDir, AGENT_PROBE_ROUTE, PROBE_ROUTE_SOURCE);
}

/**
 * Read the machine-readable exit document the packed build CLI wrote.
 *
 * The envelope is read from the FILE — the documented channel — and parsed by
 * the public parser. A failed build that wrote no document is a harness
 * failure in its own right: the round can only qualify what it can read.
 */
export async function readBuildDiagnosticsReport(
  appDir: string,
  buildOutput: string,
): Promise<DiagnosticReport> {
  const path = join(appDir, AGENT_DIAGNOSTICS_FILE);
  if (!existsSync(path)) {
    throw new AgentRoundError(
      `the packed build failed but wrote no diagnostics document at ${AGENT_DIAGNOSTICS_FILE} — ` +
        `the #1612 machine-readable exit did not reach the file. Build output:\n${buildOutput}`,
    );
  }
  const text = await readFile(path, 'utf8');
  try {
    return parseDiagnosticReport(text);
  } catch (cause) {
    throw new AgentRoundError(
      `the diagnostics document at ${AGENT_DIAGNOSTICS_FILE} did not parse as an ` +
        `openelement.diagnostics/1 report: ${(cause as Error).message}`,
    );
  }
}

/** The fix hint the environment must carry: the migration recipe, not a code alone. */
function fixRecipeOf(diagnostic: DiagnosticEnvelope): string {
  const text = `${diagnostic.message}\n${diagnostic.hint ?? ''}`;
  const missing = [
    [/\.css\b/i, 'the `.css` file target'],
    [/static styles/i, 'the `static styles` array'],
    [/#1558|retired/i, 'the retirement note pointing at the current form'],
  ]
    .filter(([pattern]) => !(pattern as RegExp).test(text))
    .map(([, label]) => label as string);
  if (missing.length > 0) {
    throw new AgentRoundError(
      `the diagnostic for ${diagnostic.code} does not carry a fix a reader can apply from public ` +
        `artifacts alone — missing ${missing.join(', ')}. Message: ${diagnostic.message}`,
    );
  }
  return text.trim();
}

/** The documented failure the round qualifies: one error envelope, with its fix. */
export interface QualifiedFailure {
  diagnostic: DiagnosticEnvelope;
  fixHint: string;
}

/**
 * Assert the broken build failed the documented way: a failing report carrying
 * the expected code at error severity, with the fix hint in the output.
 */
export function qualifyBrokenBuildFailure(report: DiagnosticReport): QualifiedFailure {
  if (report.ok) {
    throw new AgentRoundError(
      'the deliberately broken app built clean — the refused style source did not fail the build, ' +
        'so there is no break/fix round to qualify',
    );
  }
  const diagnostic = report.diagnostics.find(
    (candidate) => candidate.code === AGENT_ROUND_CODE && candidate.severity === 'error',
  );
  if (diagnostic === undefined) {
    throw new AgentRoundError(
      `the broken build reported no ${AGENT_ROUND_CODE} error; codes seen: ` +
        `${report.diagnostics.map((candidate) => candidate.code).join(', ') || '<none>'}`,
    );
  }
  return { diagnostic, fixHint: fixRecipeOf(diagnostic) };
}

/**
 * Turn the diagnostic into the fix to apply. The paths are the probe's own —
 * the recipe is read out of the output, the file names are the harness's.
 */
export function deriveStyleFixPlan(diagnostic: DiagnosticEnvelope): StyleFixPlan {
  if (diagnostic.code !== AGENT_ROUND_CODE) {
    throw new AgentRoundError(
      `expected a ${AGENT_ROUND_CODE} refusal to repair, got ${diagnostic.code}`,
    );
  }
  fixRecipeOf(diagnostic);
  return {
    sheetPath: AGENT_PROBE_SHEET,
    importSpecifier: './agent-probe-card.css',
    binding: 'agentProbeCardSheet',
    stylesInitializer: '[agentProbeCardSheet]',
  };
}

/** Apply the prescribed fix: write the sheet, rewrite the component. */
export async function applyDocumentedFix(appDir: string, plan: StyleFixPlan): Promise<void> {
  await writeAppFile(appDir, plan.sheetPath, PROBE_SHEET_SOURCE);
  await writeAppFile(appDir, AGENT_PROBE_COMPONENT, fixedComponentSource(plan));
}

export interface DocsResolution {
  /** The final page URL (redirects followed). */
  pageUrl: string;
  /** The page URL pinned to the failing code's entry. */
  anchorUrl: string;
  status: number;
}

/**
 * Resolve the docs page the failing code is documented on.
 *
 * Two failure classes, deliberately kept distinct:
 *   - the origin cannot be reached at all (fetch rejects, DNS/TLS/connection,
 *     or the bounded timeout elapses) -> DocsUnreachableError, labelled
 *     "docs origin unreachable (external)": an availability failure that says
 *     nothing about the candidate;
 *   - the origin answers but the page is missing (non-200) or resolves without
 *     the code's entry -> AgentRoundError, labelled "candidate defect": the
 *     public documentation surface is reachable but does not carry the fix, so
 *     the positive assertion fails exactly as before and can never be skipped.
 */
export async function resolveFailureDocsPage(options: {
  code: string;
  origin: string;
  fetchImpl: typeof fetch;
}): Promise<DocsResolution> {
  const pageUrl = new URL(DOCS_ERROR_REFERENCE_PATH, options.origin).href;
  let response: Response;
  try {
    response = await options.fetchImpl(pageUrl, {
      redirect: 'follow',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new DocsUnreachableError(
      `docs origin unreachable (external): ${pageUrl} could not be read within ` +
        `${DOCS_FETCH_TIMEOUT_MS}ms — this is a docs-site availability failure, not evidence ` +
        `about the candidate. ${(cause as Error).message}`,
    );
  }
  if (response.status !== 200) {
    throw new AgentRoundError(
      `candidate defect: the docs page for ${options.code} does not resolve — answered HTTP ` +
        `${response.status} (${pageUrl}); the fix's documentation is not readable. The docs ` +
        'origin answered, so this is not an external outage',
    );
  }
  const html = await response.text();
  if (!new RegExp(`id="${options.code}"`).test(html)) {
    throw new AgentRoundError(
      `the docs page exists but does not carry the code (candidate defect): ${pageUrl} does not ` +
        `document ${options.code}; the failure's fix cannot be resolved from the public docs. ` +
        'The docs origin answered, so this is not an external outage',
    );
  }
  return { pageUrl, anchorUrl: `${pageUrl}#${options.code}`, status: response.status };
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map((entry) => join(root, entry));
}

/**
 * Material proof the repaired build really delivered the style source: the
 * authored selector must be present in an emitted `.css` asset or in a
 * document's own style block, and the probe page must carry the rendered copy.
 * A green exit that dropped the sheet is not a fixed app.
 */
export async function assertRepairedOutput(appDir: string): Promise<string> {
  const dist = join(appDir, 'dist');
  if (!existsSync(dist)) {
    throw new AgentRoundError('the repaired build emitted no dist/ directory');
  }
  const files = await walkFiles(dist);
  const page = files.find((file) => file.endsWith(join('agent-probe', 'index.html')));
  if (page === undefined) {
    throw new AgentRoundError(
      'the repaired build emitted no agent-probe page — the probe route was not rendered',
    );
  }
  const pageHtml = await readFile(page, 'utf8');
  if (!pageHtml.includes(AGENT_PROBE_MARKER)) {
    throw new AgentRoundError(
      `the repaired agent-probe page does not carry the probe copy (${AGENT_PROBE_MARKER})`,
    );
  }
  const styleBlocks = [...pageHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1] ?? '',
  );
  const tokenInPage = styleBlocks.some((block) => block.includes(`.${AGENT_PROBE_TAG}`));
  if (tokenInPage) return `${page} (inline marked style block)`;
  for (const file of files) {
    if (!file.endsWith('.css')) continue;
    const css = await readFile(file, 'utf8');
    if (css.includes(`.${AGENT_PROBE_TAG}`)) return file;
  }
  throw new AgentRoundError(
    `the repaired build delivered no rule for .${AGENT_PROBE_TAG} — neither an emitted .css asset ` +
      'nor a document style block carries the authored selector',
  );
}

/** Remove the diagnostics document so the next build's exit writes fresh. */
async function clearDiagnosticsFile(appDir: string): Promise<void> {
  await rm(join(appDir, AGENT_DIAGNOSTICS_FILE), { force: true });
}

/**
 * Run the break/fix round against an installed packed consumer app.
 *
 * The build CLI is driven exactly as an adopter would drive it — the app's own
 * `oe` bin through `npm exec`, with the documented `--diagnostics-file` flag.
 */
export async function runAgentWorkflowRound(
  options: AgentRoundOptions,
): Promise<AgentRoundTranscript> {
  const log = options.log ?? ((line: string) => console.log(line));
  const appDir = options.appDir;

  // 1. Break: the retired inline sheet string, reachable from a route.
  await breakAppWithRefusedStyleSource(appDir);
  log(`[agent-round] broke the app with a refused style source (${AGENT_PROBE_COMPONENT})`);

  // 2. Diagnose: the packed CLI's own machine-readable exit.
  await clearDiagnosticsFile(appDir);
  const broken = await options.run(
    'npm',
    ['exec', 'oe', '--', 'build', `--diagnostics-file=${AGENT_DIAGNOSTICS_FILE}`],
    'agent-round broken build',
  );
  if (broken.success) {
    throw new AgentRoundError(
      `the deliberately broken app built green — no failure to qualify.\n${broken.output}`,
    );
  }
  const report = await readBuildDiagnosticsReport(appDir, broken.output);
  const failure = qualifyBrokenBuildFailure(report);
  log(
    `[agent-round] the failure surfaced through #1612: ${failure.diagnostic.code} ` +
      `(${failure.diagnostic.phase}, ${failure.diagnostic.severity})`,
  );

  // 3. Derive the fix from public artifacts alone.
  const plan = deriveStyleFixPlan(failure.diagnostic);
  log(`[agent-round] fix hint read from the diagnostic: ${firstLine(failure.fixHint)}`);

  const origin = options.docsOrigin ?? DEFAULT_DOCS_ORIGIN;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let docs: AgentRoundTranscript['docs'];
  try {
    const resolved = await resolveFailureDocsPage({
      code: failure.diagnostic.code,
      origin,
      fetchImpl,
    });
    docs = {
      status: 'resolved',
      url: resolved.anchorUrl,
      detail: `HTTP ${resolved.status}, the code's entry is on the page`,
    };
    log(`[agent-round] docs page resolved: ${resolved.anchorUrl}`);
  } catch (cause) {
    if (cause instanceof DocsUnreachableError && options.docsWhenUnreachable === 'skip') {
      docs = { status: 'skipped', detail: cause.message };
      log(`[agent-round] SKIP — ${cause.message} (docsWhenUnreachable=skip)`);
    } else {
      throw cause;
    }
  }

  // 4. Repair, re-build, and prove the stylesheet survived the round trip.
  await applyDocumentedFix(appDir, plan);
  await clearDiagnosticsFile(appDir);
  const repaired = await options.run(
    'npm',
    ['exec', 'oe', '--', 'build', `--diagnostics-file=${AGENT_DIAGNOSTICS_FILE}`],
    'agent-round repaired build',
  );
  if (!repaired.success) {
    throw new AgentRoundError(
      `the repaired app still fails to build:\n${repaired.output}\n` +
        (existsSync(join(appDir, AGENT_DIAGNOSTICS_FILE))
          ? `diagnostics: ${await readFile(join(appDir, AGENT_DIAGNOSTICS_FILE), 'utf8')}`
          : 'no diagnostics document was written'),
    );
  }
  // A green exit must be a CLEAN exit: a surviving report is read and must not
  // still carry the failure class.
  if (existsSync(join(appDir, AGENT_DIAGNOSTICS_FILE))) {
    const repairedReport = await readBuildDiagnosticsReport(appDir, repaired.output);
    const survivor = repairedReport.diagnostics.find(
      (candidate) => candidate.code === AGENT_ROUND_CODE,
    );
    if (survivor !== undefined) {
      throw new AgentRoundError(
        `the repaired build exited green but still reported ${AGENT_ROUND_CODE}: ${survivor.message}`,
      );
    }
  }
  const deliveredRule = await assertRepairedOutput(appDir);
  log(`[agent-round] repaired build clean; the authored rule reached ${deliveredRule}`);

  return {
    failureCode: failure.diagnostic.code,
    failureMessage: failure.diagnostic.message,
    fixHint: failure.fixHint,
    docs,
    brokenBuildFailed: true,
    fixedBuildClean: true,
    deliveredRule,
  };
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}
