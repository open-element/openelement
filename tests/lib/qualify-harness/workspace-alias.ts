/**
 * Alias a scaffolded app to the monorepo workspace sources (#1472).
 *
 * applyWorkspaceAliases is the qualify-fixture variant: it merges caller npm
 * imports into the app's import map, points every @openelement/* entry at
 * the package's source exports (file: URLs from tools/lib/package-aliases.ts,
 * the same mapping packages/create documents), rewires the app's `build` task
 * to the in-repo Router build CLI, and injects the matching resolve.alias
 * block into vite.config.ts. workspaceSourceAliases exposes the same mapping
 * as absolute source paths for consumers that need a different target shape
 * (the starter smoke rewires to repo-relative paths so the packed starter's
 * transitive package manifests keep resolving).
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fromFileUrl, join } from '@std/path';
import { allPackageAliases } from '../../../tools/lib/package-aliases.ts';
import { runStep } from './command-run.ts';
import { jsonText, readJson } from './json-file.ts';
import { routerBuildTask } from './build-router.ts';

export interface WorkspaceSourceAlias {
  specifier: string;
  /** Absolute path of the export target inside the repository. */
  sourcePath: string;
}

/** The workspace package export mapping as absolute source paths. */
export function workspaceSourceAliases(repoRoot: string): WorkspaceSourceAlias[] {
  return [...allPackageAliases(repoRoot)].map(([specifier, url]) => ({
    specifier,
    sourcePath: fromFileUrl(url),
  }));
}

/**
 * Bare specifiers imported by the workspace build source (the Router CLI and
 * vite plugin, the element signal engine) with their canonical pins — lifted
 * from the retired pre-B2 root deno.json import map and the router package's
 * dependency surface. Fixture-specific extraImports override these.
 */
const WORKSPACE_BUILD_EXTERNALS: Record<string, string> = {
  vite: 'npm:vite@8.0.16',
  typescript: 'npm:typescript@6.0.3',
  hono: 'npm:hono@^4.12',
  '@hono/vite-dev-server': 'npm:@hono/vite-dev-server@^0.25.3',
  '@lit-labs/ssr': 'npm:@lit-labs/ssr@4.1.0',
  '@lit-labs/ssr-client': 'npm:@lit-labs/ssr-client@1.1.8',
  '@preact/signals-core': 'npm:@preact/signals-core@^1.12.1',
  lit: 'npm:lit@3.3.3',
  marked: 'npm:marked@^15.0.0',
  pathe: 'npm:pathe@^2.0.3',
  'jsonc-parser': 'npm:jsonc-parser@^3.3.1',
  mime: 'npm:mime@^4.1.0',
  '@openelement/url-pattern-list': 'npm:@openelement/url-pattern-list@0.6.0',
};

export interface ApplyWorkspaceAliasesOptions {
  repoRoot: string;
  /** Extra import-map entries merged ahead of the workspace aliases. */
  extraImports?: Record<string, string>;
  /**
   * Specifiers resolved from the app's own node_modules (installed by Deno)
   * and therefore aliased as app-local paths in vite.config.ts.
   */
  externalViteAliases?: readonly string[];
  /** Final text transform applied to vite.config.ts after the alias injection. */
  transformViteConfig?: (text: string) => string;
}

/**
 * Patch the scaffolded app's deno.json import map, build task, and vite
 * config so the temporary app builds against workspace SOURCE artifacts.
 */
export async function applyWorkspaceAliases(
  appDir: string,
  options: ApplyWorkspaceAliasesOptions,
): Promise<void> {
  const denoJsonPath = join(appDir, 'deno.json');
  // B5 (ADR-0161): the generated starter no longer ships a deno.json — the
  // scaffold is a Node/pnpm project. The Deno-host fixture harness provides
  // its own Deno universe instead: a minimal config that carries exactly the
  // workspace alias map (below) plus the rewritten build task.
  let denoJson: {
    imports?: Record<string, string>;
    tasks?: Record<string, string>;
    nodeModulesDir?: string;
    minimumDependencyAge?: string | number;
  } = {};
  try {
    denoJson = await readJson<typeof denoJson>(denoJsonPath);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
  // B2 residual: with a deno.json present, Deno defaults to manual
  // node_modules (BYONM) and refuses bare npm specifiers ("Did you forget to
  // run `deno install`?"). The pre-B2 root deno.json import map carried
  // specifiers like 'vite'; the app-local universe must opt into Deno-managed
  // node_modules instead, so priming/build resolution materializes the
  // scaffolded app's package.json dependencies. minimumDependencyAge 0 keeps
  // the workspace-pinned @openelement/* versions installable: this fixture
  // builds against WORKSPACE SOURCE through the import map/alias injected
  // below, so registry freshness is not a supply-chain signal here.
  denoJson.nodeModulesDir ??= 'auto';
  denoJson.minimumDependencyAge ??= 0;
  const imports = (denoJson.imports ??= {});
  // B2 residual: the workspace build source (Router CLI/vite plugin, element
  // signal engine) that the alias build executes imports these bare
  // specifiers, and the pre-B2 root deno.json import map carried them into
  // every temp app. The harness restores that universe here; fixture-specific
  // pins (extraImports) and the @openelement/* workspace aliases below
  // override these.
  Object.assign(imports, WORKSPACE_BUILD_EXTERNALS);
  Object.assign(imports, options.extraImports);
  for (const [specifier, url] of allPackageAliases(options.repoRoot)) {
    imports[specifier] = url;
  }
  const tasks = (denoJson.tasks ??= {});
  tasks.build = routerBuildTask(options.repoRoot);
  await writeFile(denoJsonPath, jsonText(denoJson));

  const viteConfigPath = join(appDir, 'vite.config.ts');
  let viteText = await readFile(viteConfigPath, 'utf8');
  if (!viteText.includes('resolve:')) {
    const aliases = [
      ...workspaceSourceAliases(options.repoRoot).map(({ specifier, sourcePath }) => {
        // Vite reads the replacement as a path: keep it slash-separated so a
        // Windows checkout cannot split the alias across separators.
        const replacement = sourcePath.replaceAll('\\', '/');
        return `{ find: ${JSON.stringify(specifier)}, replacement: ${JSON.stringify(
          replacement,
        )} }`;
      }),
      ...(options.externalViteAliases ?? []).map(
        (find) =>
          `{ find: ${JSON.stringify(find)}, replacement: ${JSON.stringify(
            join(appDir, 'node_modules', ...find.split('/')),
          )} }`,
      ),
    ].join(',\n      ');
    viteText = viteText.replace(
      'export default defineConfig({',
      `export default defineConfig({\n  resolve: {\n    alias: [\n      ${aliases}\n    ],\n  },`,
    );
  }
  if (options.transformViteConfig) viteText = options.transformViteConfig(viteText);
  await writeFile(viteConfigPath, viteText);
}

/**
 * Prime the app's npm dependencies: Deno installs node_modules on first
 * resolution, so importing one pinned specifier under the app's own config
 * materializes the packages an app-local vite alias points at. The script
 * rides on stdin (`deno run -`) instead of `deno eval`, which would run with
 * implicit --all permissions.
 */
export async function primeAppNodeModules(appDir: string, specifier: string): Promise<void> {
  await runStep(
    process.execPath,
    [
      'run',
      '--config',
      'deno.json',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-net',
      '--allow-sys',
      // vite 8 loads rolldown's native binding (.node) at import time — the
      // same reason the app's build task carries --allow-ffi.
      '--allow-ffi',
      '--no-prompt',
      '-',
    ],
    { cwd: appDir, stdin: `import ${JSON.stringify(specifier)};` },
  );
}
