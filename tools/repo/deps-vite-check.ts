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
 *
 * Usage: node tools/repo/deps-vite-check.ts (pnpm --dir tools/repo run deps:vite-check)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import process from 'node:process';

export const VITE_DEV_PIN = '8.0.16';
export const VITE_PEER_RANGE = 'npm:vite@^8.0.0';

const MANIFEST_GLOB_ROOTS = [
  'package.json',
  'packages/*/package.json',
  'www/package.json',
  'apps/saas/package.json',
  'tests/fixtures/*/package.json',
  'tests/e2e/starter-smoke/package.json',
  // The starter template ships to every new user; its vite entries must
  // inject the canonical pin through the ${v.vite} scaffold token (B5: the
  // token lives in devDependencies of package.json.tmpl, ADR-0161).
  'packages/create/templates/package.json.tmpl',
];

/** Scaffold token form the starter template must use for every vite specifier. */
const VITE_TEMPLATE_TOKEN = 'npm:vite@${v.vite}';

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
  if (path.endsWith('.tmpl')) {
    // Templates inject the canonical pin through the ${v.vite} scaffold
    // token; a literal pin here would ship an unguarded second source.
    if (value !== VITE_TEMPLATE_TOKEN) {
      out.push({
        where: `${path} ${slot}.${key}`,
        message: `template vite specifier must be the '${VITE_TEMPLATE_TOKEN}' token (canonical pin: ${VITE_DEV_PIN})`,
      });
    }
    return out;
  }
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

/**
 * The starter template's raw text must carry no literal vite pin anywhere
 * (the manifest and its script commands): every occurrence goes through the
 * ${v.vite} token fed by the embedded VITE_STARTER_PIN.
 */
export function checkTemplateViteText(path: string, text: string): ViteViolation[] {
  if (!path.endsWith('.tmpl')) return [];
  return /npm:vite@\d/.test(text)
    ? [
        {
          where: path,
          message: `literal vite pin in template; use the '${VITE_TEMPLATE_TOKEN}' token`,
        },
      ]
    : [];
}

/**
 * Anchor the create CLI's embedded VITE_STARTER_PIN to the canonical dev pin
 * (same pattern as the CREATE_VERSION anchor in check-package-graph): the
 * packed CLI cannot import workspace tooling, so the copy is asserted here.
 */
export function checkStarterVitePin(versionSource: string): ViteViolation[] {
  const match = versionSource.match(/VITE_STARTER_PIN = '([^']+)'/u);
  if (!match) {
    return [
      {
        where: 'packages/create/src/version.ts',
        message: 'VITE_STARTER_PIN anchor missing',
      },
    ];
  }
  if (match[1] !== VITE_DEV_PIN) {
    return [
      {
        where: 'packages/create/src/version.ts',
        message: `VITE_STARTER_PIN ${
          match[1]
        } does not match canonical VITE_DEV_PIN ${VITE_DEV_PIN}`,
      },
    ];
  }
  return [];
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
    'packages/element/src',
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
      failures.push(...checkTemplateViteText(path, text));
      // B5 (ADR-0161): the starter template is a package.json manifest — the
      // dependency slots normalize into the `npm:<name>@<spec>` shape the
      // specifier checks consume (devDependencies.vite '${v.vite}' becomes
      // the canonical token form).
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
    const manifest = await readJsonFile<ManifestRecord>(path);
    if (!manifest) {
      failures.push({ where: path, message: 'manifest missing or unparseable' });
      continue;
    }
    records.push({ path, imports: manifest.imports, peerDependencies: manifest.peerDependencies });
  }
  failures.push(...checkManifests(records));
  failures.push(...checkStarterVitePin(await readFile('packages/create/src/version.ts', 'utf8')));
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
  console.log(`vite-unification ok (dev ${VITE_DEV_PIN}, peer ${VITE_PEER_RANGE})`);
}
