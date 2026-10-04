/** Packed UI consumer: fresh TypeScript project installs the UI tarball and typechecks. */
import { tmpdir } from 'node:os';
import { runProcess, walkPackedDeclarations } from './consumer-packaged-shared.ts';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';

const repoRoot = resolve(import.meta.dirname!, '../..');
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const TYPES_TIMEOUT_MS = 5 * 60_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  return runProcess(command, args, cwd, { timeoutMs, env });
}

const uiTarball = join(repoRoot, 'packages', 'ui', `openelement-ui-${PACKAGE_VERSION}.tgz`);
const elementTarball = join(
  repoRoot,
  'packages',
  'element',
  `openelement-element-${PACKAGE_VERSION}.tgz`,
);
for (const tarball of [uiTarball, elementTarball]) {
  if (!existsSync(tarball)) {
    throw new Error(
      `Missing packed release artifact: ${tarball} (run \`pnpm --dir tools/release run pack:dry-run\` first)`,
    );
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'openelement-packaged-ui-'));
try {
  writeFileSync(
    join(tmp, 'package.json'),
    formatJson({
      name: 'openelement-packed-ui-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/ui': `file:${uiTarball}`,
        '@openelement/element': `file:${elementTarball}`,
        typescript: '6.0.3',
      },
    }),
  );
  const install = await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    tmp,
    { NPM_CONFIG_CACHE: join(tmp, '.npm-cache') },
    INSTALL_TIMEOUT_MS,
  );
  if (!install.success) throw new Error(`Packed UI installation failed:\n${install.output}`);
  console.log(
    'PASS packaged-ui install — UI + element tarballs installed under an empty npm cache',
  );

  for (const name of ['@openelement/ui', '@openelement/element']) {
    const resolved = await realpath(join(tmp, 'node_modules', ...name.split('/')));
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
      throw new Error(`Packed UI consumer resolved ${name} into the repository: ${resolved}`);
    }
  }
  console.log('PASS packaged-ui boundary — no dependency resolves into the repository');

  writeFileSync(
    join(tmp, 'main.ts'),
    `import { OpenButton, OpenCallout, OpenInput, manifest, registerOpenUi } from '@openelement/ui';
import { OpenDropdown } from '@openelement/ui/open-dropdown';
import { createLogger, type Logger, type ReadonlySignal } from '@openelement/element';

const log: Logger = createLogger('consumer');
log.info('ui consumer booted');

const label: ReadonlySignal<string> = null as unknown as ReadonlySignal<string>;
void label;

registerOpenUi();
const button = new OpenButton();
button.variant = 'primary';
const input = new OpenInput();
input.label = 'Name';
const callout = new OpenCallout();
callout.type = 'info';
const dropdown = new OpenDropdown();
dropdown.anchorName = 'menu';
void [button, input, callout, dropdown];
if (manifest.packageName !== '@openelement/ui') throw new Error('unexpected UI manifest');
`,
  );
  writeFileSync(
    join(tmp, 'tsconfig.json'),
    formatJson({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: [],
      },
      include: ['./main.ts'],
    }),
  );
  const types = await run(
    'node',
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
    tmp,
    {},
    TYPES_TIMEOUT_MS,
  );
  if (!types.success) throw new Error(`Packed UI consumer typecheck failed:\n${types.output}`);
  console.log(
    'PASS packaged-ui types — fresh TypeScript consumer typechecks against the packed UI declarations',
  );

  const uiDir = join(tmp, 'node_modules', '@openelement', 'ui');
  const pkgJson = JSON.parse(readFileSync(join(uiDir, 'package.json'), 'utf8'));
  const problems: string[] = [];
  const entryPaths: string[] = [];
  for (const [subpath, conditions] of Object.entries(pkgJson.exports ?? {})) {
    const cond = conditions as Record<string, string>;
    const typesTarget = cond.types;
    if (typeof typesTarget !== 'string') {
      problems.push(`export '${subpath}' has no types condition`);
      continue;
    }
    entryPaths.push(join(uiDir, typesTarget));
  }
  // The shared packed-declaration walker: leak scan over every specifier,
  // resolution over type-bearing edges only (same semantics as the router and
  // element legs).
  const { modules, problems: walkProblems } = walkPackedDeclarations({ entries: entryPaths });
  problems.push(...walkProblems);
  if (problems.length > 0) {
    throw new Error(`Packed @openelement/ui declaration graph violations:\n${problems.join('\n')}`);
  }
  console.log(`PASS packaged-ui declarations — ${modules} declaration modules resolved clean`);
} finally {
  await rm(tmp, { recursive: true });
}
