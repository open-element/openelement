/**
 * Fail-closed Vite unification gate (1.0 Alpha baseline).
 *
 * The repository runs exactly one Vite major (8): workspace development and
 * the root lockfile pin a single patch, publishable packages declare a
 * caret peer range, and no legacy path may reappear:
 *
 * - no Vite 7 (or any non-8 major) in any tracked manifest or the pnpm lock
 * - no `rolldown-vite` transitional specifier
 * - no `@openelement/adapter-vite` legacy adapter in any manifest
 * - no `@rollup/plugin-terser` (no independent value over Vite 8/Rolldown)
 * - no second first-party bundler orchestration (`npm:esbuild`, `npm:rollup`,
 *   `rolldown-vite` imports in first-party build sources; the WTR browser
 *   test host is exempt — it serves tests, it does not build products)
 * - the starter template PINS `vite` directly, at exactly the version
 *   `packages/router/package.json` declares in its own `dependencies.vite`:
 *   the scaffold is package-manager neutral (no pnpm `catalog:`, no
 *   pnpm-workspace.yaml, no `vite-plus`), so the generated project's vite is
 *   its own devDependency — and it must be the version the router's Vite
 *   plugin resolves, or the consumer tree carries a second vite instance
 *
 * Usage: node tools/repo/deps-vite-check.ts (pnpm --dir tools/repo run deps:vite-check)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import process from 'node:process';

/** The ONE vite version the router and every generated project resolve; main()
 * verifies the router manifest against it before checking the template. */
export const VITE_DEV_PIN = '8.0.16';
export const VITE_PEER_RANGE = 'npm:vite@^8.0.0';

const MANIFEST_GLOB_ROOTS = [
  'package.json',
  'packages/*/package.json',
  'www/package.json',
  'apps/saas/package.json',
  'tests/fixtures/*/package.json',
  'tests/e2e/starter-smoke/package.json',
  // The starter template ships to every new user. It PINS vite directly (the
  // scaffold is package-manager neutral: no catalog, no workspace file), and
  // the pin must be the router's own version — see ViteCheckOptions.
  'packages/create/templates/package.json.tmpl',
];

export interface ManifestRecord {
  path: string;
  imports?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface ViteViolation {
  where: string;
  message: string;
}

/** Options for {@link checkManifests}. */
export interface ViteCheckOptions {
  /**
   * The exact vite version `packages/router/package.json` declares in
   * `dependencies.vite` — the version the router itself resolves. The starter
   * template must pin exactly this version: the generated project builds
   * through the same router Vite plugin, so a divergent pin is a second vite
   * resolution in the consumer's tree. Defaults to {@link VITE_DEV_PIN}, the
   * value `main()` verifies the router manifest against.
   */
  routerVitePin?: string;
}

const NPM_VERSION_RE = /^npm:([^@]+)@(\^|~)?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/;

export function parseNpmSpecifier(
  value: string,
): { name: string; major: number; raw: string } | null {
  const match = value.match(NPM_VERSION_RE);
  if (!match) return null;
  return { name: match[1], major: Number(match[3]), raw: value };
}

function viteSpecifierViolations(
  path: string,
  slot: string,
  key: string,
  value: string,
  routerVitePin: string,
): ViteViolation[] {
  const out: ViteViolation[] = [];
  if (key === 'rolldown-vite' || value.includes('rolldown-vite')) {
    out.push({
      where: `${path} ${slot}.${key}`,
      message: 'rolldown-vite transitional path is retired',
    });
    return out;
  }
  if (key === '@openelement/adapter-vite' || value.includes('@openelement/adapter-vite')) {
    out.push({
      where: `${path} ${slot}.${key}`,
      message: 'legacy adapter-vite path is retired; use @openelement/router/vite',
    });
    return out;
  }
  if (key === '@rollup/plugin-terser' || value.includes('@rollup/plugin-terser')) {
    out.push({
      where: `${path} ${slot}.${key}`,
      message: '@rollup/plugin-terser has no independent value over Vite 8/Rolldown',
    });
    return out;
  }
  if (key !== 'vite') return out;
  const parsed = parseNpmSpecifier(value);
  if (!parsed) {
    out.push({ where: `${path} ${slot}.${key}`, message: `unparseable vite specifier '${value}'` });
    return out;
  }
  if (path.endsWith('.tmpl')) {
    // The generated project's vite is its own devDependency (no catalog owns
    // it anymore), and it must be the version the router itself resolves: the
    // scaffold builds through the same router Vite plugin, so a divergent pin
    // resolves a second vite instance into the consumer tree.
    if (value !== `npm:vite@${routerVitePin}`) {
      out.push({
        where: `${path} ${slot}.${key}`,
        message:
          `the starter template must pin the router's own vite exactly ` +
          `('npm:vite@${routerVitePin}'), found '${value}'`,
      });
    }
    return out;
  }
  if (parsed.major !== 8) {
    out.push({
      where: `${path} ${slot}.${key}`,
      message: `vite major must be 8, found '${value}'`,
    });
    return out;
  }
  if (slot === 'peerDependencies' && value !== VITE_PEER_RANGE) {
    out.push({
      where: `${path} ${slot}.${key}`,
      message: `vite peer must be the caret range '${VITE_PEER_RANGE}', found '${value}'`,
    });
  }
  return out;
}

export function checkManifests(
  records: ManifestRecord[],
  options: ViteCheckOptions = {},
): ViteViolation[] {
  const routerVitePin = options.routerVitePin ?? VITE_DEV_PIN;
  const violations: ViteViolation[] = [];
  for (const record of records) {
    for (const [key, value] of Object.entries(record.imports ?? {})) {
      if (typeof value === 'string') {
        violations.push(
          ...viteSpecifierViolations(record.path, 'imports', key, value, routerVitePin),
        );
      }
    }
    for (const [key, value] of Object.entries(record.peerDependencies ?? {})) {
      if (typeof value === 'string') {
        violations.push(
          ...viteSpecifierViolations(record.path, 'peerDependencies', key, value, routerVitePin),
        );
      }
    }
    // The template must carry the pin, not merely avoid a forbidden one: with
    // no catalog to fall back on, a generated project without its own vite
    // devDependency cannot resolve the router's optional vite peer at all.
    if (record.path.endsWith('.tmpl') && record.imports?.['vite'] === undefined) {
      violations.push({
        where: `${record.path} imports.vite`,
        message:
          `the starter template must declare vite directly at the router's own version ` +
          `('${routerVitePin}'); the Vite+ catalog is retired and the generated project ` +
          `has no other source for its vite tree`,
      });
    }
  }
  return violations;
}

export function checkLockfileVite(specifiers: Record<string, string>): ViteViolation[] {
  const violations: ViteViolation[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(specifiers)) {
    const match = key.match(/^npm:vite@(\^|~)?(\d+)\.(\d+)\.(\d+)/);
    if (!match) continue;
    if (Number(match[2]) !== 8) {
      violations.push({ where: `pnpm-lock.yaml ${key}`, message: 'lockfile vite major must be 8' });
    }
    seen.add(specifiers[key]);
  }
  if (seen.size > 1) {
    violations.push({
      where: 'pnpm-lock.yaml',
      message: `lockfile resolves vite to multiple instances: ${[...seen].sort().join(', ')}`,
    });
  }
  return violations;
}

const BUNDLER_IMPORT_RE = /from\s+['"]npm:(esbuild|rollup)\b|from\s+['"]rolldown-vite['"/]/;

export function checkBundlerImports(files: { path: string; text: string }[]): ViteViolation[] {
  const violations: ViteViolation[] = [];
  for (const file of files) {
    if (BUNDLER_IMPORT_RE.test(file.text)) {
      violations.push({
        where: file.path,
        message:
          'second first-party bundler orchestration is retired; build through the single Router Vite plugin',
      });
    }
  }
  return violations;
}

/** Normalized dependency record: package.json values restated in the
 * `npm:<name>@<spec>` shape the specifier checks consume. */
function manifestRecordFromPackageJson(
  path: string,
  manifest: Record<string, unknown>,
): ManifestRecord {
  const imports: Record<string, string> = {};
  for (const source of ['dependencies', 'devDependencies'] as const) {
    for (const [name, value] of Object.entries(
      (manifest[source] as Record<string, string> | undefined) ?? {},
    )) {
      if (name === 'vite' && typeof value === 'string' && !value.startsWith('npm:')) {
        imports[name] = `npm:vite@${value}`;
      } else if (typeof value === 'string') {
        imports[name] = value;
      }
    }
  }
  const peerDependencies: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    (manifest.peerDependencies as Record<string, string> | undefined) ?? {},
  )) {
    if (name === 'vite' && typeof value === 'string' && !value.startsWith('npm:')) {
      peerDependencies[name] = `npm:vite@${value}`;
    } else if (typeof value === 'string') {
      peerDependencies[name] = value;
    }
  }
  return { path, imports, peerDependencies };
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function expandManifestPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (const pattern of MANIFEST_GLOB_ROOTS) {
    if (!pattern.includes('*')) {
      paths.push(pattern);
      continue;
    }
    const [dir, file] = pattern.split('/*/');
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = `${dir}/${entry.name}/${file}`;
        try {
          await stat(candidate);
          paths.push(candidate);
        } catch {
          // fixture/example without its own manifest resolves the root config
        }
      }
    } catch {
      // missing root
    }
  }
  return paths;
}

async function collectBuildSources(): Promise<{ path: string; text: string }[]> {
  const roots = [
    'packages/protocol/src',
    'packages/element/src',
    'packages/compiler/src',
    'packages/router/src',
    'packages/create/src',
    'packages/ui/src',
    'tools/lib',
  ];
  const files: { path: string; text: string }[] = [];
  const visit = async (dir: string): Promise<void> => {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && (path.endsWith('.ts') || path.endsWith('.tsx'))) {
          files.push({ path, text: await readFile(path, 'utf8') });
        }
      }
    } catch {
      // optional root
    }
  };
  for (const root of roots) await visit(root);
  return files;
}

if (import.meta.main) {
  const failures: ViteViolation[] = [];
  const records: ManifestRecord[] = [];
  for (const path of await expandManifestPaths()) {
    if (path.endsWith('.tmpl')) {
      let text: string;
      let manifest: ManifestRecord;
      try {
        text = await readFile(path, 'utf8');
        manifest = JSON.parse(text) as ManifestRecord;
      } catch {
        failures.push({ where: path, message: 'manifest missing or unparseable' });
        continue;
      }
      // B5 (ADR-0161): the starter template is a package.json manifest — the
      // dependency slots normalize into the `npm:<name>@<spec>` shape the
      // specifier checks consume.
      records.push(
        manifestRecordFromPackageJson(path, manifest as unknown as Record<string, unknown>),
      );
      continue;
    }
    if (path.endsWith('package.json')) {
      const manifest = await readJsonFile<Record<string, unknown>>(path);
      if (!manifest) {
        failures.push({ where: path, message: 'manifest missing or unparseable' });
        continue;
      }
      records.push(manifestRecordFromPackageJson(path, manifest));
      continue;
    }
    failures.push({ where: path, message: 'unrecognized manifest path' });
  }
  // The router manifest is the authority for the template's pin: the scaffold
  // builds through the router's Vite plugin, so both must resolve one vite.
  // A router bump that leaves VITE_DEV_PIN (and therefore the template)
  // behind fails here instead of surfacing as a duplicate vite in a consumer.
  const routerManifest = await readJsonFile<Record<string, unknown>>(
    'packages/router/package.json',
  );
  const routerVite = (routerManifest?.dependencies as Record<string, string> | undefined)?.['vite'];
  if (routerVite !== VITE_DEV_PIN) {
    failures.push({
      where: 'packages/router/package.json dependencies.vite',
      message:
        `the router's own vite pin must be the exact version '${VITE_DEV_PIN}' ` +
        `(the version the starter template and VITE_DEV_PIN carry), found ` +
        `'${routerVite ?? '<missing>'}'`,
    });
  }
  // An inexact router pin cannot be the template's contract; fall back to the
  // constant so the template is still checked against the canonical version
  // (the failure above already reports the router side).
  const routerViteExactPin =
    typeof routerVite === 'string' && /^\d+\.\d+\.\d+/.test(routerVite) ? routerVite : VITE_DEV_PIN;
  failures.push(...checkManifests(records, { routerVitePin: routerViteExactPin }));
  // The single pnpm lock is the resolution truth; synthesize the specifier
  // record from its resolved package keys (every `vite@<version>` entry).
  const lockText = await readFile('pnpm-lock.yaml', 'utf8').catch(() => null);
  const resolved = new Set<string>();
  for (const match of lockText?.matchAll(/(?:^|\n) {2}'?vite@(\d+\.\d+\.\d+)/g) ?? []) {
    resolved.add(`npm:vite@${match[1]}`);
  }
  if (resolved.size === 0) {
    failures.push({ where: 'pnpm-lock.yaml', message: 'lockfile has no resolved vite package' });
  } else {
    failures.push(
      ...checkLockfileVite(Object.fromEntries([...resolved].map((key) => [key, 'resolved']))),
    );
  }
  failures.push(...checkBundlerImports(await collectBuildSources()));
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure.where}: ${failure.message}`);
    console.error(`${failures.length} vite-unification violation(s)`);
    process.exit(1);
  }
  console.log(
    `vite-unification ok (router + starter template pinned ${VITE_DEV_PIN}, peer ${VITE_PEER_RANGE})`,
  );
}
