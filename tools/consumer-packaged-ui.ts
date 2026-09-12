/** Packed UI consumer: fresh TypeScript project installs the UI tarball and typechecks. */
import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import ts from 'typescript';
import { PACKAGE_VERSION } from './project-constants.ts';
import { DECLARATION_LEAK_PATTERN } from './consumer-packaged-shared.ts';

const repoRoot = resolve(import.meta.dirname!, '..');
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const TYPES_TIMEOUT_MS = 5 * 60_000;

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await new Deno.Command(command, {
      args,
      cwd,
      env,
      stdout: 'piped',
      stderr: 'piped',
      signal: controller.signal,
    }).output();
    const decoder = new TextDecoder();
    const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
    if (timedOut) {
      return {
        success: false,
        output: `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n${output}`,
      };
    }
    return { success: result.success, output };
  } finally {
    clearTimeout(timeoutId);
  }
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
      `Missing packed release artifact: ${tarball} (run \`deno task pack:dry-run\` first)`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: 'openelement-packaged-ui-' });
try {
  Deno.writeTextFileSync(
    join(tmp, 'package.json'),
    formatJson({
      name: 'openelement-packed-ui-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/ui': `file:${uiTarball}`,
        '@openelement/element': `file:${elementTarball}`,
        'typescript': '6.0.3',
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
    const resolved = await Deno.realPath(join(tmp, 'node_modules', ...name.split('/')));
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
      throw new Error(`Packed UI consumer resolved ${name} into the repository: ${resolved}`);
    }
  }
  console.log('PASS packaged-ui boundary — no dependency resolves into the repository');

  Deno.writeTextFileSync(
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
  Deno.writeTextFileSync(
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
  const pkgJson = JSON.parse(Deno.readTextFileSync(join(uiDir, 'package.json')));
  const host = {
    fileExists: (name: string): boolean => {
      try {
        return Deno.statSync(name).isFile;
      } catch {
        return false;
      }
    },
    readFile: (name: string): string | undefined => {
      try {
        return Deno.readTextFileSync(name);
      } catch {
        return undefined;
      }
    },
  };
  const seen = new Set<string>();
  const problems: string[] = [];
  const walk = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = Deno.readTextFileSync(path);
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (DECLARATION_LEAK_PATTERN.test(fileName)) problems.push(`${path} -> ${fileName}`);
      const resolved = ts.resolveModuleName(fileName, path, {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      }, host).resolvedModule;
      if (!resolved) {
        problems.push(`${path} -> ${fileName} (unresolved)`);
        continue;
      }
      if (!/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) {
        problems.push(
          `${path} -> ${fileName} (resolves to ${resolved.resolvedFileName}; no packed .d.ts)`,
        );
        continue;
      }
      walk(resolved.resolvedFileName);
    }
  };
  for (const [subpath, conditions] of Object.entries(pkgJson.exports ?? {})) {
    const cond = conditions as Record<string, string>;
    const typesTarget = cond.types;
    if (typeof typesTarget !== 'string') {
      problems.push(`export '${subpath}' has no types condition`);
      continue;
    }
    walk(join(uiDir, typesTarget));
  }
  if (problems.length > 0) {
    throw new Error(`Packed @openelement/ui declaration graph violations:\n${problems.join('\n')}`);
  }
  console.log(`PASS packaged-ui declarations — ${seen.size} declaration modules resolved clean`);
} finally {
  await Deno.remove(tmp, { recursive: true });
}
