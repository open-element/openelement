/** Materialize the compiler-owned exports named by a package's generated manifest. */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import type { OpenElementPackageManifest } from '../../packages/protocol/src/manifest.ts';
import { encodeCompiledArtifactClassCandidates } from '../../packages/compiler/src/internal/compiler/compiled-artifact-class-candidates.ts';
import type { PackageInfo } from './package-graph.ts';

export async function writePackedGeneratedElements(
  pkg: Pick<PackageInfo, 'dir' | 'exports' | 'name'>,
  packedRoot: string,
): Promise<void> {
  const manifestFile = join(pkg.dir, 'src/generated-manifest.json');
  if (!existsSync(manifestFile)) return;
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as OpenElementPackageManifest;
  const exports = pkg.exports as Record<string, unknown>;
  for (const { tagName, className, openElement } of manifest.declarations) {
    if (openElement?.ssrHostExport === undefined) continue;
    const prefix = `${pkg.name}/`;
    const specifier = openElement.module;
    const entry = specifier?.startsWith(prefix)
      ? exports[`./${specifier.slice(prefix.length)}`]
      : undefined;
    const label = `${pkg.name} generated element <${tagName}>`;
    if (typeof entry !== 'string' || !entry.startsWith('./src/') || !entry.endsWith('.tsx')) {
      throw new Error(`${label} must resolve to a TSX export while packing`);
    }
    const source = await readFile(join(pkg.dir, entry), 'utf8');
    const compiled = compileGeneratedElementIfAdmitted(source, entry.slice(2), {
      site: { tag: tagName },
    });
    if (!compiled || compiled.ssrHostExport !== openElement.ssrHostExport || !className) {
      throw new Error(`${label} does not match its manifest's constructor and SSR host exports`);
    }
    const { outputText } = ts.transpileModule(compiled.code, {
      fileName: entry,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        rewriteRelativeImportExtensions: true,
        removeComments: true,
      },
    });
    const entryJs = join(packedRoot, entry.replace(/\.tsx$/, '.js'));
    const compiledJs = entryJs.replace(/\.js$/, '.generated.js');
    await writeFile(compiledJs, outputText, { flag: 'wx' });
    const authored = await readFile(entryJs, 'utf8');
    const footer = encodeCompiledArtifactClassCandidates(compiled.classCandidates);
    // Keep vp pack's authored JavaScript and declaration output. The manifest's
    // named bindings are compiled by the same lane used by the consuming build.
    await writeFile(
      entryJs,
      `${authored}\nexport { ${className}, ${compiled.ssrHostExport} } from './${basename(compiledJs)}';\n${footer}`,
    );
  }
}
