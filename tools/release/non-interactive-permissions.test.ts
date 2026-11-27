/**
 * Verify the gate launcher completes with stdin closed. The full packed
 * consumer proof runs in candidate evidence, not in this unit suite.
 */

import { expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { runProcess } from './consumer-packaged-shared.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

test(
  'permissions: the gate task entry completes with stdin closed (no prompt hang)',
  { timeout: 180_000 },
  async () => {
    // The real launcher chain against the fastest read-only gate step
    // (root fmt:check through vp): the gate itself runs with stdin closed —
    // the condition that used to surface a permission prompt as a hang.
    const run = await runProcess(process.execPath, ['tools/repo/gate.ts', 'fmt:check'], repoRoot, {
      timeoutMs: 150_000,
    });
    expect(
      run.success,
      `gate fmt:check must pass with stdin closed:\n${run.output.slice(-4000)}`,
    ).toBeTruthy();
    expect(run.output, 'the timed-out marker means the chain hung on input').not.toContain(
      'Timed out after',
    );
  },
);
