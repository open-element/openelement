/**
 * Test helper: run the real element compiler over a page/island component
 * source (through the public `@openelement/element/compiler` entry) and
 * import the emitted module, so Deno tests exercise the actual compiled
 * class (Part Program + facade) instead of a hand-built double. Deno tests
 * must never import the authoring .tsx modules directly — the ambient
 * @element/@property decorators are compile-time-only input and throw at
 * module evaluation outside the adapter transform.
 */
import { rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileElementProgram } from '@openelement/element/compiler';

// Resolved through the workspace (daily dev) or the installed packed
// tarballs (release qualification) — never a relative path into a package.
const ELEMENT_URL = import.meta.resolve('@openelement/element');
const APP_URL = import.meta.resolve('@openelement/router');

/** Compile + import the default-exported compiled class of one component module. */
export async function compileComponentClass(sourceUrl: string): Promise<CustomElementConstructor> {
  const absoluteSource = new URL(sourceUrl, import.meta.url);
  const source = await readFile(absoluteSource, 'utf8');
  // Island modules colocate the island delivery policy statement with the
  // class; the compiler admits it only through the injected descriptor (#1468).
  const { code } = compileElementProgram(source, sourceUrl, {
    staticSidecars: [
      {
        moduleSpecifier: '@openelement/router',
        exportName: 'defineIslandConfig',
        kind: 'static-sidecar',
      },
    ],
  });
  // The emitted module imports the framework packages by bare specifier;
  // re-point them at the monorepo sources, and rebase the component's
  // relative imports onto its own directory. The rewritten module imports
  // through a data: URL so the test sandbox needs no write permission.
  const rewritten = code
    .replaceAll("from '@openelement/element'", `from '${ELEMENT_URL}'`)
    .replaceAll("from '@openelement/router'", `from '${APP_URL}'`)
    .replaceAll(
      /from '(\.[^']*)'/g,
      (_match, specifier: string) => `from '${new URL(specifier, absoluteSource).href}'`,
    );
  // The rewritten module imports from a temp .ts file: node strips the
  // emitted annotations by extension (the Deno host parsed the data: URL's
  // TypeScript media type, a host facility node does not offer for data:
  // imports). The workspace tmpdir is writable in daily dev, and release
  // qualification runs the packed tarballs instead of this helper.
  // the unique temp filename busts node's module cache across compiles
  const tempModule = join(
    tmpdir(),
    `saas-compiled-page-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
  );
  await writeFile(tempModule, rewritten, 'utf8');
  const mod = await import(pathToFileURL(tempModule).href);
  await rm(tempModule, { force: true });
  return mod.default as CustomElementConstructor;
}
