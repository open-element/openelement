/**
 * check-release-publish-intent.test.ts — the explicit-release-intent matrix
 * as a vitest (Q-Release, WP3), so it runs in the normal test/check gates
 * (the `tools` vitest project: root `test`, the CI test job's
 * `vitest run --project tools`, and the release train's coverage run).
 *
 * The harness itself lives in check-release-publish-intent.ts: it evaluates
 * the release workflow's trigger surface + guard conditions and executes its
 * extracted shell steps against a fake gh/npm, with no real publish, tag or
 * GitHub Release. This file asserts the full negative matrix behaves as
 * required, and — for the RED half of the proof — that mutated copies of the
 * workflow (a re-introduced `workflow_run` trigger, a publish-implying
 * operation default, a skipped-gate bypass) are detected, i.e. the harness
 * genuinely fails when the invariant is broken.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  DEFAULT_CI_WORKFLOW,
  DEFAULT_RELEASE_WORKFLOW,
  runMatrix,
  type ScenarioOutcome,
} from './check-release-publish-intent.ts';

function failures(outcomes: ScenarioOutcome[]): string[] {
  return outcomes
    .filter((outcome) => !outcome.ok)
    .map(
      (outcome) =>
        `${outcome.id}: expected ${outcome.expectation}, observed ${outcome.observed} — ${outcome.detail}`,
    );
}

function withMutatedWorkflow(mutate: (text: string) => string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'oe-intent-mutation-'));
  const path = join(dir, 'autoflow-release.yml');
  const original = readFileSync(DEFAULT_RELEASE_WORKFLOW, 'utf8');
  const mutated = mutate(original);
  expect(mutated, 'the mutation must actually change the workflow text').not.toEqual(original);
  writeFileSync(path, mutated);
  return { dir, path };
}

function withMutatedCiWorkflow(mutate: (text: string) => string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'oe-intent-ci-mutation-'));
  const path = join(dir, 'autoflow-ci.yml');
  const original = readFileSync(DEFAULT_CI_WORKFLOW, 'utf8');
  const mutated = mutate(original);
  expect(mutated, 'the mutation must actually change the workflow text').not.toEqual(original);
  writeFileSync(path, mutated);
  return { dir, path };
}

test('release publish intent: the full negative matrix behaves as required', () => {
  const outcomes = runMatrix();
  // The matrix covers the owner-policy rows, the exact qualification-identity
  // negative rows (missing/duplicated/unexpected instance, partial listing,
  // non-success sha-guard), the always() read-back forensics and the shared
  // contract/CI-workflow agreement.
  expect(outcomes.length).toBeGreaterThanOrEqual(16);
  expect(failures(outcomes)).toEqual([]);
});

test('harness goes red when a workflow_run trigger is re-introduced', () => {
  const { dir, path } = withMutatedWorkflow((text) =>
    text.replace(
      /^on:$/mu,
      'on:\n  workflow_run:\n    workflows: [AutoFlow CI]\n    types: [completed]',
    ),
  );
  try {
    const failed = failures(runMatrix({ releasePath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('push-merge-ci-success-never-publish');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness goes red when the operation input defaults to publish', () => {
  const { dir, path } = withMutatedWorkflow((text) =>
    text.replace(
      '        required: true\n        type: choice\n',
      '        required: true\n        type: choice\n        default: publish\n',
    ),
  );
  try {
    const failed = failures(runMatrix({ releasePath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('operation-missing-or-unknown-is-refused');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness goes red when a skipped-gate bypass is re-introduced', () => {
  const { dir, path } = withMutatedWorkflow((text) =>
    text.replace(
      "needs.release-gate.result == 'success'",
      "(needs.release-gate.result == 'success' || needs.release-gate.result == 'skipped')",
    ),
  );
  try {
    const failed = failures(runMatrix({ releasePath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('manual-publish-with-failed-release-gate-is-refused');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness goes red when ci-evidence stops pinning filter=latest', () => {
  const { dir, path } = withMutatedWorkflow((text) =>
    text.replace('jobs?per_page=100&filter=latest', 'jobs?per_page=100'),
  );
  try {
    const failed = failures(runMatrix({ releasePath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('qualification-contract-single-definition-matches-ci');
    // The failure names the re-run defect, not just a generic contract drift.
    expect(failed.join('\n')).toContain('filter=latest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness goes red when the CI workflow grows a matrix leg', () => {
  const { dir, path } = withMutatedCiWorkflow((text) =>
    text.replace('leg: [site-e2e, fixture-gates]', 'leg: [site-e2e, fixture-gates, extra-leg]'),
  );
  try {
    const failed = failures(runMatrix({ ciPath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('qualification-contract-single-definition-matches-ci');
    expect(failed.join('\n')).toContain('extra-leg');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness goes red when the CI workflow gains a job the contract does not own', () => {
  const { dir, path } = withMutatedCiWorkflow((text) =>
    text.replace(
      /^jobs:\n/mu,
      'jobs:\n  rogue:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n',
    ),
  );
  try {
    const failed = failures(runMatrix({ ciPath: path }));
    expect(failed.length, failed.join('\n')).toBeGreaterThan(0);
    expect(failed.join('\n')).toContain('qualification-contract-single-definition-matches-ci');
    expect(failed.join('\n')).toContain('rogue');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
