/**
 * check-task-permissions.test.ts — least-privilege permission tripwire.
 *
 * FFI audit (1.0 Alpha convergence): only scripts whose module graph provably
 * loads a native binding (Vite/Rolldown, lightningcss, dev watchers) may
 * carry --allow-ffi. Unit suites proven FFI-free run --deny-ffi so an
 * accidental native import fails closed instead of prompting. No
 * first-party script or template may use broad run flags (see the repo-wide
 * check-no-allow-all scanner). Template dev/build/start/preview MUST keep
 * --allow-ffi (the Vite native binding); "tightening" them reintroduces the
 * macOS FFI prompt.
 *
 * B2 note: node-host scripts carry no permission flags at all (the Deno
 * permission model retired with the manifest conversion), so the audit
 * surface is first-party package.json scripts plus the create template.
 *
 * Token note: this file deliberately carries no literal broad-flag token —
 * the repo-wide check-no-allow-all scanner covers every tracked file
 * including this one, so the rule is described here in words only.
 */

import { expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

interface TaskFile {
  path: string;
  /** Tasks allowed --allow-ffi with the audited reason. */
  ffiAllowed: Record<string, string>;
}

const TASK_FILES: TaskFile[] = [
  {
    path: 'package.json',
    ffiAllowed: { test: 'root suite includes the router vite-plugin graph' },
  },
  { path: 'packages/element/package.json', ffiAllowed: {} },
  { path: 'packages/ui/package.json', ffiAllowed: {} },
  { path: 'packages/create/package.json', ffiAllowed: {} },
  {
    path: 'packages/router/package.json',
    ffiAllowed: { test: 'vite plugin units import the vite module graph' },
  },
  { path: 'tools/repo/package.json', ffiAllowed: {} },
  { path: 'tools/release/package.json', ffiAllowed: {} },
  {
    path: 'www/package.json',
    ffiAllowed: { test: 'site build-graph assertions (residual: not yet proven FFI-free)' },
  },
  { path: 'apps/saas/package.json', ffiAllowed: {} },
  { path: 'tests/e2e/starter-smoke/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-lit-framework/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-native-framework/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-nitro/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-request-time/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-static-only/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/router-ui-dogfood/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/site-light-probe/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/web-component-interop/package.json', ffiAllowed: {} },
  { path: 'tests/fixtures/third-party-web-components/package.json', ffiAllowed: {} },
];

/** Template lifecycle scripts audited for the flag-free Node contract. */
const TEMPLATE_FFI_REQUIRED = ['dev', 'build', 'start', 'preview'];

/** The starter template's lifecycle scripts (package.json.tmpl, B5/ADR-0161). */
function templateScripts(): Record<string, string> {
  const parsed = JSON.parse(
    readFileSync(join(repoRoot, 'packages/create/templates/package.json.tmpl'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  expect(
    parsed.scripts && typeof parsed.scripts === 'object',
    'template has no scripts map',
  ).toBeTruthy();
  return parsed.scripts as Record<string, string>;
}

function taskMap(path: string): Record<string, string> {
  const text = readFileSync(join(repoRoot, path), 'utf8');
  const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
  expect(
    parsed.scripts && typeof parsed.scripts === 'object',
    `${path} has no scripts map`,
  ).toBeTruthy();
  return parsed.scripts as Record<string, string>;
}

test('task permissions: no broad flags in first-party tasks or templates', () => {
  // Broad-flag tokens assembled without literals: the repo-wide
  // check-no-allow-all scanner covers this file too.
  const dashA = String.fromCharCode(45, 65);
  const allowAll = String.fromCharCode(45, 45, 97, 108, 108, 111, 119, 45, 97, 108, 108);
  const shortPattern = new RegExp(`(^|\\s)${dashA}(\\s|$)`);
  const violations: string[] = [];
  const check = (label: string, command: string): void => {
    if (shortPattern.test(command) || command.includes(allowAll)) {
      violations.push(`${label}: ${command.slice(0, 160)}`);
    }
  };
  for (const file of TASK_FILES) {
    for (const [name, command] of Object.entries(taskMap(file.path))) {
      check(`${file.path}#${name}`, command);
    }
  }
  const template = templateScripts();
  for (const [name, command] of Object.entries(template)) {
    check(`templates/package.json.tmpl#${name}`, command);
  }
  expect(
    violations.length === 0,
    `broad permissions in tasks:\n${violations.join('\n')}`,
  ).toBeTruthy();
});

test('task permissions: --allow-ffi only on audited tasks', () => {
  const violations: string[] = [];
  for (const file of TASK_FILES) {
    for (const [name, command] of Object.entries(taskMap(file.path))) {
      if (!command.includes('--allow-ffi')) continue;
      if (!(name in file.ffiAllowed)) {
        violations.push(
          `${file.path}#${name}: unlisted --allow-ffi (prove need or use --deny-ffi)`,
        );
      }
    }
    for (const [name, command] of Object.entries(taskMap(file.path))) {
      if (command.includes('--deny-ffi') && name in file.ffiAllowed) {
        violations.push(`${file.path}#${name}: contradictory --deny-ffi on allowlisted task`);
      }
    }
  }
  expect(
    violations.length === 0,
    `ffi allowlist violations:\n${violations.join('\n')}`,
  ).toBeTruthy();
});

test('task permissions: unit suites run on vitest — the deno permission surface retired', () => {
  // DISCLOSED SEMANTIC CHANGE (B3): the former assertions audited
  // `deno test --deny-ffi --no-prompt` flags on the unit-suite tasks. The
  // B3 cutover moves those tasks to vitest on the node host, where no deno
  // permission model exists — the flags have nothing to attach to. The
  // invariant that REMAINS: the migrated tasks must not spawn the deno
  // test runner (which would silently drop the flag audit).
  for (const [path, name] of [
    ['packages/element/package.json', 'test'],
    ['packages/ui/package.json', 'test'],
    ['packages/create/package.json', 'test'],
    ['packages/router/package.json', 'test'],
    ['package.json', 'test'],
  ] as const) {
    const command = taskMap(path)[name];
    expect(command.includes('vitest'), `${path}#${name} must run under vitest`).toBeTruthy();
    expect(
      command.includes('deno test'),
      `${path}#${name} must not spawn the deno test runner`,
    ).toBeFalsy();
  }
});

test('task permissions: create template lifecycle is flag-free on the Node host', () => {
  // DISCLOSED SEMANTIC CHANGE (B5): the former assertion pinned --allow-ffi
  // on the template's dev/build/start/preview Deno tasks (vite native
  // binding). The B5 cutover makes the generated starter a Node/pnpm project
  // (ADR-0161) — there is no permission model to scope, so the invariant that
  // REMAINS: the lifecycle scripts exist and carry no host permission flags
  // at all.
  const template = templateScripts();
  for (const name of TEMPLATE_FFI_REQUIRED) {
    const command = template[name];
    expect(command, `template script missing: ${name}`).toBeTruthy();
    expect(
      /--allow|--deny|--no-prompt/.test(command),
      `template#${name} must not carry host permission flags: ${command}`,
    ).toBeFalsy();
  }
});

test('task permissions: content-dates validation is read-only', () => {
  const scripts = taskMap('www/package.json');
  const command = scripts['check:content-dates'];
  expect(command, 'www/package.json#check:content-dates must exist').toBeTruthy();
  expect(
    command.includes('run-in.ts') && command.includes('check-content-dates.ts'),
    'check:content-dates must delegate through run-in.ts to the read-only checker',
  ).toBeTruthy();
  expect(
    scripts['write:content-dates'],
    'the manifest is hand-maintained: there is no regeneration script to write it',
  ).toEqual(undefined);
});
