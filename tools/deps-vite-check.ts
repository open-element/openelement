/**
 * Fail-closed Vite unification gate (1.0 Alpha baseline).
 *
 * The repository runs exactly one Vite major (8): workspace development and
 * the root lockfile pin a single patch, publishable packages declare a
 * caret peer range, and no legacy path may reappear:
 *
 * - no Vite 7 (or any non-8 major) in any tracked manifest or lockfile
 * - no `rolldown-vite` transitional specifier
 * - no `@openelement/adapter-vite` legacy adapter in any manifest
 * - no `@rollup/plugin-terser` (no independent value over Vite 8/Rolldown)
 * - no second first-party bundler orchestration (`npm:esbuild`, `npm:rollup`,
 *   `rolldown-vite` imports in first-party build sources; the WTR browser
 *   test host is exempt — it serves tests, it does not build products)
 *
 * Usage: deno run --allow-read tools/deps-vite-check.ts
 */

export const VITE_DEV_PIN = '8.0.16';
export const VITE_PEER_RANGE = 'npm:vite@^8.0.0';

const MANIFEST_GLOB_ROOTS = [
  'deno.json',
  'packages/*/deno.json',
  'apps/site/deno.json',
  'apps/saas/deno.json',
  'fixtures/*/deno.json',
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

export function checkManifests(records: ManifestRecord[]): ViteViolation[] {
  const violations: ViteViolation[] = [];
  for (const record of records) {
    for (const [key, value] of Object.entries(record.imports ?? {})) {
      if (typeof value === 'string') {
        violations.push(...viteSpecifierViolations(record.path, 'imports', key, value));
      }
    }
    for (const [key, value] of Object.entries(record.peerDependencies ?? {})) {
      if (typeof value === 'string') {
        violations.push(...viteSpecifierViolations(record.path, 'peerDependencies', key, value));
      }
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
      violations.push({ where: `deno.lock ${key}`, message: 'lockfile vite major must be 8' });
    }
    seen.add(specifiers[key]);
  }
  if (seen.size > 1) {
    violations.push({
      where: 'deno.lock',
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

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
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
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isDirectory) continue;
        const candidate = `${dir}/${entry.name}/${file}`;
        try {
          await Deno.stat(candidate);
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
    'packages/element/src',
    'packages/router/src',
    'packages/create/src',
    'packages/ui/src',
    'tools/lib',
  ];
  const files: { path: string; text: string }[] = [];
  const visit = async (dir: string): Promise<void> => {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) await visit(path);
        else if (entry.isFile && (path.endsWith('.ts') || path.endsWith('.tsx'))) {
          files.push({ path, text: await Deno.readTextFile(path) });
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
    const manifest = await readJsonFile<ManifestRecord>(path);
    if (!manifest) {
      failures.push({ where: path, message: 'manifest missing or unparseable' });
      continue;
    }
    records.push({ path, imports: manifest.imports, peerDependencies: manifest.peerDependencies });
  }
  failures.push(...checkManifests(records));
  const lockfile = await readJsonFile<{ specifiers?: Record<string, string> }>('deno.lock');
  if (!lockfile?.specifiers) {
    failures.push({ where: 'deno.lock', message: 'lockfile missing specifiers' });
  } else failures.push(...checkLockfileVite(lockfile.specifiers));
  failures.push(...checkBundlerImports(await collectBuildSources()));
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure.where}: ${failure.message}`);
    console.error(`${failures.length} vite-unification violation(s)`);
    Deno.exit(1);
  }
  console.log(`vite-unification ok (dev ${VITE_DEV_PIN}, peer ${VITE_PEER_RANGE})`);
}
