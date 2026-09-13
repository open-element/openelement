/**
 * check-task-permissions.test.ts — least-privilege task permission tripwire.
 *
 * FFI audit (1.0 Alpha convergence): only tasks whose module graph provably
 * loads a native binding (Vite/Rolldown, lightningcss, dev watchers) may
 * carry --allow-ffi. Unit suites proven FFI-free run --deny-ffi so an
 * accidental native import fails closed instead of prompting. No
 * first-party task or template may use -A/--allow-all: the only -A
 * invocations are documented Playwright/consumer child harnesses inside
 * tools/release (each runs an isolated packed consumer, never the repo
 * itself). Template dev/build/start/preview MUST keep --allow-ffi (the Vite
 * native binding); "tightening" them reintroduces the macOS FFI prompt.
 */

import { assert } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

interface TaskFile {
  path: string;
  /** Tasks allowed --allow-ffi with the audited reason. */
  ffiAllowed: Record<string, string>;
}

const TASK_FILES: TaskFile[] = [
  {
    path: 'deno.json',
    ffiAllowed: { test: 'root suite includes the router vite-plugin graph' },
  },
  { path: 'packages/element/deno.json', ffiAllowed: {} },
  { path: 'packages/ui/deno.json', ffiAllowed: {} },
  { path: 'packages/create/deno.json', ffiAllowed: {} },
  {
    path: 'packages/router/deno.json',
    ffiAllowed: { test: 'vite plugin units import the vite module graph' },
  },
  {
    path: 'tools/repo/deno.json',
    ffiAllowed: {
      'test:coverage:check':
        'gate harness spawning the coverage subprocess graph (residual: not yet proven FFI-free)',
    },
  },
  {
    path: 'tools/release/deno.json',
    ffiAllowed: {},
  },
  {
    path: 'apps/site/deno.json',
    ffiAllowed: {
      build: 'vite SSG build (native binding)',
      test: 'site build-graph assertions (residual: not yet proven FFI-free)',
    },
  },
  {
    path: 'apps/saas/deno.json',
    ffiAllowed: {
      build: 'vite SSG build (native binding)',
      start: 'request-time server over the vite graph (native binding)',
    },
  },
  {
    path: 'tests/e2e/starter-smoke/deno.json',
    ffiAllowed: {},
  },
  ...[
    'router-lit-framework',
    'router-native-framework',
    'router-nitro',
    'router-request-time',
    'router-static-only',
    'router-ui-dogfood',
  ].map((fixture) => ({
    path: `tests/fixtures/${fixture}/deno.json`,
    ffiAllowed: { build: 'vite SSG build (native binding)' },
  })),
];

/** Template tasks that must keep --allow-ffi (Vite native binding). */
const TEMPLATE_FFI_REQUIRED = ['dev', 'build', 'start', 'preview'];

function taskMap(path: string): Record<string, string> {
  const text = Deno.readTextFileSync(join(repoRoot, path));
  const parsed = JSON.parse(text) as { tasks?: Record<string, string> };
  assert(parsed.tasks && typeof parsed.tasks === 'object', `${path} has no tasks map`);
  return parsed.tasks as Record<string, string>;
}

Deno.test('task permissions: no -A/--allow-all in first-party tasks or templates', () => {
  const violations: string[] = [];
  const check = (label: string, command: string): void => {
    if (/(^|\s)-A(\s|$)/.test(command) || command.includes('--allow-all')) {
      violations.push(`${label}: ${command.slice(0, 160)}`);
    }
  };
  for (const file of TASK_FILES) {
    for (const [name, command] of Object.entries(taskMap(file.path))) {
      check(`${file.path}#${name}`, command);
    }
  }
  const template = taskMap('packages/create/templates/deno.json.tmpl');
  for (const [name, command] of Object.entries(template)) {
    check(`templates/deno.json.tmpl#${name}`, command);
  }
  assert(violations.length === 0, `broad permissions in tasks:\n${violations.join('\n')}`);
});

Deno.test('task permissions: --allow-ffi only on audited tasks', () => {
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
  assert(violations.length === 0, `ffi allowlist violations:\n${violations.join('\n')}`);
});

Deno.test('task permissions: FFI-free unit suites deny FFI and never prompt', () => {
  for (
    const [path, name] of [
      ['packages/element/deno.json', 'test'],
      ['packages/ui/deno.json', 'test'],
      ['packages/create/deno.json', 'test'],
    ] as const
  ) {
    const command = taskMap(path)[name];
    assert(command.includes('--deny-ffi'), `${path}#${name} must carry --deny-ffi`);
    assert(command.includes('--no-prompt'), `${path}#${name} must carry --no-prompt`);
  }
  for (
    const [path, name] of [
      ['deno.json', 'test'],
      ['packages/router/deno.json', 'test'],
    ] as const
  ) {
    const command = taskMap(path)[name];
    assert(command.includes('--no-prompt'), `${path}#${name} must carry --no-prompt`);
  }
});

Deno.test('task permissions: create template keeps scoped vite permissions', () => {
  const template = taskMap('packages/create/templates/deno.json.tmpl');
  for (const name of TEMPLATE_FFI_REQUIRED) {
    const command = template[name];
    assert(command, `template task missing: ${name}`);
    assert(
      command.includes('--allow-ffi'),
      `template#${name} must keep --allow-ffi (vite native binding; removal reintroduces the FFI prompt)`,
    );
  }
});
