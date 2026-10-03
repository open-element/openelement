/** Packed Element author -> Vite compile -> separate plain-HTML browser proof (#1338). */
import { tmpdir } from 'node:os';
import { commandOutput } from '../repo/node-command.ts';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { assert, assertEquals } from '@std/assert';
import { join, resolve } from '@std/path';
import { chromium, firefox, webkit } from '@playwright/test';
import ts from 'typescript';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import { declarationTypeEdges } from './consumer-packaged-shared.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';

const root = resolve(import.meta.dirname!, '../..');
const author = await mkdtemp(join(tmpdir(), 'oe-element-author-'));
const consumer = await mkdtemp(join(tmpdir(), 'oe-element-html-'));
async function run(args: string[]): Promise<void> {
  const output = await commandOutput(args[0], {
    args: args.slice(1),
    cwd: author,
    stdout: 'piped',
    stderr: 'piped',
  });
  if (!output.success) {
    throw new Error(
      new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr),
    );
  }
}
try {
  await writeFile(
    join(author, 'package.json'),
    JSON.stringify({
      name: 'oe-standalone-author-proof',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/element': `file:${root}/packages/element/openelement-element-${PACKAGE_VERSION}.tgz`,
      },
      devDependencies: {
        vite: VITE_DEV_PIN,
      },
    }),
  );
  await writeFile(
    join(author, 'counter.tsx'),
    `import {element,property,OpenElement} from '@openelement/element';
@element('proof-counter')
export class Counter extends OpenElement {
  @property({reflect:true}) count = 0;
  increment() { this.count++; }
  render() { return <button title={this.count} onClick={this.increment}>Count: {this.count}</button>; }
}
`,
  );
  await writeFile(
    join(author, 'register.js'),
    `import {Counter} from './counter.tsx'; customElements.define('proof-counter',Counter);`,
  );
  await writeFile(
    join(author, 'vite.config.js'),
    `import {element} from '@openelement/element/vite';
export default {plugins:[element(), {name:'proof-module-boundary',generateBundle(){for(const id of this.getModuleIds()){if(/compiler|router\\/src\\/(?:vite|cli)|node:/.test(id))this.error('Browser tooling leak: '+id)}}}],build:{sourcemap:true,lib:{entry:'register.js',formats:['es'],fileName:'counter'}}};`,
  );
  await run([
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--fetch-retries=1',
    '--fetch-timeout=30000',
  ]);
  assert(
    !(await stat(join(author, 'node_modules/@openelement/router')).then(
      () => true,
      () => false,
    )),
    'Router must not be installed',
  );
  await run(['node', 'node_modules/vite/bin/vite.js', 'build']);
  // Follow local and external declaration edges from the browser entry, rather than
  // rejecting separate supported tooling declarations elsewhere in the package.
  const seen = new Set<string>();
  const declarations = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = await readFile(path, 'utf8');
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      assert(
        !/compiler|router\/src\/(?:vite|cli)|\bvite\b|^node:|workspace:/.test(fileName),
        `Browser declaration leak: ${path} -> ${fileName}`,
      );
    }
    // Resolution follows type-bearing edges only (see declarationTypeEdges in
    // consumer-packaged-shared.ts): the vp generator emits side-effect-only
    // imports into .d.ts that the previous generator dropped, and they carry
    // no consumer type surface.
    for (const fileName of declarationTypeEdges(text)) {
      const resolved = ts.resolveModuleName(
        fileName,
        path,
        {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
        },
        {
          fileExists: (name) => {
            try {
              return statSync(name).isFile();
            } catch {
              return false;
            }
          },
          readFile: (name) => {
            try {
              return readFileSync(name, 'utf8');
            } catch {
              return undefined;
            }
          },
        },
      ).resolvedModule;
      assert(resolved, `Unresolved browser declaration: ${path} -> ${fileName}`);
      await declarations(resolved.resolvedFileName);
    }
  };
  await declarations(join(author, 'node_modules/@openelement/element/src/index.d.ts'));
  const map = JSON.parse(await readFile(join(author, 'dist/counter.js.map'), 'utf8'));
  assert(
    map.sources.some((s: string) => s.endsWith('counter.tsx')),
    'authored source map must survive',
  );
  const js = await readFile(join(author, 'dist/counter.js'), 'utf8');
  assert(
    ts
      .preProcessFile(js)
      .importedFiles.every(
        ({ fileName }) => !/workspace:|@openelement\/router\/(?:vite|cli)|^node:/.test(fileName),
      ),
    'compiled browser artifact boundary',
  );
  await writeFile(join(consumer, 'counter.js'), js);
  await writeFile(
    join(consumer, 'index.html'),
    '<!doctype html><proof-counter></proof-counter><script type="module" src="/counter.js"></script>',
  );
  // Qualification server on node:http via the shared fetch adapter
  // (the deno-host Deno.serve call retired with the B2 host move).
  let serverOrigin = '';
  const serve = await import('../../packages/router/src/internal/node-http.ts');
  const server: import('node:http').Server = serve.serveFetch({
    hostname: '127.0.0.1',
    port: 0,
    handler: async (request) => {
      const script = new URL(request.url).pathname === '/counter.js';
      return new Response(
        await readFile(join(consumer, script ? 'counter.js' : 'index.html'), 'utf8'),
        { headers: { 'content-type': script ? 'text/javascript' : 'text/html' } },
      );
    },
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  serverOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const type of [chromium, firefox, webkit]) {
      const browser = await type.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(serverOrigin);
        const button = page.locator('proof-counter button');
        await button.waitFor();
        assertEquals(await button.textContent(), 'Count: 0');
        assertEquals(await button.getAttribute('title'), '0');
        await button.click();
        await page.waitForFunction('document.querySelector("proof-counter").count === 1');
        assertEquals(await button.textContent(), 'Count: 1');
        assertEquals(await button.getAttribute('title'), '1');
        console.log(
          `PASS ${type.name()} ${browser.version()}: packed Element registration, attribute and event update`,
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server ? server.close((error) => (error ? reject(error) : resolve())) : resolve(),
    );
    server?.closeAllConnections();
  }
  console.log(
    `PASS: Router absent, browser module graph clean, ${seen.size} declaration modules checked, source map retained`,
  );
} finally {
  await rm(author, { recursive: true });
  await rm(consumer, { recursive: true });
}
