/**
 * npm package manifest assembly for packed workspaces.
 *
 * Owns the approved post-pack manifest mutations (metadata, dependency and
 * peer derivation, Create bin) and their proof: only the allowlisted fields
 * may differ from the raw `deno pack` output, and every other file must stay
 * byte-identical. Pure enough to test without packing.
 */

import { sha256Hex } from '../lib/deterministic-tar.ts';
import { extractOpenImports, type PackageInfo } from '../lib/package-graph.ts';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';

const REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/open-element/openelement.git',
};

const KEYWORDS = ['openelement', 'web-components', 'ssg', 'framework', 'deno'];
const PACKAGE_KEYWORDS: Record<string, string[]> = {
  '@openelement/ui': [...KEYWORDS, 'experimental'],
};
const HOMEPAGE = 'https://openelement.org';
const BUGS = 'https://github.com/open-element/openelement/issues';
const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  '@openelement/router':
    'Routing, application runtime, and lifecycle tooling for the OpenElement framework.',
  '@openelement/create': 'Project generator for the OpenElement Web Components framework.',
  '@openelement/element': 'Custom element base class and authoring APIs for OpenElement.',
  '@openelement/ui':
    'Experimental reference Web Components and UI primitives built on the OpenElement runtime.',
};

const CREATE_BIN = {
  'openelement-create': './src/cli.js',
  'create-openelement': './src/cli.js',
};

/**
 * The only `package.json` fields the coordinator may change after `deno pack`.
 * Everything else (name, version, exports, ...) must be byte-identical; the
 * proof is enforced by assertOnlyApprovedManifestChanges at pack time and
 * documented in docs/maintainers/pack-post-processing.md.
 */
export const APPROVED_MANIFEST_MUTATIONS: ReadonlySet<string> = new Set([
  'type',
  'repository',
  'homepage',
  'bugs',
  'license',
  'description',
  'keywords',
  'bin',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
]);

/** Sorted package-relative path -> SHA-256 for every file under `root`. */
export async function hashFileTree(root: string): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of Deno.readDirSync(dir)) {
      const diskPath = `${dir}/${entry.name}`;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await visit(diskPath, path);
      } else if (entry.isFile) {
        manifest[path] = await sha256Hex(Deno.readFileSync(diskPath));
      }
    }
  };
  await visit(root, '');
  const sorted: Record<string, string> = {};
  for (const path of Object.keys(manifest).sort()) sorted[path] = manifest[path];
  return sorted;
}

/**
 * Post-pack proof for the coordinator's manifest mutations:
 *   1. every file except package/package.json is content-identical;
 *   2. only APPROVED_MANIFEST_MUTATIONS fields changed in the manifest.
 * JS, declarations, source maps, and the exports map can never drift here.
 */
export function assertOnlyApprovedManifestChanges(
  rawManifest: Record<string, string>,
  finalManifest: Record<string, string>,
  rawPackageJson: Record<string, unknown>,
  finalPackageJson: Record<string, unknown>,
): void {
  const rawPaths = Object.keys(rawManifest).sort();
  const finalPaths = Object.keys(finalManifest).sort();
  if (rawPaths.join('\n') !== finalPaths.join('\n')) {
    throw new Error(
      '[npm] repack changed the packed file set (failing closed):\n' +
        `raw: ${rawPaths.join(', ')}\nfinal: ${finalPaths.join(', ')}`,
    );
  }
  for (const path of rawPaths) {
    if (path === 'package/package.json') continue;
    if (rawManifest[path] !== finalManifest[path]) {
      throw new Error(
        `[npm] repack modified '${path}' content (failing closed); ` +
          'only package.json metadata may change after deno pack.',
      );
    }
  }
  const changed = new Set<string>();
  for (
    const key of new Set([...Object.keys(rawPackageJson), ...Object.keys(finalPackageJson)])
  ) {
    if (JSON.stringify(rawPackageJson[key]) !== JSON.stringify(finalPackageJson[key])) {
      changed.add(key);
    }
  }
  const unapproved = [...changed].filter((key) => !APPROVED_MANIFEST_MUTATIONS.has(key));
  if (unapproved.length > 0) {
    throw new Error(
      `[npm] repack changed unapproved manifest fields (failing closed): ${unapproved.join(', ')}`,
    );
  }
}

export function packageBinArchivePaths(pkgJson: Record<string, unknown>): string[] {
  const bin = pkgJson.bin;
  if (typeof bin === 'string') {
    return [`package/${bin.replace(/^\.\//, '')}`];
  }
  if (bin && typeof bin === 'object') {
    return Object.values(bin as Record<string, unknown>)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => `package/${value.replace(/^\.\//, '')}`);
  }
  return [];
}

export interface DeriveDepsIo {
  readPkgJson: (dir: string) => { imports?: Record<string, string> };
  readRootJson: () => { imports?: Record<string, string> };
  readSrcFiles: (dir: string) => string[];
}

const defaultDeriveDepsIo: DeriveDepsIo = {
  readPkgJson: (dir) => JSON.parse(Deno.readTextFileSync(`${dir}/deno.json`)),
  readRootJson: () => JSON.parse(Deno.readTextFileSync('deno.json')),
  readSrcFiles: (dir) => {
    const files: string[] = [];
    const scan = (d: string): void => {
      for (const entry of Deno.readDirSync(d)) {
        const path = `${d}/${entry.name}`;
        if (entry.isDirectory) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          scan(path);
        } else if (
          entry.isFile &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        ) {
          files.push(Deno.readTextFileSync(path));
        }
      }
    };
    try {
      scan(`${dir}/src`);
    } catch {
      // no src dir
    }
    return files;
  },
};

export function parseNpmSpec(
  value: string,
  label: string,
): { name: string; version: string } | null {
  const match = value.match(
    /^npm:(@[^/]+\/[^@/]+|[^@/]+)(?:@(\^?[\d.]+(?:-[\w.]+)?))?/,
  );
  if (!match) return null;
  const name = match[1];
  const version = match[2]?.replace(/^\^/, '');
  if (!version) {
    throw new Error(
      `npm dependency '${name}' (${label}) has no version; add an explicit version.`,
    );
  }
  return { name, version };
}

/**
 * Published dependency range for an external npm dep. The OE-maintained
 * matching fork is consumed as an exact qualified version only (#1324 —
 * consumers must not float past the qualified artifact); every other
 * external dep keeps the caret policy.
 */
export function publishRange(spec: { name: string; version: string }): string {
  return spec.name === '@openelement/url-pattern-list' ||
      spec.name === 'typescript'
    ? spec.version
    : `^${spec.version}`;
}

export function deriveDependencies(
  pkg: PackageInfo,
  allPackages: PackageInfo[],
  io: DeriveDepsIo = defaultDeriveDepsIo,
  rootImports: Record<string, string> = io.readRootJson().imports ?? {},
): Record<string, string> {
  const deps: Record<string, string> = {};
  const denoJson = io.readPkgJson(pkg.dir);
  const imports = denoJson.imports ?? {};
  const sourceSpecifiers = new Set<string>();
  const byName = new Map(allPackages.map((p) => [p.name, p]));

  // External npm dependencies from deno.json imports. Workspace members are
  // resolved internally (source-import loop below), never as external npm
  // deps; the maintained url-pattern-list fork shares the @openelement scope
  // but is published outside the workspace, so it lands here exactly (#1324).
  for (const [key, value] of Object.entries(imports)) {
    if (typeof value !== 'string') continue;
    const spec = parseNpmSpec(value, `${pkg.name} deno.json`);
    if (!spec || byName.has(spec.name)) continue;
    deps[dependencyKey(key, spec)] = dependencyRange(key, spec);
  }

  // Internal workspace dependencies from source imports.
  for (const text of io.readSrcFiles(pkg.dir)) {
    for (const { value } of extractStaticModuleSpecifiers(text)) {
      sourceSpecifiers.add(value);
    }
    for (const specifier of extractOpenImports(text)) {
      const prefix = '@openelement/';
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      const base = slashIdx === -1 ? specifier : prefix + rest.slice(0, slashIdx);
      if (base === pkg.name) continue;
      const depPkg = byName.get(base);
      if (depPkg) deps[base] = depPkg.version;
    }
  }

  // Workspace packages inherit the root import map. npm package.json files do
  // not, so every root-mapped bare specifier used by package source must be
  // materialized as a dependency in the packed artifact. This includes
  // `@preact/signals-core`: it is the current sole signal implementation and
  // stays in `dependencies` (replaceable in the future — product source never
  // imports it directly, see tools/repo/check-signal-protocol-boundary.ts).
  for (const specifier of sourceSpecifiers) {
    const value = rootImports[specifier];
    if (typeof value !== 'string') continue;
    const spec = parseNpmSpec(value, `${pkg.name} root import`);
    if (spec) {
      deps[dependencyKey(specifier, spec)] = dependencyRange(specifier, spec);
    }
  }

  return deps;
}

// Import-map aliases keep their bare key in emitted source, so packed
// artifacts retain that key. Direct package names (such as TypeScript) need
// no alias and are installed under their published name.
function dependencyKey(
  key: string,
  spec: { name: string },
): string {
  return !key.includes(':') && key !== spec.name ? key : spec.name;
}

function dependencyRange(
  key: string,
  spec: { name: string; version: string },
): string {
  return !key.includes(':') && key !== spec.name
    ? `npm:${spec.name}@${publishRange(spec)}`
    : publishRange(spec);
}

export function deriveAllDependencies(
  packages: PackageInfo[],
  io: DeriveDepsIo = defaultDeriveDepsIo,
): Map<string, Record<string, string>> {
  const rootImports = io.readRootJson().imports ?? {};
  return new Map(
    packages.map((
      pkg,
    ) => [pkg.name, deriveDependencies(pkg, packages, io, rootImports)]),
  );
}

export function applyPackageJsonOverrides(
  pkg: PackageInfo,
  pkgJson: Record<string, unknown>,
): void {
  pkgJson.type = 'module';
  pkgJson.repository = REPOSITORY;
  pkgJson.homepage = HOMEPAGE;
  pkgJson.bugs = BUGS;
  pkgJson.license = 'MIT';
  pkgJson.description = PACKAGE_DESCRIPTIONS[pkg.name];
  pkgJson.keywords = PACKAGE_KEYWORDS[pkg.name] ?? KEYWORDS;
  if (pkg.name === '@openelement/create') {
    pkgJson.bin = CREATE_BIN;
  }
}
