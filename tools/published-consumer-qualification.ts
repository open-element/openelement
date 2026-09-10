#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Exercise the currently published support distribution from a clean temporary
 * directory. The JSON report is deliberately portable: CI uploads it even if
 * a platform-specific command fails, so adopters get the environment and the
 * exact failed command rather than a truncated Actions log alone.
 */

import { dirname, join } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from './project-constants.ts';
import { runWithOutput } from './lib/process.ts';

export type QualificationMode = 'starter' | 'runtime' | 'all';

export interface QualificationOptions {
  mode: QualificationMode;
  reportPath: string;
  version: string;
}

interface StepReport {
  command: string[];
  cwd: string;
  durationMs: number;
  exitCode: number;
  name: string;
  stderr: string;
  stdout: string;
}

interface QualificationReport {
  environment: Record<string, string>;
  mode: QualificationMode;
  platform: { arch: string; deno: string; os: string };
  startedAt: string;
  steps: StepReport[];
  version: string;
}

export function parseQualificationOptions(
  args: readonly string[],
  environment: Record<string, string | undefined> = Deno.env.toObject(),
): QualificationOptions {
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const mode = read('--mode') ?? 'all';
  if (mode !== 'starter' && mode !== 'runtime' && mode !== 'all') {
    throw new Error(`--mode must be starter, runtime, or all; received ${mode}`);
  }
  return {
    mode,
    reportPath: read('--report') ?? 'published-consumer-report.json',
    version: read('--version') || environment.OPEN_ELEMENT_PUBLISHED_VERSION || PACKAGE_VERSION,
  };
}

function tail(output: string): string {
  return output.length > 12_000 ? output.slice(-12_000) : output;
}

async function writeReport(path: string, report: QualificationReport): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, formatJson(report));
}

async function main(): Promise<void> {
  const options = parseQualificationOptions(Deno.args);
  const report: QualificationReport = {
    environment: Object.fromEntries(
      ['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'RUNNER_ARCH', 'RUNNER_OS'].flatMap((key) =>
        Deno.env.get(key) === undefined ? [] : [[key, Deno.env.get(key)!]]
      ),
    ),
    mode: options.mode,
    platform: { arch: Deno.build.arch, deno: Deno.version.deno, os: Deno.build.os },
    startedAt: new Date().toISOString(),
    steps: [],
    version: options.version,
  };
  const root = await Deno.makeTempDir({ prefix: 'openelement-published-consumer-' });

  const runStep = async (name: string, command: string, args: string[], cwd: string) => {
    const started = performance.now();
    const result = await runWithOutput(command, args, { cwd });
    const step: StepReport = {
      command: [command, ...args],
      cwd,
      durationMs: Math.round(performance.now() - started),
      exitCode: result.code,
      name,
      stderr: tail(result.stderr),
      stdout: tail(result.stdout),
    };
    report.steps.push(step);
    console.log(`[published-consumer] ${name}: exit ${result.code} (${step.durationMs}ms)`);
    if (!result.success) {
      throw new Error(`${name} failed (exit ${result.code})\n${step.stderr || step.stdout}`);
    }
  };

  try {
    if (options.mode === 'starter' || options.mode === 'all') {
      await runStep(
        'generate exact-version starter',
        Deno.execPath(),
        [
          'run',
          '-A',
          '--minimum-dependency-age',
          '0',
          `npm:@openelement/create@${options.version}`,
          'starter',
        ],
        root,
      );
      const starter = join(root, 'starter');
      for (const task of ['check', 'test', 'build']) {
        await runStep(`starter deno task ${task}`, Deno.execPath(), ['task', task], starter);
      }
    }

    if (options.mode === 'runtime' || options.mode === 'all') {
      const denoConsumer = join(root, 'deno-consumer');
      await Deno.mkdir(denoConsumer);
      await Deno.writeTextFile(
        join(denoConsumer, 'deno.json'),
        JSON.stringify(
          {
            imports: Object.fromEntries(
              ['element', 'app', 'adapter-vite'].map((
                pkg,
              ) => [`@openelement/${pkg}`, `npm:@openelement/${pkg}@${options.version}`]),
            ),
            minimumDependencyAge: 0,
          },
          null,
          2,
        ),
      );
      const publicSurfaceSource = [
        "import { HYDRATION_STRATEGIES, OpenElement, renderDsd, signal } from '@openelement/element';",
        "import { defineApp, defineIslandConfig, definePage } from '@openelement/app';",
        "import { openPipeline } from '@openelement/adapter-vite';",
        'for (const value of [OpenElement, renderDsd, signal, defineApp, defineIslandConfig, definePage, openPipeline]) {',
        "  if (typeof value !== 'function') throw new Error('expected published public function');",
        '}',
        "if (!Array.isArray(HYDRATION_STRATEGIES)) throw new Error('expected hydration strategy list');",
        "console.log('published public runtime imports passed');",
      ].join('\n');
      const denoRuntimeSource = [
        "import { OpenElement, signal } from '@openelement/element';",
        "import { defineApp, defineIslandConfig, definePage } from '@openelement/app';",
        'for (const value of [OpenElement, signal, defineApp, defineIslandConfig, definePage]) {',
        "  if (typeof value !== 'function') throw new Error('expected published public function');",
        '}',
        "console.log('published Deno runtime imports passed');",
      ].join('\n');
      await Deno.writeTextFile(join(denoConsumer, 'smoke.ts'), publicSurfaceSource);
      await Deno.writeTextFile(join(denoConsumer, 'runtime.ts'), denoRuntimeSource);
      await runStep(
        'Deno public runtime check',
        Deno.execPath(),
        ['check', 'smoke.ts'],
        denoConsumer,
      );
      await runStep(
        'Deno public runtime execution',
        Deno.execPath(),
        ['run', '--allow-env', 'runtime.ts'],
        denoConsumer,
      );

      const nodeConsumer = join(root, 'node-consumer');
      await Deno.mkdir(nodeConsumer);
      await Deno.writeTextFile(
        join(nodeConsumer, 'package.json'),
        JSON.stringify(
          {
            dependencies: Object.fromEntries(
              ['element', 'app', 'adapter-vite'].map((
                pkg,
              ) => [`@openelement/${pkg}`, options.version]),
            ),
            private: true,
            type: 'module',
          },
          null,
          2,
        ),
      );
      await Deno.writeTextFile(join(nodeConsumer, 'smoke.mjs'), publicSurfaceSource);
      await runStep(
        'install Node ESM public runtime dependencies',
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        nodeConsumer,
      );
      await runStep('Node ESM public runtime execution', 'node', ['smoke.mjs'], nodeConsumer);
    }
  } finally {
    await writeReport(options.reportPath, report);
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }

  console.log(`[published-consumer] ${options.mode} qualification passed for ${options.version}`);
}

if (import.meta.main) await main();
