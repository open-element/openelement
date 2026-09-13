/** Emit a complete, non-committed classification of every tracked repository file. */

function category(path: string): string {
  if (path.startsWith('docs/')) return 'documentation';
  if (path.startsWith('.github/')) return 'ci-or-governance';
  if (path.includes('/__tests__/') || path.endsWith('.test.ts') || path.endsWith('.spec.ts')) {
    return 'test';
  }
  if (path.startsWith('fixtures/')) return 'fixture';
  if (path.startsWith('benchmarks/')) return 'benchmark';
  if (path.startsWith('tools/')) return 'tooling';
  if (path.startsWith('packages/')) return 'product-source';
  if (path === 'deno.json' || path === 'deno.lock' || path.endsWith('.json')) {
    return 'configuration';
  }
  return 'repository-support';
}

const result = await new Deno.Command('git', {
  args: ['ls-files'],
  stdout: 'piped',
  stderr: 'piped',
})
  .output();
if (!result.success) throw new Error('git ls-files failed');
const paths = new TextDecoder().decode(result.stdout).trim().split('\n').filter(Boolean).sort();
const report = ['path\tcategory', ...paths.map((path) => `${path}\t${category(path)}`)].join('\n') +
  '\n';
const output = Deno.env.get('CENSUS_OUTPUT');
if (output) {
  await Deno.mkdir(output.slice(0, Math.max(0, output.lastIndexOf('/'))) || '.', {
    recursive: true,
  });
  await Deno.writeTextFile(output, report);
}
console.log(report, `Census complete: ${paths.length}/${paths.length} tracked files classified.`);
