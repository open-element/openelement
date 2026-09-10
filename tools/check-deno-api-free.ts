/** Ensure browser-facing product packages do not use Deno APIs, node imports, or npm specifiers. */

import { walkSync } from '@std/fs/walk';
import { extractDenoAccesses, extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';

const RESTRICTED_ROOTS = ['packages/element/src', 'packages/app/src'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

// @preact/signals-core is element's chartered engine dependency (#322-era
// decision); every other npm: specifier is barred from runtime-free packages.
const ALLOWED_NPM_SPECIFIER = /^npm:@preact\/signals-core(?:@|\/|$)/;

export function scanDenoApiSource(path: string, source: string): string[] {
  const violations: string[] = [];
  for (const specifier of extractStaticModuleSpecifiers(source, path)) {
    if (specifier.value.startsWith('node:')) {
      violations.push(`${path}:${specifier.line}: node import: ${specifier.value}`);
    } else if (specifier.value.startsWith('npm:') && !ALLOWED_NPM_SPECIFIER.test(specifier.value)) {
      violations.push(`${path}:${specifier.line}: npm import: ${specifier.value}`);
    }
  }
  for (const access of extractDenoAccesses(source, path)) {
    violations.push(`${path}:${access.line}: Deno API: Deno.${access.member}`);
  }
  return violations;
}

function scan(root: string): string[] {
  const violations: string[] = [];
  // Test files are excluded by name below; the restricted roots carry no
  // __tests__ directories, so no skip list is needed (walk matches skip
  // entries against full paths — a bare /^__tests__$/ never fired here).
  for (const entry of walkSync(root, { includeDirs: false })) {
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    const dot = entry.name.lastIndexOf('.');
    if (dot === -1 || !EXTENSIONS.has(entry.name.slice(dot))) continue;
    const text = Deno.readTextFileSync(entry.path);
    const firstCodeLine = text.split('\n').find((line) => line.trim() !== '') ?? '';
    if (firstCodeLine.trim().startsWith('// deno-api-free:ignore')) continue;
    violations.push(...scanDenoApiSource(entry.path, text));
  }
  return violations;
}

function main(): void {
  const violations = RESTRICTED_ROOTS.flatMap(scan);
  if (violations.length > 0) {
    console.error('Deno API usage detected in runtime-free product packages:');
    for (const violation of violations) console.error(`  ${violation}`);
    Deno.exit(1);
  }
  console.log('No Deno API usage in runtime-free product packages.');
}

if (import.meta.main) main();
