/** Packed Element author -> Vite compile -> separate plain-HTML browser proof (#1338). */
import { tmpdir } from 'node:os';
import { commandOutput } from '../repo/node-command.ts';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import ts from 'typescript';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import { walkPackedDeclarations } from './consumer-packaged-shared.ts';
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
        // The compiler split (#1557): the standalone vite plugin entry lives in
        // the compiler package, so the authoring proof installs both tarballs.
        '@openelement/compiler': `file:${root}/packages/compiler/openelement-compiler-${PACKAGE_VERSION}.tgz`,
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
    `import {element} from '@openelement/compiler/vite';
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
  // Follow local and external declaration edges from the browser entry through
  // the shared packed-declaration walker, rather than rejecting separate
  // supported tooling declarations elsewhere in the package: every specifier
  // is leak-scanned and every type-bearing edge must resolve to a packed
  // declaration (side-effect-only imports carry no type surface and stay out
  // of the resolution walk, exactly as in the router/ui legs).
  const declarationWalk = walkPackedDeclarations({
    entries: [join(author, 'node_modules/@openelement/element/src/index.d.ts')],
  });
  if (declarationWalk.problems.length > 0) {
    throw new Error(
      `Packed element declaration graph violations:\n${declarationWalk.problems.join('\n')}`,
    );
  }
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
  // Qualification server on node:http via the shared fetch adapter.
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
        assert.strictEqual(await button.textContent(), 'Count: 0');
        assert.strictEqual(await button.getAttribute('title'), '0');
        await button.click();
        await page.waitForFunction('document.querySelector("proof-counter").count === 1');
        assert.strictEqual(await button.textContent(), 'Count: 1');
        assert.strictEqual(await button.getAttribute('title'), '1');
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
    `PASS: Router absent, browser module graph clean, ${declarationWalk.modules} declaration modules checked, source map retained`,
  );
} finally {
  await rm(author, { recursive: true });
  await rm(consumer, { recursive: true });
}
