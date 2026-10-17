/**
 * vp-dispatch.test.ts — the single-owner contract for the vp argv.
 *
 * `vpTaskArgv` is the only place in the repository that builds a vp command
 * line for tooling (gate steps, generator tasks, evidence-recorded commands all
 * route through it), and it emits `--fail-if-no-match` unconditionally. That
 * "unconditionally" is the policy: a gate list cannot omit the flag because no
 * caller supplies it. This file pins the argv so the policy cannot drift, and
 * pins it with the selector implementation the check uses — so the shape the
 * tooling spawns is provably the same shape the scanner accepts.
 */

import { expect, test } from 'vitest';
import { analyzeVpRun, type SelectorFacts } from './check-vp-selector-flags.ts';
import { vpExecutable, vpTaskArgv } from './vp-dispatch.ts';

const facts: SelectorFacts = {
  packages: new Map([['@openelement/www', new Set(['build'])]]),
};

test('vp dispatch: the canonical argv is the fail-closed filter form', () => {
  const argv = vpTaskArgv('@openelement/www', 'build');
  expect(argv).toEqual([
    'vp',
    'run',
    '--no-cache',
    '--fail-if-no-match',
    '--filter',
    '@openelement/www',
    'build',
  ]);
  // Never the `pkg#task` specifier form, which exits 0 on an unknown package.
  expect(argv.some((token) => token.includes('#'))).toBeFalsy();
});

test('vp dispatch: the policy is non-optional, not a caller argument', () => {
  // Drop the flag and the dispatch stops being fail-closed — the negative
  // direction of the "no caller can omit it" claim. This is what the scanner
  // would report if gate.ts or generate-all.ts ever hand-built the argv.
  const withoutFlag = vpTaskArgv('@openelement/www', 'build').filter(
    (token) => token !== '--fail-if-no-match',
  );
  const verdict = analyzeVpRun(withoutFlag.slice(2), facts);
  expect(verdict.qualified).toBeTruthy();
  expect(verdict.violations.map((violation) => violation.kind)).toEqual(['no-flag']);

  // And the canonical argv itself is accepted: producer and scanner agree.
  expect(analyzeVpRun(argvTail(), facts)).toEqual({ qualified: true, violations: [] });
});

function argvTail(): string[] {
  const argv = vpTaskArgv('@openelement/www', 'build');
  return argv.slice(argv.indexOf('run') + 1);
}

test('vp dispatch: a missing vp shim fails closed with a diagnosis', () => {
  expect(() => vpExecutable('/nonexistent-repo-root')).toThrowError(/pnpm install/);
});
