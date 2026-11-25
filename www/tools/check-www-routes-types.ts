/** Check all authored www/app sources, including islands outside the route graph. */
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import { spawnCommand } from '../../tools/repo/node-command.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const appDir = join(repoRoot, 'www/app');
const routesDir = join(appDir, 'routes');
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const trackedAndUnignored = await spawnCommand('git', {
  args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'www/app'],
  cwd: repoRoot,
  stdin: 'null',
  stdout: 'piped',
  stderr: 'inherit',
});
if (trackedAndUnignored.code !== 0) throw new Error('Could not enumerate www/app sources with Git');

const gitFiles = new Set(new TextDecoder().decode(trackedAndUnignored.stdout).split('\0'));
const files = new Set<string>();
for (const entry of await readdir(appDir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !sourceFile.test(entry.name)) continue;
  const file = relative(repoRoot, join(entry.parentPath, entry.name)).replaceAll(sep, '/');
  if (gitFiles.has(file)) files.add(file);
}

// Cross-check the application walk against the framework's route discovery.
const routes = (await scanRoutes(routesDir))
  .map((entry) => relative(repoRoot, join(routesDir, entry.filePath)).replaceAll(sep, '/'))
  .filter((file) => sourceFile.test(file));
if (routes.length === 0) throw new Error('www app typecheck found zero route modules');
for (const route of routes) {
  if (!files.has(route)) throw new Error(`www app typecheck omitted discovered route: ${route}`);
}

const check = await spawnCommand(process.execPath, {
  args: [
    join(repoRoot, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--allowJs',
    '--checkJs',
    '--allowImportingTsExtensions',
    '--strict',
    '--skipLibCheck',
    '--target',
    'es2023',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--lib',
    'es2023,dom,dom.iterable',
    '--jsx',
    'react-jsx',
    '--jsxImportSource',
    '@openelement/element',
    '--experimentalDecorators',
    '--noImplicitOverride',
    '--types',
    'node,@openelement/element/css-modules',
    ...[...files].sort(),
  ],
  cwd: repoRoot,
  stdin: 'null',
  stdout: 'piped',
  stderr: 'piped',
});
const decoder = new TextDecoder();
const output = decoder.decode(check.stdout) + decoder.decode(check.stderr);
process.stdout.write(output);
if (check.code !== 0) {
  if (/TS2307: Cannot find module '[^']*_generated-[^']+'/.test(output)) {
    console.error('Run `vp run generate:all` to materialize the required site modules.');
  }
  process.exit(1);
}
console.log(`www app typecheck ok: ${files.size} source modules (${routes.length} route modules)`);
