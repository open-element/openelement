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

test('release publish intent: the full negative matrix behaves as required', () => {
  const outcomes = runMatrix();
  // The matrix covers the twelve owner-policy rows plus three structural
  // checks (CI job-list agreement, kept tooling surfaces, trigger drift).
  expect(outcomes.length).toBeGreaterThanOrEqual(15);
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
