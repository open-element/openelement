import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PW_PROBE_PIN } from './consumer-packaged-starter.ts';

// One Playwright version, two declaration sites: the packed-consumer browser
// matrix resolves @playwright/test from the pin this gate writes into the
// scaffolded starter (PW_PROBE_PIN), while CI installs the browser builds for
// the ROOT devDependency (`playwright install` resolves the root manifest).
// A root upgrade that leaves the probe pin behind would surface only when the
// matrix tries to launch a browser build CI never downloaded — the far end of
// the release train instead of a gate. check-package-graph.ts also anchors the
// literal from the file text (probePlaywrightPinFailures); this test anchors
// the exported constant itself.

const repoRoot = join(import.meta.dirname!, '..', '..');

test('packed starter PW_PROBE_PIN rides the root @playwright/test pin', () => {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  const rootPin = rootManifest.devDependencies?.['@playwright/test'];
  expect(
    PW_PROBE_PIN,
    `PW_PROBE_PIN=${PW_PROBE_PIN} but root package.json ` +
      `devDependencies['@playwright/test']=${rootPin ?? '<missing>'}. ` +
      'Fix: bump both together：根 pin 与消费探针 pin 必须同版本 ' +
      '(CI installs the browser builds for the root pin; the packed probe ' +
      'resolves its own copy through this pin).',
  ).toBe(rootPin);
});
