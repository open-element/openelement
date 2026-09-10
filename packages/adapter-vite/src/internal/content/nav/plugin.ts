/**
 * plugin.ts - Navigation plugin
 *
 * Build-time Vite plugin that scans route files for `meta` exports and writes
 * app/data/_generated-nav.ts. Site search is handled separately by Pagefind
 * (ADR-0123 item 17, #867) — see site/build-pagefind.ts.
 */

import type { Plugin, ViteDevServer } from 'vite';
import type { NavOptions } from '../types.ts';
import type { OpenElementBuildContextLike } from '../../protocol/framework.ts';
import type { FileSystemAdapter } from '../fs-adapter.ts';
import { nodeFsAdapter } from '../fs-adapter.ts';
import { scanNavData } from './scanner.ts';
import { writeNavModule } from './writer.ts';
import { createLogger, formatError } from '@openelement/element';
import { join, relative, resolve } from 'node:path';
import { DEFAULT_DATA_DIR, DEFAULT_ROUTES_DIR } from '../../paths.ts';

const log = createLogger('content:nav');

export function createNavPlugin(
  options: NavOptions,
  ctx?: OpenElementBuildContextLike,
  fs: FileSystemAdapter = nodeFsAdapter,
): Plugin {
  const resolvedNavOpts = {
    ...options,
    routesDir: options.routesDir ?? DEFAULT_ROUTES_DIR,
  };
  const dataFile = () => join(fs.cwd(), DEFAULT_DATA_DIR, '_generated-nav.ts');

  async function regenerateNavData(): Promise<number> {
    const navSections = await scanNavData(resolvedNavOpts);
    const headerNav = resolvedNavOpts.headerNav || [];
    if (ctx) {
      ctx.registerPlugin('navSections', navSections);
      ctx.registerPlugin('headerNav', headerNav);
    }

    // SOP-001: Write generated nav data module to disk.
    // Failing to write must fail the build: consumers import these files.
    const dataDir = join(fs.cwd(), DEFAULT_DATA_DIR);
    fs.mkdirSync(dataDir, { recursive: true });
    const navModule = writeNavModule({ headerNav, navSections });
    fs.writeFileSync(dataFile(), navModule, 'utf-8');
    log.info(`Nav: wrote _generated-nav.ts (${navSections.length} section(s))`);
    return navSections.length;
  }

  return {
    name: 'open:content:nav',

    async buildStart() {
      const sectionCount = await regenerateNavData();

      log.info(`Nav: ${sectionCount} section(s) configured`);
    },

    configureServer(server: ViteDevServer) {
      const absoluteRoutesDir = resolve(server.config.root, resolvedNavOpts.routesDir!);

      // Watch the routes directory for changes — nav data derives from the
      // route files' `meta` exports.
      server.watcher.add(absoluteRoutesDir);

      const invalidateNavData = (file: string) => {
        if (!file.startsWith(absoluteRoutesDir)) return;
        // Extension filter mirrors the route set watcher in src/plugin.ts.
        if (!/\.(ts|tsx|js|jsx|mdx)$/.test(file)) return;

        log.info(
          `Route meta changed: ${relative(server.config.root, file)} - regenerating nav data`,
        );
        // #1028: regenerate the data module BEFORE reloading — a bare
        // full-reload replays imports against the stale generated file that
        // buildStart() wrote, so edits never reach the browser.
        regenerateNavData().then(() => {
          const mod = server.moduleGraph.getModuleById(dataFile());
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.hot.send({ type: 'full-reload' });
        }).catch((err: unknown) => {
          log.error(`Nav data regeneration failed: ${formatError(err)}`);
        });
      };

      server.watcher.on('change', invalidateNavData);
      server.watcher.on('add', invalidateNavData);
      server.watcher.on('unlink', invalidateNavData);

      // M-19 fix: Clean up watcher listeners on server close
      server.httpServer?.on('close', () => {
        server.watcher.off('change', invalidateNavData);
        server.watcher.off('add', invalidateNavData);
        server.watcher.off('unlink', invalidateNavData);
      });
    },
  };
}
