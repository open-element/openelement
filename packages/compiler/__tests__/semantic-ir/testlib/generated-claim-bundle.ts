import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { REPO_ROOT } from './element-classifier.ts';

export const LEAF_RUNTIME_ENTRY = join(
  REPO_ROOT,
  'packages/element/src/internal/compiled/leaf-runtime.ts',
);

/** Bundle generated leaf artifacts with the entry they import in production. */
export async function loadGeneratedClaimBundle<Loaded>(
  dir: string,
  modules: Record<string, string>,
  exports: readonly string[],
): Promise<Loaded> {
  for (const [name, source] of Object.entries(modules)) {
    writeFileSync(join(dir, name), source);
  }
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, exports.join('\n'));
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: LEAF_RUNTIME_ENTRY } },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'mod.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('generated claim bundle produced no chunk');

  const out = join(dir, 'mod.js');
  writeFileSync(out, chunk.code);
  return (await import(pathToFileURL(out).href)) as Loaded;
}
