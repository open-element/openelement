/**
 * Alias a scaffolded app to the monorepo workspace sources (#1472).
 *
 * applyWorkspaceAliases is the qualify-fixture variant: it merges caller
 * dependency pins into the app's package.json, points every @openelement/*
 * dependency at the workspace package directory (link:), rewires the app's
 * `build` script to the in-repo Router build CLI, and injects the matching
 * resolve.alias block into vite.config.ts. workspaceSourceAliases exposes the
 * alias mapping as absolute source paths for consumers that need a different
 * target shape (the starter smoke rewires to packed tarballs instead so the
 * packed starter's transitive package manifests keep resolving).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPackageAliases } from '../../../tools/lib/package-aliases.ts';
import { runStep } from './command-run.ts';
import { readJson } from './json-file.ts';
import { routerBuildScript } from './build-router.ts';

export interface WorkspaceSourceAlias {
  specifier: string;
  /** Absolute path of the export target inside the repository. */
  sourcePath: string;
}

/** The workspace package export mapping as absolute source paths. */
export function workspaceSourceAliases(repoRoot: string): WorkspaceSourceAlias[] {
  return [...allPackageAliases(repoRoot)].map(([specifier, url]) => ({
    specifier,
    sourcePath: fileURLToPath(url),
  }));
}

export interface ApplyWorkspaceAliasesOptions {
  repoRoot: string;
  /**
   * Extra dependency pins merged into the app manifest as plain package.json
   * ranges (`'lit': '3.3.3'`), consumed verbatim — no import-map shapes here.
   */
  extraImports?: Record<string, string>;
  /**
   * Specifiers resolved from the app's own node_modules and therefore aliased
   * as app-local paths in vite.config.ts (each must appear in dependencies).
   */
  externalViteAliases?: readonly string[];
  /** Final text transform applied to vite.config.ts after the alias injection. */
  transformViteConfig?: (text: string) => string;
}

/**
 * Patch the scaffolded app's package.json and vite config so the temporary
 * app builds against workspace SOURCE artifacts on the node host.
 */
export async function applyWorkspaceAliases(
  appDir: string,
  options: ApplyWorkspaceAliasesOptions,
): Promise<void> {
  const manifestPath = join(appDir, 'package.json');
  const manifest = await readJson<{
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  }>(manifestPath);
  const dependencies = (manifest.dependencies ??= {});
  // Workspace SOURCE contract: the vite alias block below points every
  // @openelement/* import at the package's source exports, so the manifest
  // entries only need to link the package directory — no registry fetch of a
  // second copy that could shadow the source mapping.
  for (const [specifier] of allPackageAliases(options.repoRoot)) {
    const pkgName = specifier
      .split('/')
      .slice(0, specifier.startsWith('@') ? 2 : 1)
      .join('/');
    const pkgDir = join(options.repoRoot, 'packages', pkgName.replace('@openelement/', ''));
    dependencies[pkgName] = `link:${pkgDir}`;
  }
  // Fixture-specific pins (extraImports) install the third-party sources the
  // fixture's own islands import (and anything an externalViteAliases entry
  // points at); the workspace build source (Router CLI/vite plugin, element
  // signal engine) resolves its imports from the repository's node_modules
  // relative to the source files the aliases point at. Values are plain
  // package.json ranges, applied verbatim.
  Object.assign(dependencies, options.extraImports ?? {});
  manifest.scripts.build = routerBuildScript(options.repoRoot);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
 * Install the app's npm dependencies with pnpm. The generated pnpm-workspace
 * file keeps the temp app its OWN workspace root: the repository's
 * pnpm-workspace.yaml (membership globs, minimumReleaseAge policy,
 * allowBuilds allowlist, root lockfile) governs THIS checkout, not a consumer
 * project that merely sits inside it — the same contract the starter smoke
 * documents for its clean-machine simulation.
 */
export async function installAppDependencies(appDir: string): Promise<void> {
  await writeFile(
    join(appDir, 'pnpm-workspace.yaml'),
    'packages: []\nallowBuilds:\n  esbuild: true\n',
  );
  await runStep('pnpm', ['install'], { cwd: appDir });
}
