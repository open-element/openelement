/**
 * Signal protocol boundary: `@preact/signals-core` is the current sole
 * signal implementation, kept in the packed npm `dependencies` (see
 * tools/release/npm-manifest.ts). This gate does not remove it — it hides it:
 * product source outside `internal/signal/` must not import it directly, and
 * the two core packages must not list it in their package.json `dependencies`,
 * so a future implementation can replace the engine without touching product
 * source.
 */
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

type Failure = { file: string; message: string };

const SOURCE_ROOTS = [
  'packages/protocol/src',
  'packages/element/src',
  'packages/compiler/src',
  'packages/router/src',
];
const PROTECTED_PACKAGE_CONFIGS = ['packages/element/package.json', 'packages/router/package.json'];
const FORBIDDEN_REQUIRED_DEPS = ['@preact/signals-core', '@preact/signals'];

export function findSignalBoundaryImports(source: string, path = 'source.ts'): string[] {
  return extractStaticModuleSpecifiers(source, path)
    .map(({ value }) => value)
    .filter((value) => FORBIDDEN_REQUIRED_DEPS.includes(value));
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) {
        continue;
      }
      const entryPath = `${entry.parentPath}/${entry.name}`;
      if (entryPath.includes('/internal/signal/')) continue;
      for (const dep of findSignalBoundaryImports(await readFile(entryPath, 'utf8'), entryPath)) {
        failures.push({
          file: entryPath,
          message: `${dep} must not be imported directly outside Element's internal signal engine`,
        });
      }
    }
  }
  for (const file of PROTECTED_PACKAGE_CONFIGS) {
    // The manifest's required-dependency surface since the B2 conversion is
    // package.json `dependencies` (devDependencies are not packed).
    const imports =
      (
        (await readJson(file)) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies ?? {};
    for (const dep of FORBIDDEN_REQUIRED_DEPS) {
      if (Object.hasOwn(imports, dep)) {
        failures.push({ file, message: `${dep} must not be a required package dependency` });
      }
    }
  }
  if (failures.length > 0) {
    console.error('Signal boundary check failed:');
    for (const failure of failures) console.error(`- ${failure.file}: ${failure.message}`);
    process.exit(1);
  }
  console.log('Signal boundary check passed.');
}

if (import.meta.main) await main();
