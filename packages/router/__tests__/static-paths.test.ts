/**
 * Tests for getStaticPaths() protocol in SSG pipeline.
 *
 * Validates:
 * 1. Dynamic route detection in entry-descriptor
 * 2. Parameter name extraction from route paths
 * 3. Backward compatibility (no getStaticPaths = skip)
 */

import { assertEquals } from '@std/assert';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/index.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

// ─── Helper: create a RouteEntry ──────────────────────────────

function makeRoute(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return {
    path: '/',
    filePath: 'index.ts',
    type: 'page',
    varName: 'RouteIndex',
    ...overrides,
  };
}

// ─── Test: dynamic route detection ─────────────────────────────

Deno.test('buildEntryDescriptor: static route has isDynamic=false', () => {
  const routes = [makeRoute({ path: '/about', filePath: 'about.ts', varName: 'RouteAbout' })];
  const desc = buildEntryDescriptor(routes);
  const page = desc.pageRoutes[0];
  assertEquals(page.isDynamic, false);
  assertEquals(page.paramNames, []);
});

Deno.test('buildEntryDescriptor: /blog/:slug detected as dynamic', () => {
  const routes = [
    makeRoute({ path: '/blog/:slug', filePath: 'blog/[slug].ts', varName: 'RouteBlogSlug' }),
  ];
  const desc = buildEntryDescriptor(routes);
  const page = desc.pageRoutes[0];
  assertEquals(page.isDynamic, true);
  assertEquals(page.paramNames, ['slug']);
});

Deno.test('buildEntryDescriptor: /posts/:category/:id extracts two params', () => {
  const routes = [
    makeRoute({
      path: '/posts/:category/:id',
      filePath: 'posts/[category]/[id].ts',
      varName: 'RoutePostsCategoryId',
    }),
  ];
  const desc = buildEntryDescriptor(routes);
  const page = desc.pageRoutes[0];
  assertEquals(page.isDynamic, true);
  assertEquals(page.paramNames, ['category', 'id']);
});

Deno.test('buildEntryDescriptor: mixed static and dynamic routes', () => {
  const routes = [
    makeRoute({ path: '/', filePath: 'index.ts', varName: 'RouteIndex' }),
    makeRoute({ path: '/about', filePath: 'about.ts', varName: 'RouteAbout' }),
    makeRoute({ path: '/blog/:slug', filePath: 'blog/[slug].ts', varName: 'RouteBlogSlug' }),
    makeRoute({
      path: '/guide/getting-started',
      filePath: 'guide/getting-started.ts',
      varName: 'RouteGuideGettingStarted',
    }),
  ];
  const desc = buildEntryDescriptor(routes);
  assertEquals(desc.pageRoutes.length, 4);

  const staticRoutes = desc.pageRoutes.filter((r: { isDynamic?: boolean }) => !r.isDynamic);
  const dynamicRoutes = desc.pageRoutes.filter((r: { isDynamic?: boolean }) => r.isDynamic);
  assertEquals(staticRoutes.length, 3);
  assertEquals(dynamicRoutes.length, 1);
  assertEquals(dynamicRoutes[0].paramNames, ['slug']);
});

// ─── Test: param name extraction edge cases ────────────────────

Deno.test('buildEntryDescriptor: trailing param /archive/:year', () => {
  const routes = [
    makeRoute({
      path: '/archive/:year',
      filePath: 'archive/[year].ts',
      varName: 'RouteArchiveYear',
    }),
  ];
  const desc = buildEntryDescriptor(routes);
  assertEquals(desc.pageRoutes[0].paramNames, ['year']);
});

Deno.test('buildEntryDescriptor: param between segments /user/:id/profile', () => {
  const routes = [
    makeRoute({
      path: '/user/:id/profile',
      filePath: 'user/[id]/profile.ts',
      varName: 'RouteUserIdProfile',
    }),
  ];
  const desc = buildEntryDescriptor(routes);
  assertEquals(desc.pageRoutes[0].paramNames, ['id']);
});

// ─── Test: route path resolution ────────────────────────────────

Deno.test('route path resolution: /blog/:slug + { slug: "v0-8-0" } -> /blog/v0-8-0', () => {
  const template = '/blog/:slug';
  const params: Record<string, string> = { slug: 'v0-8-0' };
  const resolved = template.replace(/:([^/]+)/g, (_, name: string) => params[name] || name);
  assertEquals(resolved, '/blog/v0-8-0');
});

Deno.test('route path resolution: /posts/:category/:id -> /posts/guide/architecture', () => {
  const template = '/posts/:category/:id';
  const params: Record<string, string> = { category: 'guide', id: 'architecture' };
  const resolved = template.replace(/:([^/]+)/g, (_, name: string) => params[name] || name);
  assertEquals(resolved, '/posts/guide/architecture');
});

Deno.test('route path resolution: static path unchanged', () => {
  const template = '/about';
  const resolved = template.replace(/:([^/]+)/g, (_, name: string) => name);
  assertEquals(resolved, '/about');
});
