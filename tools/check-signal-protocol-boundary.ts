import { walkSync } from '@std/fs/walk';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

type Failure = { file: string; message: string };

const SOURCE_ROOTS = ['packages/element/src', 'packages/router/src'];
const PROTECTED_PACKAGE_CONFIGS = [
  'packages/element/deno.json',
  'packages/router/deno.json',
];
const FORBIDDEN_REQUIRED_DEPS = ['@preact/signals-core', '@preact/signals'];

export function findSignalBoundaryImports(source: string, path = 'source.ts'): string[] {
  return extractStaticModuleSpecifiers(source, path)
    .map(({ value }) => value)
    .filter((value) => FORBIDDEN_REQUIRED_DEPS.includes(value));
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const entry of walkSync(root, { includeDirs: false })) {
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (entry.path.includes('/internal/signal/')) continue;
      for (
        const dep of findSignalBoundaryImports(await Deno.readTextFile(entry.path), entry.path)
      ) {
        failures.push({
          file: entry.path,
          message: `${dep} must not be imported directly outside Element's internal signal engine`,
        });
      }
    }
  }
  for (const file of PROTECTED_PACKAGE_CONFIGS) {
    const imports = (await readJson(file) as {
      imports?: Record<string, string>;
    }).imports ?? {};
    for (const dep of FORBIDDEN_REQUIRED_DEPS) {
      if (Object.hasOwn(imports, dep)) {
        failures.push({ file, message: `${dep} must not be a required package dependency` });
      }
    }
  }
  if (failures.length > 0) {
    console.error('Signal boundary check failed:');
    for (const failure of failures) console.error(`- ${failure.file}: ${failure.message}`);
    Deno.exit(1);
  }
  console.log('Signal boundary check passed.');
}

if (import.meta.main) await main();
