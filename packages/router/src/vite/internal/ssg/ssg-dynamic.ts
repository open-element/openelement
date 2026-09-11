/**
 * ssg-dynamic.ts - Route expansion
 *
 * Handles dynamic route rendering using getStaticPaths() + renderRoute()
 * from the SSR bundle, and i18n locale expansion.
 *
 * alpha.18 (R2-H3): renderRoute() defined results are honored here -
 * redirect/notFound pages are skipped (never persisted as 200 pages), and
 * render failures (status >= 500, collected errors, or a renderRoute throw)
 * either abort the build ('fail', default) or are logged and skipped
 * ('warn'), per SsgRenderOptions.dynamicRouteFailure. The ISR manifest data
 * only registers pages that were actually written.
 *
 * #672: getStaticPaths() throws follow the same dynamicRouteFailure policy in
 * both expansion paths (dynamic routes and i18n locale expansion).
 */

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type {
  RouteInfoEntry,
  SsgPageOutput,
  SsgRenderEvidence,
  SsgRenderOptions,
} from '../protocol/ssg.ts';
import { createLogger } from '@openelement/element';
import { formatError } from '@openelement/element';
import { resolveDynamicRoutePath } from './ssg-helpers.ts';

const log = createLogger('ssg-dynamic');

type RouteInfoItem = RouteInfoEntry;

type RenderRouteFn =
  | ((path: string, opts?: Record<string, unknown>) => Promise<SsgPageOutput>)
  | undefined;

type GetStaticPathsFn =
  | ((path: string) => Promise<Array<Record<string, string>>>)
  | undefined;

/** Classification of a renderRoute() result (alpha.18 R2-H3). */
type PageOutcome =
  | { kind: 'ok'; html: string }
  | { kind: 'redirect'; status: number; location?: string }
  | { kind: 'notFound' }
  | { kind: 'failure'; status: number; messages: string[] };

/**
 * Classify a renderRoute() output into the action the pipeline must take.
 * Only plain 2xx results with no collected errors are writable pages.
 */
function classifyPageOutput(output: SsgPageOutput | string): PageOutcome {
  // Legacy string output has no diagnostics - treat as a successful page.
  if (typeof output === 'string') return { kind: 'ok', html: output };

  const status = output.status ?? 200;
  if (output.redirect || (status >= 300 && status < 400)) {
    return { kind: 'redirect', status, location: output.redirect?.location };
  }
  if (output.notFound || status === 404) {
    return { kind: 'notFound' };
  }
  if (output.errors.length > 0 || status >= 400) {
    return {
      kind: 'failure',
      status,
      messages: output.errors.map((e) => e.message),
    };
  }
  return { kind: 'ok', html: output.html };
}

function failurePolicy(options: SsgRenderOptions): 'fail' | 'warn' {
  return options.dynamicRouteFailure ?? 'fail';
}

/**
 * Handle a page render failure according to the configured policy.
 * 'fail' aborts the build; 'warn' logs and skips the page.
 */
function handleRenderFailure(
  policy: 'fail' | 'warn',
  context: string,
  error: unknown,
): void {
  if (policy === 'fail') {
    throw new Error(
      `[openElement] SSG failed: ${context}: ${formatError(error)}`,
    );
  }
  log.warn(`${context} - skipped: ${formatError(error)}`);
}

async function writeRenderedPage(
  routePath: string,
  resolvedPath: string,
  params: Record<string, string>,
  renderRoute: NonNullable<RenderRouteFn>,
  options: SsgRenderOptions,
  root: string,
  outDir: string,
  locale?: string,
): Promise<'written' | 'skipped'> {
  const targetPath = locale ? '/' + locale + '/' + resolvedPath.replace(/^\//, '') : resolvedPath;

  const renderOpts: Record<string, unknown> = {
    params,
    // #968: do NOT pass the global html.title here — the generated
    // renderRoute falls back `title || page.head?.title || document.title`,
    // so a forced global title would short-circuit the route's own
    // head.title on prerendered dynamic routes. Omitting it restores the
    // request-time precedence (route head wins, then the global).
    headExtras: options.headExtras,
  };
  if (locale) {
    renderOpts.locale = locale;
    renderOpts.lang = locale;
  } else {
    renderOpts.lang = options.html?.lang;
  }

  const output = await renderRoute(routePath, renderOpts);
  const outcome = classifyPageOutput(output);

  // Failures throw so the caller can apply the fail/warn policy uniformly
  // with renderRoute() throws. A 500 page is never a build artifact.
  if (outcome.kind === 'failure') {
    throw new Error(
      `render failed (status ${outcome.status})` +
        (outcome.messages.length > 0 ? `: ${outcome.messages.join('; ')}` : ''),
    );
  }
  // Redirect/not-found results are route outcomes, not pages: they must not
  // be persisted as normal 200 output.
  if (outcome.kind === 'redirect') {
    log.warn(
      `Dynamic route: ${targetPath} returned redirect ${outcome.status}` +
        (outcome.location ? ` -> ${outcome.location}` : '') +
        ' - skipped (not written)',
    );
    return 'skipped';
  }
  if (outcome.kind === 'notFound') {
    log.warn(`Dynamic route: ${targetPath} returned 404 not-found - skipped (not written)`);
    return 'skipped';
  }

  const pageDir = join(root, outDir, targetPath);
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(pageDir, 'index.html'), outcome.html, 'utf-8');

  log.info(
    locale
      ? `i18n: ${targetPath}/index.html`
      : `Dynamic route: ${resolvedPath} -> ${resolvedPath}/index.html`,
  );
  return 'written';
}

/**
 * Expand dynamic routes by calling getStaticPaths() and renderRoute()
 * for each parameter set.
 *
 * Returns a map of static path params keyed by route path, which is
 * consumed later when building the ISR manifest. Only params whose page
 * was actually written are registered (alpha.18 R2-H3).
 */
export async function expandDynamicRoutes(
  dynamicRoutes: RouteInfoItem[],
  renderRoute: RenderRouteFn,
  getStaticPaths: GetStaticPathsFn,
  options: SsgRenderOptions,
  root: string,
  outDir: string,
): Promise<Map<string, Array<Record<string, string>>>> {
  const staticPathParamsByRoute = new Map<string, Array<Record<string, string>>>();
  const policy = failurePolicy(options);

  if (dynamicRoutes.length > 0 && renderRoute && getStaticPaths) {
    for (const route of dynamicRoutes) {
      let paramsList: Array<Record<string, string>>;
      try {
        paramsList = await getStaticPaths(route.path);
      } catch (e) {
        handleRenderFailure(
          policy,
          `getStaticPaths for ${route.path} failed`,
          e,
        );
        continue;
      }

      if (paramsList.length === 0) {
        log.info(`Dynamic route ${route.path} has no static paths - skipping`);
        continue;
      }

      const writtenParams: Array<Record<string, string>> = [];
      for (const params of paramsList) {
        let resolvedPath: string;
        try {
          resolvedPath = resolveDynamicRoutePath(route.path, route.paramNames, params);
        } catch (e) {
          log.warn(`Skipping unsafe dynamic route ${route.path}: ${formatError(e)}`);
          continue;
        }

        let outcome: 'written' | 'skipped';
        try {
          outcome = await writeRenderedPage(
            route.path,
            resolvedPath,
            params,
            renderRoute,
            options,
            root,
            outDir,
          );
        } catch (e) {
          handleRenderFailure(
            policy,
            `dynamic route ${resolvedPath} could not be rendered`,
            e,
          );
          continue;
        }
        if (outcome === 'written') writtenParams.push(params);
      }

      // ISR manifest registration happens only after rendering, and only for
      // pages that were actually written.
      if (writtenParams.length > 0) {
        staticPathParamsByRoute.set(route.path, writtenParams);
      }
    }
  }

  return staticPathParamsByRoute;
}

/**
 * Expand rendered pages for each locale when i18n is configured.
 *
 * For each locale and each route, re-renders the route with the locale
 * parameter and writes output under /{locale}/{path}/index.html.
 */
export async function expandI18nLocales(
  evidence: SsgRenderEvidence,
  renderRoute: RenderRouteFn,
  routeInfo: RouteInfoItem[],
  getStaticPaths: GetStaticPathsFn,
  options: SsgRenderOptions,
  root: string,
  outDir: string,
): Promise<void> {
  const i18nOpts = evidence.i18nOptions || null;
  if (!i18nOpts || !renderRoute) return;

  const locales: string[] = i18nOpts.locales || [];
  if (locales.length <= 1) return;
  const policy = failurePolicy(options);

  log.info(`i18n: expanding for locales: ${locales.join(', ')}`);
  for (const locale of locales) {
    if (locale === i18nOpts.defaultLocale) continue;
    for (const route of routeInfo) {
      let paramsList: Array<Record<string, string>>;
      if (!route.isDynamic) {
        paramsList = [{}];
      } else if (getStaticPaths) {
        try {
          paramsList = await getStaticPaths(route.path);
        } catch (e) {
          // #672: getStaticPaths failures follow the same dynamicRouteFailure
          // policy as render failures (see expandDynamicRoutes).
          handleRenderFailure(
            policy,
            `i18n: getStaticPaths for ${route.path} failed`,
            e,
          );
          continue;
        }
      } else {
        continue;
      }
      if (paramsList.length === 0) continue;

      for (const params of paramsList) {
        let resolvedPath: string;
        try {
          resolvedPath = resolveDynamicRoutePath(route.path, route.paramNames, params);
        } catch (e) {
          log.warn(`i18n: skipping unsafe dynamic route ${route.path}: ${formatError(e)}`);
          continue;
        }

        const pathSegment = resolvedPath.split('/')[1] || '';
        if (locales.includes(pathSegment)) continue;

        try {
          await writeRenderedPage(
            route.path,
            resolvedPath,
            params,
            renderRoute,
            options,
            root,
            outDir,
            locale,
          );
        } catch (e) {
          handleRenderFailure(
            policy,
            `i18n locale ${locale} on ${resolvedPath} could not be rendered`,
            e,
          );
        }
      }
    }
  }
}
