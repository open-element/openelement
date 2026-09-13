/** Route identity, URL winner and HTTP policy; URLPatternList owns indexing. */
import { URLPatternList } from '@openelement/url-pattern-list';
import { normalizeRoutePatternForURLPattern } from './route-pattern.ts';
import { URLPattern as URLPatternPolyfill } from 'urlpattern-polyfill';

/**
 * Non-pathname URL components for explicit Route Mode (protocol, hostname,
 * port, search, hash, …). `path` is the single pathname truth: a record
 * whose pattern disagrees on pathname would fork route identity, so the
 * type omits it and the constructor rejects it at runtime (#1325).
 */
export type RoutePatternComponents = Omit<URLPatternInit, 'pathname'>;

export interface RouteRecord {
  path: string;
  id?: string;
  /** Full URL component patterns for explicit Route Mode, minus pathname. */
  pattern?: RoutePatternComponents;
  methods?: readonly string[];
}

export interface RouteMatch<T extends RouteRecord> {
  route: T;
  id: string;
  params: Record<string, string>;
  searchParams: URLSearchParams;
  patternResult: URLPatternResult;
}

export type RouteResolution<T extends RouteRecord> =
  | ({ kind: 'match'; method: string } & RouteMatch<T>)
  | { kind: 'method-not-allowed'; allow: string[] }
  | { kind: 'not-found' };

export interface RouteTableOptions {
  basePath?: string;
  trailingSlash?: 'strict' | 'ignore';
}

export type URLPatternConstructor = new (init: URLPatternInit) => URLPattern;
const runtimeURLPattern = (): URLPatternConstructor =>
  (globalThis.URLPattern ?? URLPatternPolyfill) as URLPatternConstructor;

function staticPathKey(pathname: string): string {
  const url = new URL('https://openelement.invalid');
  url.pathname = pathname;
  return url.pathname;
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === '/') return '';
  const normalized = staticPathKey(basePath);
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function routePathname(pathname: string, options: RouteTableOptions): string | undefined {
  let normalized = staticPathKey(pathname);
  const base = normalizeBasePath(options.basePath);
  if (base) {
    if (normalized !== base && !normalized.startsWith(base + '/')) return undefined;
    normalized = normalized.slice(base.length) || '/';
  }
  if (options.trailingSlash === 'ignore' && normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function methodsFor(route: RouteRecord): string[] {
  const methods = [
    ...new Set((route.methods?.length ? route.methods : ['GET']).map((m) => m.toUpperCase())),
  ];
  if (methods.includes('GET') && !methods.includes('HEAD')) methods.push('HEAD');
  return methods.sort();
}

function decodeComponent(value: string, plusAsSpace = false): string {
  const normalized = plusAsSpace ? value.replace(/\+/g, ' ') : value;
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function isSafeParamName(name: string): boolean {
  return name !== '__proto__' && name !== 'prototype' && name !== 'constructor';
}

export class RouteTable<T extends RouteRecord> {
  readonly #list: URLPatternList<{ route: T; id: string }>;
  readonly routes: readonly T[];
  readonly options: RouteTableOptions;

  constructor(
    routes: readonly T[],
    Pattern: URLPatternConstructor = runtimeURLPattern(),
    options: RouteTableOptions = {},
  ) {
    this.options = Object.freeze({ ...options });
    this.routes = Object.freeze(
      routes.map((route) =>
        Object.freeze({
          ...route,
          ...(route.methods ? { methods: Object.freeze([...route.methods]) } : {}),
          ...(route.pattern ? { pattern: Object.freeze({ ...route.pattern }) } : {}),
        })
      ),
    );
    const ids = new Set<string>();
    const entries = this.routes.map((route, index) => {
      const id = route.id ?? String(index);
      if (ids.has(id)) throw new TypeError(`Duplicate route identity: ${id}`);
      ids.add(id);
      // JS callers bypass the Omit type; pathname must never have a second
      // owner, so reject it at runtime rather than silently overriding.
      if (route.pattern && Object.hasOwn(route.pattern, 'pathname')) {
        throw new TypeError(
          `Route "${route.path}": pattern.pathname is not allowed; \`path\` is the only pathname truth`,
        );
      }
      let pathname = normalizeRoutePatternForURLPattern(route.path);
      if (options.trailingSlash === 'ignore' && pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      return [new Pattern({ ...route.pattern, pathname }), { route, id }] as const;
    });
    const list = new URLPatternList<{ route: T; id: string }>();
    for (const [pattern, value] of entries) list.addPattern(pattern, value);
    this.#list = list;
  }

  #url(input: string | URL, search: string): URL | undefined {
    const url = input instanceof URL ? new URL(input.href) : new URL(input, 'https://localhost');
    if (search) url.search = search;
    const pathname = routePathname(url.pathname, this.options);
    if (pathname === undefined) return undefined;
    url.pathname = pathname;
    return url;
  }

  match(input: string | URL, search = ''): RouteMatch<T> | null {
    const url = this.#url(input, search);
    if (!url) return null;
    const winner = this.#list.match(url);
    if (!winner) return null;
    const params: Record<string, string> = Object.create(null);
    for (const [name, value] of Object.entries(winner.result.pathname.groups)) {
      if (value !== undefined && !/^\d+$/.test(name) && isSafeParamName(name)) {
        params[name] = decodeComponent(value);
      }
    }
    return {
      ...winner.value,
      params,
      searchParams: url.searchParams,
      patternResult: winner.result,
    };
  }

  resolve(input: string | URL, search = '', method = 'GET'): RouteResolution<T> {
    const winner = this.match(input, search);
    if (!winner) return { kind: 'not-found' };
    const requested = method.toUpperCase();
    const allow = methodsFor(winner.route);
    if (!allow.includes(requested)) return { kind: 'method-not-allowed', allow };
    const explicit = winner.route.methods?.map((m) => m.toUpperCase()) ?? ['GET'];
    return {
      kind: 'match',
      ...winner,
      method: requested === 'HEAD' && !explicit.includes('HEAD') ? 'GET' : requested,
    };
  }

  candidateCount(input: string | URL): number {
    const url = this.#url(input, '');
    return url ? this.#list.candidateCount(url) : 0;
  }
}

export const URLPatternPolyfillConstructor = URLPatternPolyfill as URLPatternConstructor;
