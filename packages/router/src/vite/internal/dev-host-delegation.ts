/**
 * The dev host's delegation of everything Vite owns (S-C1.3 follow-up).
 *
 * `vite dev` in an OpenElement app runs the application through the
 * dev-server peer, whose middleware decides by pattern whether a request is
 * Vite's or the app's. Two of those decisions cannot be expressed as patterns,
 * and both were reproducible defects:
 *
 * 1. A NON-ROOT BASE. The browser keeps every URL base-prefixed (module code,
 *    the injected Vite client, framework resource links), but the app's routes
 *    and every Vite endpoint are written for base-less paths, and Vite's own
 *    base middleware only strips for middlewares installed after it. With
 *    `base: '/sub/'` the base-prefixed `/sub/@vite/client` was routed into the
 *    application: the browser module graph never loaded, nothing upgraded, and
 *    the app was not reachable at its own public root.
 * 2. REQUESTS FOR FILES VITE SERVES. The peer's pattern list has no entry for
 *    assets, so a `.css` `url('./texture.png')` — rewritten by Vite's dev CSS
 *    pipeline into a project-relative URL — was claimed by the application and
 *    returned its 404 while the stylesheet itself arrived.
 *
 * Both middlewares are installed immediately before the application's, i.e.
 * AFTER every router-owned dev endpoint (which are base-aware and must keep
 * seeing the base) and BEFORE the app + the peer's pattern decisions. The
 * strip is derived from Vite's resolved `base` alone and the file delegation
 * from Vite's own `assetsInclude` configuration — no second list of reserved
 * paths, and no production routing semantics changed.
 */

import { statSync } from 'node:fs';
import type { ViteDevServer } from 'vite';
import { resolve, sep } from 'pathe';

/** Vite's file-dev endpoint prefix (`/@fs/<absolute path>`). */
const FS_PREFIX = '/@fs/';

/**
 * Strip the configured public base before any downstream middleware sees the
 * path (S-C1.3 follow-up, non-root dev base).
 *
 * The dev host IS the application server in `vite dev`: the app's routes and
 * every Vite-owned endpoint (`/@vite/client`, `/@id/...`, `/@fs/...`,
 * `/node_modules/...`) are written for base-less paths, and Vite's own base
 * middleware only strips for the middlewares it installs after itself — plugin
 * middlewares run *before* it. A non-root base therefore reached the
 * application and the dev-server peer unstripped: `/sub/@vite/client` was
 * routed into the app (404) and the browser module graph never loaded, while
 * the app itself was unreachable at its public root (`GET /sub/` → the app's
 * 404). Both symptoms are the same missing step.
 *
 * The strip is derived from Vite's resolved `base` alone — no second list of
 * reserved paths, and no change to production routing semantics: the browser
 * keeps seeing base-prefixed URLs (module code, the injected client script,
 * framework resource links all carry `config.base`), and the host removes the
 * prefix once, exactly as a base deployment does.
 */
function installDevBaseStrip(server: ViteDevServer): void {
  const base = server.config.base ?? '/';
  if (base === '/' || base === '') return;
  server.middlewares.use((request, _response, next) => {
    const url = request.url;
    if (url !== undefined && (url === base || url.startsWith(base))) {
      const stripped = url.slice(base.length - 1);
      request.url = stripped === '' ? '/' : stripped;
    }
    next();
  });
}

/**
 * Hand requests for files Vite serves to Vite (S-C1.3 follow-up).
 *
 * The dev-server peer delegates by pattern, and its pattern list has no entry
 * for assets: a `.css` `url('./texture.png')` rewritten by Vite's dev CSS
 * pipeline into a project-relative URL was therefore claimed by the
 * application — the CSS resource arrived, its image 404'd, and no pattern list
 * can say whether a path is a file on disk.
 *
 * Which paths those are is a Vite question, answered here with Vite's own
 * resolved configuration: a GET/HEAD request for an existing file inside the
 * project root that Vite treats as an ASSET (`config.assetsInclude` — Vite's
 * own list, plus whatever the application added) is rewritten to Vite's
 * documented `/@fs/` file endpoint, which the peer's namespace exclusion
 * already delegates. Module and stylesheet requests keep the exact URL form
 * they have today; public-dir files keep the peer's own public-dir check; and
 * Vite's file-serving policy (`server.fs.allow`/`deny`) still decides whether
 * the file may be read.
 */
function installDevAssetDelegation(server: ViteDevServer): void {
  const { root, publicDir, assetsInclude } = server.config;
  const publicRoot = publicDir === '' ? undefined : `${resolve(publicDir)}${sep}`;
  const rootPrefix = `${resolve(root)}${sep}`;
  server.middlewares.use((request, _response, next) => {
    const url = request.url;
    if (url === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
      next();
      return;
    }
    const queryAt = url.indexOf('?');
    const pathname = decodeURIComponent(queryAt === -1 ? url : url.slice(0, queryAt));
    if (!pathname.startsWith('/') || pathname.startsWith('/@')) {
      next();
      return;
    }
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(rootPrefix)) {
      next();
      return;
    }
    if (publicRoot !== undefined && file.startsWith(publicRoot)) {
      next();
      return;
    }
    if (!assetsInclude(file)) {
      next();
      return;
    }
    try {
      if (!statSync(file).isFile()) {
        next();
        return;
      }
    } catch {
      next();
      return;
    }
    request.url = `${FS_PREFIX}${file}${queryAt === -1 ? '' : url.slice(queryAt)}`;
    next();
  });
}

/**
 * Install both delegation middlewares, in order, in front of the application's
 * middleware.
 */
export function installDevHostDelegation(server: ViteDevServer): void {
  installDevBaseStrip(server);
  installDevAssetDelegation(server);
}
