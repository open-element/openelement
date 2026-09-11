/** Packed Element author -> Vite compile -> separate plain-HTML browser proof (#1338). */
import { assert, assertEquals } from '@std/assert';
import { join, resolve } from '@std/path';
import { chromium, firefox, webkit } from '@playwright/test';
import ts from 'typescript';
import { PACKAGE_VERSION } from './project-constants.ts';

const root = resolve(import.meta.dirname!, '..');
const author = await Deno.makeTempDir({ prefix: 'oe-element-author-' });
const consumer = await Deno.makeTempDir({ prefix: 'oe-element-html-' });
async function run(args: string[]): Promise<void> {
  const output = await new Deno.Command(args[0], {
    args: args.slice(1),
    cwd: author,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (!output.success) {
    throw new Error(
      new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr),
    );
  }
}
try {
  await Deno.writeTextFile(
    join(author, 'package.json'),
    JSON.stringify({
      name: 'oe-standalone-author-proof',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/element':
          `file:${root}/packages/element/openelement-element-${PACKAGE_VERSION}.tgz`,
      },
      devDependencies: {
        vite: '8.0.16',
      },
    }),
  );
  await Deno.writeTextFile(
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
  await Deno.writeTextFile(
    join(author, 'register.js'),
    `import {Counter} from './counter.tsx'; customElements.define('proof-counter',Counter);`,
  );
  await Deno.writeTextFile(
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
    !await Deno.stat(join(author, 'node_modules/@openelement/router')).then(
      () => true,
      () => false,
    ),
    'Router must not be installed',
  );
  await run(['node', 'node_modules/vite/bin/vite.js', 'build']);
  // Follow local and external declaration edges from the browser entry, rather than
  // rejecting separate supported tooling declarations elsewhere in the package.
  const seen = new Set<string>();
  const declarations = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = await Deno.readTextFile(path);
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      assert(
        !/compiler|router\/src\/(?:vite|cli)|\bvite\b|^node:|workspace:/.test(fileName),
        `Browser declaration leak: ${path} -> ${fileName}`,
      );
      const resolved = ts.resolveModuleName(fileName, path, {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      }, {
        fileExists: (name) => {
          try {
            return Deno.statSync(name).isFile;
          } catch {
            return false;
          }
        },
        readFile: (name) => {
          try {
            return Deno.readTextFileSync(name);
          } catch {
            return undefined;
          }
        },
      }).resolvedModule;
      assert(resolved, `Unresolved browser declaration: ${path} -> ${fileName}`);
      await declarations(resolved.resolvedFileName);
    }
  };
  await declarations(join(author, 'node_modules/@openelement/element/src/index.d.ts'));
  const map = JSON.parse(await Deno.readTextFile(join(author, 'dist/counter.js.map')));
  assert(
    map.sources.some((s: string) => s.endsWith('counter.tsx')),
    'authored source map must survive',
  );
  const js = await Deno.readTextFile(join(author, 'dist/counter.js'));
  assert(
    ts.preProcessFile(js).importedFiles.every(({ fileName }) =>
      !/workspace:|@openelement\/router\/(?:vite|cli)|^node:/.test(fileName)
    ),
    'compiled browser artifact boundary',
  );
  await Deno.writeTextFile(join(consumer, 'counter.js'), js);
  await Deno.writeTextFile(
    join(consumer, 'index.html'),
    '<!doctype html><proof-counter></proof-counter><script type="module" src="/counter.js"></script>',
  );
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async (request) => {
    const script = new URL(request.url).pathname === '/counter.js';
    return new Response(
      await Deno.readTextFile(join(consumer, script ? 'counter.js' : 'index.html')),
      { headers: { 'content-type': script ? 'text/javascript' : 'text/html' } },
    );
  });
  try {
    for (const type of [chromium, firefox, webkit]) {
      const browser = await type.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.addr.port}`);
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
    await server.shutdown();
  }
  console.log(
    `PASS: Router absent, browser module graph clean, ${seen.size} declaration modules checked, source map retained`,
  );
} finally {
  await Deno.remove(author, { recursive: true });
  await Deno.remove(consumer, { recursive: true });
}
