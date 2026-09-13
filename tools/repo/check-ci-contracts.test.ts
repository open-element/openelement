/**
 * check-ci-contracts.test.ts — CI required/optional contract tripwire.
 *
 * Bun is a non-blocking compatibility signal, never a gate: if a workflow
 * edit drops `continue-on-error` from bun-serve-smoke (or promotes it into
 * the required set), this test fails before the policy silently changes.
 * Conversely the required jobs (autoflow-ci, node-serve-smoke,
 * packed-consumer-matrix) must stay blocking, and the packed-consumer
 * matrix must install all three packed-gate browsers.
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const workflow = await Deno.readTextFile(join(repoRoot, '.github/workflows/autoflow-ci.yml'));
const releasing = await Deno.readTextFile(join(repoRoot, 'docs/maintainers/releasing.md'));

/** Extract one top-level job block (two-space `name:` jobs) by job key. */
function jobBlock(text: string, job: string): string {
  const start = text.indexOf(`\n  ${job}:`);
  assert(start >= 0, `workflow job missing: ${job}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

Deno.test('ci contract: bun-serve-smoke is explicitly non-blocking', () => {
  const block = jobBlock(workflow, 'bun-serve-smoke');
  assert(
    /continue-on-error:\s*true/.test(block),
    'bun-serve-smoke must carry job-level continue-on-error: true (Bun is optional, never a gate)',
  );
});

Deno.test('ci contract: required jobs stay blocking', () => {
  for (const job of ['autoflow-ci', 'node-serve-smoke', 'packed-consumer-matrix']) {
    const block = jobBlock(workflow, job);
    assert(
      !/continue-on-error:\s*true/.test(block),
      `required job ${job} must not carry continue-on-error: true`,
    );
  }
});

Deno.test('ci contract: packed-consumer matrix installs all three packed-gate browsers', () => {
  const block = jobBlock(workflow, 'packed-consumer-matrix');
  assert(
    /playwright install[^\n]*chromium[^\n]*firefox[^\n]*webkit/.test(block),
    'packed-consumer-matrix must install chromium+firefox+webkit for the packed gates',
  );
});

Deno.test('ci contract: release docs never present Bun as required', () => {
  const flat = releasing.replace(/\s+/g, ' ');
  assert(
    /bun-serve-smoke[^.]{0,200}optional\/non-blocking/i.test(flat) ||
      /optional\/non-blocking[^.]{0,200}bun-serve-smoke/i.test(flat),
    'releasing.md must mark bun-serve-smoke optional/non-blocking',
  );
  const requiredLine = releasing.split('\n').find((line) => line.includes('branch protection'));
  assertEquals(
    requiredLine?.includes('bun-serve-smoke'),
    false,
    'bun-serve-smoke must not appear in the required branch-protection list',
  );
});
