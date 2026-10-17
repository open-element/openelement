/**
 * Tests for the agent-workflow packed-consumer round (#1617, alpha15 A8).
 *
 * The round's real invocation runs inside the packed-consumer gate on a packed
 * starter (no repository access, real npm/pnpm installs). These tests pin the
 * round's CONTRACT without those installs, by injecting the command runner and
 * the docs fetch:
 *
 * - positive: the break/fix round trip completes from the envelope + a
 *   resolving docs page, and the repaired app carries the authored rule;
 * - adversarial: an envelope without the fix hint fails, a docs page that
 *   404s fails, a docs page that resolves without the code fails, a "fix" that
 *   does not deliver the rule fails, and a broken app that builds green fails.
 */

import { afterEach, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_DIAGNOSTICS_FILE,
  AGENT_PROBE_COMPONENT,
  AGENT_PROBE_MARKER,
  AGENT_PROBE_SHEET,
  AGENT_ROUND_CODE,
  AgentRoundError,
  assertRepairedOutput,
  breakAppWithRefusedStyleSource,
  DocsUnreachableError,
  qualifyBrokenBuildFailure,
  readBuildDiagnosticsReport,
  resolveFailureDocsPage,
  runAgentWorkflowRound,
} from './packed-agent-round.ts';
import { parseDiagnosticReport } from '@openelement/protocol/diagnostics';

const MIGRATION_HINT =
  'static styles must array the module\'s .css file imports; "`…`" is not an array of sheet ' +
  "imports — write the sheet to a .css file, import it (`import sheet from './<component>.css'`) " +
  'and array the binding in static styles; inline sheet strings are retired (#1558)';

function reportText(options: {
  ok: boolean;
  message?: string;
  hint?: string;
  code?: string;
}): string {
  return `${JSON.stringify({
    format: 'openelement.diagnostics/1',
    ok: options.ok,
    diagnostics: options.ok
      ? []
      : [
          {
            code: options.code ?? AGENT_ROUND_CODE,
            severity: 'error',
            phase: 'build',
            message: options.message ?? MIGRATION_HINT,
            ...(options.hint === undefined ? {} : { hint: options.hint }),
            file: AGENT_PROBE_COMPONENT,
            line: 12,
            column: 26,
          },
        ],
  })}\n`;
}

const temporaryRoots: string[] = [];

async function tempApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-round-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A docs origin stub: `page` decides what `/errors` answers. */
function docsFetch(page: { status: number; body: string } | 'unreachable'): typeof fetch {
  const respond = (): Promise<Response> => {
    if (page === 'unreachable') {
      return Promise.reject(new TypeError('fetch failed: getaddrinfo ENOTFOUND'));
    }
    return Promise.resolve(
      new Response(page.body, {
        status: page.status,
        headers: { 'content-type': 'text/html' },
      }),
    );
  };
  return respond as unknown as typeof fetch;
}

const DOCS_PAGE_WITH_CODE = `<html><body><div id="${AGENT_ROUND_CODE}">OEC9029</div></body></html>`;

/**
 * The packed build CLI's behaviour, faked at the process boundary: the first
 * invocation is the broken build (report + non-zero exit), the second is the
 * repaired build (clean exit, dist output).
 */
function fakeBuildCli(appDir: string, options: { repaired?: 'clean' | 'fails' | 'no-rule' } = {}) {
  let calls = 0;
  return async (
    _command: string,
    args: readonly string[],
  ): Promise<{ success: boolean; output: string }> => {
    calls += 1;
    const fileArg = args.find((arg) => arg.startsWith('--diagnostics-file='));
    const reportPath = join(appDir, fileArg!.slice('--diagnostics-file='.length));
    if (calls === 1) {
      await mkdir(join(appDir, '.openElement'), { recursive: true });
      await writeFile(reportPath, reportText({ ok: false }));
      return { success: false, output: 'build failed: OEC9029' };
    }
    if (options.repaired === 'fails') {
      await mkdir(join(appDir, '.openElement'), { recursive: true });
      await writeFile(reportPath, reportText({ ok: false }));
      return { success: false, output: 'build still failed' };
    }
    // A clean build writes no diagnostics document.
    await rm(reportPath, { force: true });
    const pageDir = join(appDir, 'dist', 'agent-probe');
    await mkdir(pageDir, { recursive: true });
    const style =
      options.repaired === 'no-rule'
        ? '<style data-oe-static-styles>@scope (agent-probe-page) { div { color: red } }</style>'
        : `<style data-oe-static-styles>@scope (agent-probe-page) { .agent-probe-card { color: rgb(1, 2, 3) } }</style>`;
    await writeFile(
      join(pageDir, 'index.html'),
      `<html><head>${style}</head><body><div class="agent-probe-card">${AGENT_PROBE_MARKER}</div></body></html>`,
    );
    return { success: true, output: 'build ok' };
  };
}

test('the round trip completes from the envelope and a resolving docs page', async () => {
  const appDir = await tempApp();
  const lines: string[] = [];
  const transcript = await runAgentWorkflowRound({
    appDir,
    run: fakeBuildCli(appDir),
    log: (line) => lines.push(line),
    fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
  });

  expect(transcript.failureCode).toBe(AGENT_ROUND_CODE);
  expect(transcript.fixHint).toContain('static styles');
  expect(transcript.docs.status).toBe('resolved');
  expect(transcript.docs.url).toBe(`https://openelement.org/errors#${AGENT_ROUND_CODE}`);
  expect(transcript.brokenBuildFailed).toBe(true);
  expect(transcript.fixedBuildClean).toBe(true);
  expect(transcript.deliveredRule).toContain('index.html');

  // The applied fix is the admitted form: a real sheet, default-imported and
  // arrayed — and the retired inline string is gone.
  const component = await readFile(join(appDir, AGENT_PROBE_COMPONENT), 'utf8');
  expect(component).toContain("import agentProbeCardSheet from './agent-probe-card.css';");
  expect(component).toContain('static override styles = [agentProbeCardSheet];');
  expect(component).not.toContain('static override styles = `');
  expect(existsSync(join(appDir, AGENT_PROBE_SHEET))).toBe(true);
  expect(lines.join('\n')).toContain('docs page resolved');
});

test('an envelope without the fix hint fails the round', async () => {
  const appDir = await tempApp();
  const hintless = fakeBuildCli(appDir);
  const run = async (command: string, args: readonly string[]) => {
    const result = await hintless(command, args);
    const reportPath = join(appDir, '.openElement', 'agent-round-diagnostics.json');
    await writeFile(
      reportPath,
      reportText({ ok: false, message: 'static styles is not an array of sheet imports' }),
    );
    return result;
  };
  await expect(
    runAgentWorkflowRound({
      appDir,
      run,
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
    }),
  ).rejects.toThrow(/does not carry a fix/);
});

test('a docs page that 404s fails the round', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: fakeBuildCli(appDir),
      log: () => {},
      fetchImpl: docsFetch({ status: 404, body: '<html>not found</html>' }),
    }),
  ).rejects.toThrow(/answered HTTP 404/);
});

test('a docs page that resolves without the code fails the round', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: fakeBuildCli(appDir),
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: '<html><body>no codes here</body></html>' }),
    }),
  ).rejects.toThrow(/does not document OEC9029/);
});

test('an unreachable docs origin fails by default and is a loud skip when asked', async () => {
  const strictApp = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir: strictApp,
      run: fakeBuildCli(strictApp),
      log: () => {},
      fetchImpl: docsFetch('unreachable'),
    }),
  ).rejects.toBeInstanceOf(DocsUnreachableError);

  const lenientApp = await tempApp();
  const lines: string[] = [];
  const transcript = await runAgentWorkflowRound({
    appDir: lenientApp,
    run: fakeBuildCli(lenientApp),
    log: (line) => lines.push(line),
    fetchImpl: docsFetch('unreachable'),
    docsWhenUnreachable: 'skip',
  });
  expect(transcript.docs.status).toBe('skipped');
  expect(lines.join('\n')).toContain('SKIP');
});

test('a repaired build that still fails the round', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: fakeBuildCli(appDir, { repaired: 'fails' }),
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
    }),
  ).rejects.toThrow(/still fails to build/);
});

test('a repaired build that drops the authored rule fails the round', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: fakeBuildCli(appDir, { repaired: 'no-rule' }),
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
    }),
  ).rejects.toThrow(/delivered no rule/);
});

test('a deliberately broken app that builds green fails the round', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: () => Promise.resolve({ success: true, output: 'built clean' }),
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
    }),
  ).rejects.toThrow(/built green/);
});

test('a failed build with no diagnostics document fails the round', async () => {
  const appDir = await tempApp();
  await expect(readBuildDiagnosticsReport(appDir, 'build exploded')).rejects.toThrow(
    /wrote no diagnostics document/,
  );
});

test('the broken write is the refused style-source form', async () => {
  const appDir = await tempApp();
  await breakAppWithRefusedStyleSource(appDir);
  const component = await readFile(join(appDir, AGENT_PROBE_COMPONENT), 'utf8');
  expect(component).toContain('static override styles = `');
  expect(component).toContain("@element('agent-probe-card', { root: 'light' })");
  expect(existsSync(join(appDir, 'app/routes/agent-probe.tsx'))).toBe(true);
});

test('qualifyBrokenBuildFailure rejects a clean report and an unrelated code', () => {
  const clean = parseDiagnosticReport(reportText({ ok: true }));
  expect(() => qualifyBrokenBuildFailure(clean)).toThrow(/built clean/);

  const unrelated = parseDiagnosticReport(reportText({ ok: false, code: 'OEC9013' }));
  expect(() => qualifyBrokenBuildFailure(unrelated)).toThrow(/reported no OEC9029/);

  const qualified = qualifyBrokenBuildFailure(parseDiagnosticReport(reportText({ ok: false })));
  expect(qualified.diagnostic.code).toBe(AGENT_ROUND_CODE);
  expect(qualified.fixHint).toContain('#1558');
});

test('the fix hint may ride the envelope hint field instead of the message', () => {
  const report = parseDiagnosticReport(
    reportText({ ok: false, message: 'static styles is not an array', hint: MIGRATION_HINT }),
  );
  expect(qualifyBrokenBuildFailure(report).fixHint).toContain('static styles');
});

test('docs failures name external unavailability separately from a candidate defect', async () => {
  const unreachable = await resolveFailureDocsPage({
    code: AGENT_ROUND_CODE,
    origin: 'https://openelement.org',
    fetchImpl: docsFetch('unreachable'),
  }).catch((cause: unknown) => cause);
  expect(unreachable).toBeInstanceOf(DocsUnreachableError);
  expect((unreachable as Error).message).toContain('docs origin unreachable (external)');
  expect((unreachable as Error).message).toContain('not evidence about the candidate');

  const missingCode = await resolveFailureDocsPage({
    code: AGENT_ROUND_CODE,
    origin: 'https://openelement.org',
    fetchImpl: docsFetch({ status: 200, body: '<html><body>no codes here</body></html>' }),
  }).catch((cause: unknown) => cause);
  expect(missingCode).toBeInstanceOf(AgentRoundError);
  expect(missingCode).not.toBeInstanceOf(DocsUnreachableError);
  expect((missingCode as Error).message).toContain('candidate defect');
  expect((missingCode as Error).message).toContain('docs page exists but does not carry');

  const notFound = await resolveFailureDocsPage({
    code: AGENT_ROUND_CODE,
    origin: 'https://openelement.org',
    fetchImpl: docsFetch({ status: 404, body: '<html>not found</html>' }),
  }).catch((cause: unknown) => cause);
  expect(notFound).toBeInstanceOf(AgentRoundError);
  expect(notFound).not.toBeInstanceOf(DocsUnreachableError);
  expect((notFound as Error).message).toContain('candidate defect');
});

test('docsWhenUnreachable skip never absorbs a candidate docs defect', async () => {
  const appDir = await tempApp();
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: fakeBuildCli(appDir),
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: '<html><body>no codes here</body></html>' }),
      docsWhenUnreachable: 'skip',
    }),
  ).rejects.toThrow(/candidate defect/);
});

test('resolveFailureDocsPage refuses a non-200 answer', async () => {
  await expect(
    resolveFailureDocsPage({
      code: AGENT_ROUND_CODE,
      origin: 'https://openelement.org',
      fetchImpl: docsFetch({ status: 500, body: 'boom' }),
    }),
  ).rejects.toThrow(/HTTP 500/);
});

test('resolveFailureDocsPage derives the anchor from the code', async () => {
  const resolved = await resolveFailureDocsPage({
    code: 'OEC9013',
    origin: 'https://openelement.org/',
    fetchImpl: docsFetch({ status: 200, body: '<div id="OEC9013"></div>' }),
  });
  expect(resolved.pageUrl).toBe('https://openelement.org/errors');
  expect(resolved.anchorUrl).toBe('https://openelement.org/errors#OEC9013');
});

test('assertRepairedOutput requires the rendered page and the delivered rule', async () => {
  const appDir = await tempApp();
  await mkdir(join(appDir, 'dist', 'agent-probe'), { recursive: true });
  await writeFile(
    join(appDir, 'dist', 'agent-probe', 'index.html'),
    `<html><body><div class="agent-probe-card">${AGENT_PROBE_MARKER}</div></body></html>`,
  );
  await expect(assertRepairedOutput(appDir)).rejects.toThrow(/delivered no rule/);

  const assets = join(appDir, 'dist', 'client', 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, 'abc123.css'), '.agent-probe-card{color:rgb(1,2,3)}');
  await expect(assertRepairedOutput(appDir)).resolves.toContain('abc123.css');
});

test('a clean repaired build that writes no diagnostics document is accepted', async () => {
  const appDir = await tempApp();
  const transcript = await runAgentWorkflowRound({
    appDir,
    run: fakeBuildCli(appDir),
    log: () => {},
    fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
  });
  expect(transcript.fixedBuildClean).toBe(true);
  // The contract's clean-exit channel is silence: no report is written. The
  // round must accept that (and the faked CLI stands in for it here).
  expect(existsSync(join(appDir, AGENT_DIAGNOSTICS_FILE))).toBe(false);
});

test('a repaired build that still reports the failure code is rejected', async () => {
  const appDir = await tempApp();
  const cli = fakeBuildCli(appDir);
  let calls = 0;
  await expect(
    runAgentWorkflowRound({
      appDir,
      run: async (command, args) => {
        calls += 1;
        const result = await cli(command, args);
        if (calls === 2) {
          // Green exit, but the exit report survives and still names the code.
          await mkdir(join(appDir, '.openElement'), { recursive: true });
          await writeFile(
            join(appDir, '.openElement', 'agent-round-diagnostics.json'),
            reportText({ ok: false }),
          );
        }
        return result;
      },
      log: () => {},
      fetchImpl: docsFetch({ status: 200, body: DOCS_PAGE_WITH_CODE }),
    }),
  ).rejects.toThrow(/still reported OEC9029/);
});

test('AgentRoundError keeps its name for gate diagnostics', () => {
  expect(new AgentRoundError('x').name).toBe('AgentRoundError');
});
