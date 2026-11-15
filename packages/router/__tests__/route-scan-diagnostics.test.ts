/**
 * The route scan's Tier-2 degradation collector: each degradation site
 * (missing routes directory, a file vanished before its stat, an unreadable
 * route module, a page route with no tagName export) leaves a structured,
 * deduped, non-fatal diagnostic that the build pass surfaces through the
 * build-diagnostics envelope channel (#1612) — reported, never silent.
 *
 * Race tolerance stays: a file disappearing between the listing and its
 * stat/read is tolerated (the scan proceeds) and reported (the note carries
 * the path).
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';
import {
  resetBuildExitRecords,
  takeBuildDiagnostics,
} from '../src/vite/internal/build-diagnostics.ts';
import { ScanSurfaceErrorCode } from '../src/internal/error-codes.ts';
import { scanRoutes, takeRouteScanDiagnostics } from '../src/vite/internal/ssg/route-scanner.ts';

// The unreadable-module note needs a file that exists at stat time and reads
// as ENOENT — a genuine mid-scan deletion race, which a test cannot arrange
// with real files. The wrap keeps the REAL helpers (the other tests here
// exercise real fs behavior) and lets one test answer undefined for exactly
// one read: the once-implementation delegates back through the same wrapper,
// whose base implementation is the real helper.
const realSafeReadFile = await import('../src/vite/internal/ssg/route-scanner-fs.ts');
vi.mock('../src/vite/internal/ssg/route-scanner-fs.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/vite/internal/ssg/route-scanner-fs.ts')>();
  return { ...actual, safeReadFile: vi.fn(actual.safeReadFile) };
});

// The collector dedupes per process; drain after the file so the notes of
// one tree never leak past this suite.
afterAll(() => {
  takeRouteScanDiagnostics();
});

test('route scan: a missing routes directory is a coded warning diagnostic, not a silent empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-route-scan-'));
  try {
    const missing = join(root, 'no-such-routes');
    const routes = await scanRoutes(missing);
    expect(routes).toEqual([]);
    const drained = takeRouteScanDiagnostics();
    const note = drained.find(
      (diagnostic) => diagnostic.code === ScanSurfaceErrorCode.ROUTES_DIR_MISSING,
    );
    expect(note, JSON.stringify(drained)).toEqual(expect.anything());
    expect(note?.severity).toEqual('warning');
    expect(note?.file).toEqual(missing);
    expect(note?.message).toContain('does not exist');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('route scan: a file vanished before stat (dangling symlink) is race-tolerant and reported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-route-scan-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, 'index.tsx'), 'export const x = 1;\n');
    // A dangling symlink appears in the directory listing but stats ENOENT —
    // the same shape the listing/stat race produces.
    await symlink(join(root, 'ghost-target'), join(routesDir, 'ghost.tsx'));

    const routes = await scanRoutes(routesDir);
    // The scan proceeds: the real route is still found, the ghost is skipped.
    expect(routes.map((route) => route.filePath)).toEqual(['index.tsx']);
    const note = takeRouteScanDiagnostics().find(
      (diagnostic) => diagnostic.code === ScanSurfaceErrorCode.ROUTE_FILE_VANISHED,
    );
    expect(note).toEqual(expect.anything());
    expect(note?.severity).toEqual('warning');
    expect(note?.file).toEqual(join(routesDir, 'ghost.tsx'));
  } finally {
    await rm(root, { recursive: true });
  }
});

test('route scan: a route module that reads as missing is reported as unreadable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-route-scan-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    await mkdir(routesDir, { recursive: true });
    const routeFile = join(routesDir, 'page.tsx');
    await writeFile(routeFile, 'export const x = 1;\n');

    // Simulate the read-side race: stat succeeds, the read answers ENOENT.
    vi.mocked(realSafeReadFile.safeReadFile).mockImplementationOnce((filePath) => {
      if (filePath === routeFile) return Promise.resolve(undefined);
      return realSafeReadFile.safeReadFile(filePath);
    });

    const routes = await scanRoutes(routesDir);
    // The route entry still exists (the scan degrades, it does not crash);
    // its page facts are simply absent, and the note names the file.
    expect(routes.map((route) => route.filePath)).toEqual(['page.tsx']);
    const note = takeRouteScanDiagnostics().find(
      (diagnostic) => diagnostic.code === ScanSurfaceErrorCode.ROUTE_MODULE_UNREADABLE,
    );
    expect(note).toEqual(expect.anything());
    expect(note?.severity).toEqual('warning');
    expect(note?.file).toEqual(routeFile);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('route scan: a page route with no tagName export is an info advisory, deduped per path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-route-scan-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, 'plain.ts'), 'export const x = 1;\n');

    await scanRoutes(routesDir);
    const first = takeRouteScanDiagnostics();
    const note = first.find(
      (diagnostic) => diagnostic.code === ScanSurfaceErrorCode.ROUTE_TAG_NAME_MISSING,
    );
    expect(note).toEqual(expect.anything());
    expect(note?.severity).toEqual('info');
    expect(note?.file).toEqual(join(routesDir, 'plain.ts'));

    // Dedup semantics: a second scan pass (the dev watcher's different
    // routesDir spelling) does not re-report the same file.
    await scanRoutes(join(root, 'app', 'routes'));
    const second = takeRouteScanDiagnostics();
    expect(
      second.some((diagnostic) => diagnostic.code === ScanSurfaceErrorCode.ROUTE_TAG_NAME_MISSING),
      JSON.stringify(second),
    ).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('route scan: the drained notes are envelope-shaped for the build pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-route-scan-'));
  try {
    const routesDir = join(root, 'app', 'routes');
    await mkdir(routesDir, { recursive: true });
    await writeFile(join(routesDir, 'plain.ts'), 'export const x = 1;\n');

    resetBuildExitRecords();
    await scanRoutes(routesDir);
    // The consumer contract (plugin-scanners): every drained note records as
    // a build-phase envelope with the same code, severity, message and file.
    for (const diagnostic of takeRouteScanDiagnostics()) {
      // Shape guard: exactly the fields the envelope consumer maps.
      expect(Object.keys(diagnostic).sort()).toEqual(['code', 'file', 'message', 'severity']);
    }
    expect(takeBuildDiagnostics()).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});
