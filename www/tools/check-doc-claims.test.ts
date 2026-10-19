/**
 * doc-claims tests: the rules must fail on a seeded drift and pass on the
 * authoritative text. Each test seeds ONE wrong claim into an otherwise valid
 * corpus, so a passing run cannot hide a rule that stopped firing.
 */
import { describe, expect, test } from 'vitest';
import {
  ALLOWLIST,
  checkDocClaims,
  checkMeasuredCoverage,
  checkParity,
  codeSpans,
  countValue,
  validateAllowlist,
  type Authorities,
} from './check-doc-claims.ts';
import { commandShape } from './lib/install-command-shape.ts';

const canonical = { command: 'npm create @openelement my-app', shape: commandShape };

function authorities(overrides: Partial<Authorities> = {}): Authorities {
  return {
    versions: new Set(['1.0.0-alpha.15', '1.0.0-alpha.14', '8.0.16', '6.0.3', '24.18.0']),
    exportsByPackage: new Map([
      ['@openelement/router', new Set(['.', './vite', './cli/build', './cli/start'])],
      ['@openelement/create', new Set(['.', './install-command'])],
    ]),
    scriptsByPackage: new Map([
      ['root', new Set(['check', 'verify', 'gate:release'])],
      ['@openelement/tools-repo', new Set(['typecheck', 'seams:check'])],
    ]),
    scriptsByDirectory: new Map([
      ['.', new Set(['check', 'verify'])],
      ['tools/repo', new Set(['typecheck', 'seams:check'])],
    ]),
    templateScripts: new Set(['dev', 'build', 'start', 'test', 'fmt', 'lint', 'typecheck']),
    cliSubcommands: new Set(['dev', 'build', 'start', 'version']),
    gateSteps: new Map([
      [
        '@openelement/tools-repo#gate:source',
        [
          '@openelement/tools-repo#typecheck',
          'check:dep-age',
          '@openelement/tools-repo#seams:check',
        ],
      ],
    ]),
    ciSteps: new Map([
      ['@openelement/tools-repo#typecheck', { layer: 'base', where: 'test fixture' }],
      ['check:dep-age', { layer: 'base', where: 'test fixture' }],
    ]),
    ciJobs: new Map([
      ['lint', 1],
      ['test', 1],
      ['e2e-full', 2],
    ]),
    workflowJobs: new Set(['lint', 'test', 'e2e-full', 'ci-evidence']),
    requiredCiJobs: ['lint', 'test', 'e2e-full'],
    publishedPackages: ['@openelement/protocol', '@openelement/element', '@openelement/create'],
    adrIds: new Set(['0161']),
    ...overrides,
  };
}

/** Findings of one rule only: the runner checks every rule, a test asserts one. */
function pick(findings: ReturnType<typeof run>, ...rules: string[]) {
  return findings.filter((finding) => rules.includes(finding.rule));
}

/** The same headers with both numbers wrong, for the seeded-drift test. */
const WRONG_RELEASING =
  'gate:source` — the local source gate (four\nsteps: three `@`-qualified tasks plus `check:dep-age`';
const WRONG_CONTRIBUTING =
  '`tools/repo#gate:source` (13\nsteps: twelve `@`-qualified tasks plus `check:dep-age`';

/** The releasing page text every gate-count test needs: header + local-only note. */
const RELEASING_LOCAL_ONLY = '\n`seams:check` is local-only';

function run(files: Record<string, string>, overrides: Partial<Authorities> = {}) {
  return checkDocClaims({
    root: '/repo',
    files: new Map(Object.entries(files)),
    authorities: authorities(overrides),
    canonical,
    measuredPages: [],
  });
}

const RELEASING_HEADER =
  'gate:source` — the local source gate (three\nsteps: two `@`-qualified tasks plus `check:dep-age`';
const CONTRIBUTING_HEADER =
  '`tools/repo#gate:source` (three\nsteps: two `@`-qualified tasks plus `check:dep-age`';

describe('version literals', () => {
  test('an unpublished version is a finding, a published one is not', () => {
    const findings = pick(
      run({ 'README.md': 'Source tree is `1.0.0-alpha.15`; not `1.0.0-alpha.99`.' }),
      'version',
    );
    expect(findings.map((finding) => finding.value)).toEqual(['1.0.0-alpha.99']);
  });

  test('dependency pins count as known versions', () => {
    expect(pick(run({ 'README.md': '`vite` is pinned at 8.0.16.' }), 'version')).toEqual([]);
  });

  test('an allowlisted historic version is exempt, with a reason on file', () => {
    const entry = ALLOWLIST.find((candidate) => candidate.value === '1.0.0');
    expect(entry?.reason.length ?? 0).toBeGreaterThan(20);
    expect(pick(run({ 'README.md': 'The final 1.0.0 release.' }), 'version')).toEqual([]);
  });

  test('a version inside an address literal is not a claim', () => {
    expect(pick(run({ 'README.md': 'Bind to 127.0.0.1 only.' }), 'version')).toEqual([]);
  });

  test('engine build numbers pass in an evidence record, whatever their digits', () => {
    const evidence = 'docs/release/evidence.md';
    // The real shape: the three engines a qualification run used.
    expect(
      pick(
        run({ [evidence]: 'every engine (chromium 147.0.7727.15, firefox 148.0.2, webkit 26.4)' }),
        'version',
      ),
    ).toEqual([]);
    // The class is a SHAPE, not a value: an unseen build still passes here, so
    // the exemption cannot rot into a list of blessed numbers.
    expect(pick(run({ [evidence]: 'firefox 999.999.999' }), 'version')).toEqual([]);
    // docs/release holds qualification evidence too.
    expect(pick(run({ 'docs/release/evidence.md': 'chromium 147.0.7727.15' }), 'version')).toEqual(
      [],
    );
  });

  test('the same engine number outside an evidence record stays red', () => {
    const findings = pick(
      run({ 'README.md': 'Tested on firefox 148.0.2, chromium and webkit.' }),
      'version',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('evidence-class');
  });

  test('a tree version stays red even inside the evidence record', () => {
    const findings = pick(
      run({ 'docs/release/evidence.md': 'the source line is 1.0.0-alpha.99' }),
      'version',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('not a tree version');
  });
});

describe('package subpaths', () => {
  test('a retired subpath is a finding', () => {
    const findings = pick(
      run({ 'packages/router/README.md': 'Import `@openelement/router/cli/deploy`.' }),
      'subpath',
    );
    expect(findings[0]!.value).toBe('@openelement/router/cli/deploy');
  });

  test('a live subpath passes, and an unknown package is its own finding', () => {
    expect(pick(run({ 'README.md': 'Use `@openelement/router/cli/build`.' }), 'subpath')).toEqual(
      [],
    );
    const findings = pick(run({ 'README.md': 'Use `@openelement/nope/thing`.' }), 'subpath');
    expect(findings[0]!.message).toContain('not a published package');
  });
});

describe('commands', () => {
  test('a renamed task is a finding', () => {
    const findings = pick(
      run({ 'CONTRIBUTING.md': 'Run `vp run chek` before pushing.' }),
      'task-command',
    );
    expect(findings).toHaveLength(1);
  });

  test('a live task and a directory-scoped task pass', () => {
    expect(
      pick(
        run({
          'CONTRIBUTING.md':
            'Run `vp run check`, `vp run --fail-if-no-match @openelement/tools-repo#typecheck`.',
        }),
        'task-command',
      ),
    ).toEqual([]);
    expect(
      pick(
        run({ 'CONTRIBUTING.md': 'Run `pnpm --dir tools/repo run typecheck`.' }),
        'task-command',
      ),
    ).toEqual([]);
  });

  test('a router bin subcommand that does not exist is a finding', () => {
    const findings = pick(
      run({ 'packages/router/README.md': 'Then `oe deploy` the app.' }),
      'cli-command',
    );
    expect(findings).toHaveLength(1);
    expect(
      pick(
        run({ 'packages/router/README.md': 'Then `oe build` and `oe start --mode=preview`.' }),
        'cli-command',
      ),
    ).toEqual([]);
  });

  test('generated-project scripts are in the task universe', () => {
    expect(
      pick(
        run({ 'www/content/docs/guide/tutorial.md': 'Run `npm run dev` and `npm run build`.' }),
        'task-command',
      ),
    ).toEqual([]);
  });
});

describe('gate counts and CI claims', () => {
  test('a wrong step count is a finding on both pages', () => {
    const findings = run({
      'docs/maintainers/releasing.md': `${WRONG_RELEASING}${RELEASING_LOCAL_ONLY}\nTwo of those steps also run in AutoFlow CI\n`,
      'CONTRIBUTING.md': WRONG_CONTRIBUTING,
    });
    // Two numbers per page (the total and the `@`-task split), two pages.
    expect(findings.filter((finding) => finding.rule === 'gate-count')).toHaveLength(4);
  });

  test('the authoritative counts pass', () => {
    const findings = run(
      {
        'docs/maintainers/releasing.md': `${RELEASING_HEADER}${RELEASING_LOCAL_ONLY}\nTwo of those steps also run in AutoFlow CI`,
        'CONTRIBUTING.md': `${CONTRIBUTING_HEADER}\nTwo of those steps also\nrun in CI through the fast jobs`,
      },
      {},
    );
    expect(findings.filter((finding) => finding.rule.startsWith('gate-count'))).toEqual([]);
  });

  test('a gate step with no CI path must be named as local-only', () => {
    const findings = run({
      'docs/maintainers/releasing.md': `${RELEASING_HEADER}\nEleven of those steps also run in AutoFlow CI\n`,
    });
    expect(
      findings.some((finding) => finding.message.includes('never names it as local-only')),
    ).toBe(true);
  });

  test('a job name no workflow declares is a finding', () => {
    const findings = pick(
      run({ 'CONTRIBUTING.md': 'the `packs` job owns the tarballs' }),
      'ci-job',
    );
    expect(findings.filter((finding) => finding.value === 'packs')).toHaveLength(1);
  });

  test('a qualification instance count must match the workflow', () => {
    const findings = pick(
      run({ 'docs/maintainers/releasing.md': '— two job instances in total' }),
      'ci-instances',
    );
    expect(
      findings.some((finding) => finding.message.includes('qualification job instances')),
    ).toBe(true);
  });
});

describe('references and parity', () => {
  test('an ADR that does not exist is a finding', () => {
    const findings = pick(run({ 'README.md': 'See ADR-0161 and ADR-9999.' }), 'adr');
    expect(findings.map((finding) => finding.value)).toEqual(['ADR-9999']);
  });

  test('a missing locale twin is a finding', () => {
    const findings = checkParity(new Map([['www/content/docs/guide/x.md', '# X']]), {
      authorities: authorities(),
      allowlist: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('x.zh.md');
  });

  test('a lede over the 160-character budget is a finding', () => {
    const long = 'a'.repeat(161);
    const findings = run({
      'www/content/docs/guide/x.md': `---\ntitle: 'X'\nlede: '${long}'\n---\n`,
    });
    expect(findings.some((finding) => finding.rule === 'lede')).toBe(true);
  });

  test('a package count that disagrees with the release line is a finding', () => {
    const findings = run({
      'README.md':
        'From this release the six packages (`protocol`, `element`) publish as one line.',
    });
    expect(findings.some((finding) => finding.message.includes('publishes 3'))).toBe(true);
  });
});

describe('allowlist and coverage', () => {
  test('an exemption without a reason fails the allowlist itself', () => {
    expect(
      validateAllowlist([{ rule: 'version', value: '9.9.9', reason: 'because' }]),
    ).toHaveLength(1);
    expect(
      validateAllowlist([
        {
          rule: 'version',
          value: '9.9.9',
          reason: 'a historic version recorded for migration context',
        },
      ]),
    ).toEqual([]);
  });

  test('a measured page outside the corpus is a coverage gap', () => {
    const findings = checkMeasuredCoverage(
      new Map([['a.md', '']]),
      { authorities: authorities(), allowlist: [] },
      ['a.md', 'b.md'],
    );
    expect(findings.map((finding) => finding.value)).toEqual(['b.md']);
  });
});

describe('extraction primitives', () => {
  test('code spans skip placeholders but keep fenced commands', () => {
    const spans = codeSpans('Use `vp run check`.\n\n```bash\nnpm run dev\n```\n');
    expect(spans.map((span) => span.value)).toEqual(['vp run check', 'npm run dev']);
  });

  test('count words and digits agree', () => {
    expect(countValue('sixteen')).toBe(16);
    expect(countValue('16')).toBe(16);
    expect(countValue('nonsense')).toBeNull();
  });
});
