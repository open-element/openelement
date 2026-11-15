/** Packed Element author -> Vite compile -> separate plain-HTML browser proof (#1338). */
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import ts from 'typescript';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import {
  assertPackedTarballsFresh,
  assertAuthoredSourceMap,
  runConsumerOrThrow,
  walkPackedDeclarations,
} from './consumer-packaged-shared.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';

const root = resolve(import.meta.dirname!, '../..');
const elementTarball = join(
  root,
  'packages',
  'element',
  `openelement-element-${PACKAGE_VERSION}.tgz`,
);
const compilerTarball = join(
  root,
  'packages',
  'compiler',
  `openelement-compiler-${PACKAGE_VERSION}.tgz`,
);
const protocolTarball = join(
  root,
  'packages',
  'protocol',
  `openelement-protocol-${PACKAGE_VERSION}.tgz`,
);
await assertPackedTarballsFresh([elementTarball, compilerTarball, protocolTarball]);
const author = await mkdtemp(join(tmpdir(), 'oe-element-author-'));
const consumer = await mkdtemp(join(tmpdir(), 'oe-element-html-'));
try {
  await writeFile(
    join(author, 'package.json'),
    JSON.stringify({
      name: 'oe-standalone-author-proof',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/element': `file:${elementTarball}`,
        // The compiler split (#1557): the standalone vite plugin entry lives in
        // the compiler package, so the authoring proof installs both tarballs.
        '@openelement/compiler': `file:${compilerTarball}`,
        // element's own transitive workspace pin — declared directly so npm
        // dedupe resolves it from the local tarball pre-publish.
        '@openelement/protocol': `file:${protocolTarball}`,
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
  await runConsumerOrThrow(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=1',
      '--fetch-timeout=30000',
    ],
    author,
  );
  assert(
    !(await stat(join(author, 'node_modules/@openelement/router')).then(
      () => true,
      () => false,
    )),
    'Router must not be installed',
  );
  await runConsumerOrThrow('node', ['node_modules/vite/bin/vite.js', 'build'], author);
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

  // ---- M09-1b: the first packed generated Native Custom Element consumer ----
  //
  // The class-authored leg above proves the packed authoring path. This leg
  // proves the generated path end to end on the SAME installed tarballs: the
  // packed compiler's generated-element lane emits the CE tail for an
  // island-shaped module, the emitted module's
  // `@openelement/element/internal/compiled/generated-element/shell` specifier
  // resolves to the packed shell, and the class registers and upgrades in a
  // browser. No router is installed: the site fact is the host capability the
  // compiler plugin accepts, and the island policy statement carries the
  // statement shape the lane admits (the router-hosted form is pinned by
  // `packages/router/__tests__/generated-element-site.test.ts`).
  await writeFile(
    join(author, 'profile.tsx'),
    `// The island policy statement the generated lane admits. This project has no
// router, so the factory is local; the lane checks the statement shape
// (\`export const openElement = defineIslandConfig({ ... })\`), not the binding.
function defineIslandConfig(config) { return config; }
export const openElement = defineIslandConfig({ hydrate: 'only' });

function ProofProfile() {
  return <article id="proof-profile">generated native element</article>;
}
export default ProofProfile;
`,
  );
  await writeFile(
    join(author, 'register-generated.js'),
    `import ProofProfile from './profile.tsx'; customElements.define('proof-profile', ProofProfile);`,
  );
  await writeFile(
    join(author, 'vite.generated.config.js'),
    `import {element} from '@openelement/compiler/vite';
export default {
  plugins: [
    element({
      generatedElementSite: (moduleId) =>
        moduleId === 'profile.tsx' ? { tag: 'proof-profile', root: 'light' } : null,
    }),
    {name:'proof-generated-module-boundary',generateBundle(){for(const id of this.getModuleIds()){if(/compiler|router\\/src\\/(?:vite|cli)|node:/.test(id))this.error('Browser tooling leak: '+id)}}},
  ],
  build:{sourcemap:true,lib:{entry:'register-generated.js',formats:['es'],fileName:'generated'}},
};`,
  );
  await runConsumerOrThrow(
    'node',
    ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.generated.config.js'],
    author,
  );
  const packedShell = join(
    author,
    'node_modules/@openelement/element/src/internal/compiled/generated-element/shell.js',
  );
  assert(
    await stat(packedShell).then(
      () => true,
      () => false,
    ),
    'the packed Element tarball must ship the generated-element shell',
  );
  const generatedJs = await readFile(join(author, 'dist/generated.js'), 'utf8');
  assert(
    ts
      .preProcessFile(generatedJs)
      .importedFiles.every(
        ({ fileName }) =>
          !/workspace:|@openelement\/(?:router|compiler)\/(?:vite|cli)|^node:/.test(fileName),
      ),
    'generated browser artifact boundary',
  );
  await writeFile(join(consumer, 'generated.js'), generatedJs);
  await writeFile(
    join(consumer, 'generated.html'),
    '<!doctype html><proof-profile></proof-profile><script type="module" src="/generated.js"></script>',
  );

  // Qualification server on node:http via the shared fetch adapter.
  let serverOrigin = '';
  const serve = await import('../../packages/router/src/internal/node-http.ts');
  const server: import('node:http').Server = serve.serveFetch({
    hostname: '127.0.0.1',
    port: 0,
    handler: async (request) => {
      const path = new URL(request.url).pathname;
      const file =
        path === '/counter.js'
          ? 'counter.js'
          : path === '/generated.js'
            ? 'generated.js'
            : path === '/generated'
              ? 'generated.html'
              : path === '/shadow.js'
                ? 'shadow.js'
                : path === '/shadow.js.map'
                  ? 'shadow.js.map'
                  : path === '/shadow-s3'
                    ? 'shadow-s3.html'
                    : 'index.html';
      return new Response(await readFile(join(consumer, file), 'utf8'), {
        headers: {
          'content-type': /\.js$/.test(file)
            ? 'text/javascript'
            : /\.map$/.test(file)
              ? 'application/json'
              : 'text/html',
        },
      });
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
    // M09-1b is LOCAL evidence on one engine: the packed generated class
    // registers and upgrades from plain HTML. A multi-engine matrix is M13.
    const generatedBrowser = await chromium.launch({ headless: true });
    try {
      const page = await generatedBrowser.newPage();
      await page.goto(`${serverOrigin}/generated`);
      await page.locator('proof-profile #proof-profile').waitFor();
      assert.strictEqual(
        await page.locator('proof-profile').textContent(),
        'generated native element',
      );
      assert.strictEqual(
        await page.evaluate(() => typeof (customElements.get('proof-profile') as unknown)),
        'function',
      );
      assert.strictEqual(
        await page.evaluate(
          () =>
            document.querySelector('proof-profile') instanceof
            (customElements.get('proof-profile') as CustomElementConstructor),
        ),
        true,
      );
      console.log(
        'PASS chromium (packed, LOCAL): generated Native Custom Element registered and upgraded from plain HTML',
      );
    } finally {
      await generatedBrowser.close();
    }

    // ---- M12 S3 slice: packed shadow-root generated island ----
    //
    // LOCAL evidence (never a gate/CI-required task). This leg builds the packed
    // generated lane the S3 assertions need: a shadow-root generated island with
    // a compiler-emitted host producer, a Node SSR artifact (packed compiler +
    // packed shell), a browser bundle with an external source map, and then
    // asserts on the installed tarballs' output only: no `__partProgram`, exact
    // server SSR bytes preserved through parse/claim, zero claim-period
    // mutations, pre-activation input retention, and a decodable authored map.
    // It does not claim the full S2 stateful list matrix (M12/M13 stay owed).
    await writeFile(
      join(author, 'proof-shadow.tsx'),
      `// The generated lane's island policy statement (no router is installed).
function defineIslandConfig(config) { return config; }
export const openElement = defineIslandConfig({
  hydrate: 'only',
  ssr: true,
  root: 'shadow',
  properties: {
    title: { default: '' },
    count: { default: 0 },
  },
});

function ProofShadow(props: { title: string; count: number }) {
  return (
    <article id="proof-shadow-card" data-kind="packed-shadow">
      <h1 id="shadow-title">{props.title}</h1>
      <p id="shadow-count">{props.count}</p>
      <input id="shadow-field" value="server" />
    </article>
  );
}
export default ProofShadow;
`,
    );
    await writeFile(
      join(author, 'register-shadow.js'),
      `import ProofShadow from './proof-shadow.tsx'; customElements.define('proof-shadow', ProofShadow);`,
    );
    const shadowSitePlugin = `element({generatedElementSite: (moduleId) => moduleId.includes('proof-shadow.tsx') ? { tag: 'proof-shadow', root: 'shadow' } : null})`;
    await writeFile(
      join(author, 'vite.shadow.config.js'),
      `import {writeFileSync} from 'node:fs';
import {element} from '@openelement/compiler/vite';
export default {
  plugins: [
    ${shadowSitePlugin},
    {name:'proof-shadow-module-boundary',generateBundle(){for(const id of this.getModuleIds()){if(/compiler|router\\/src\\/(?:vite|cli)|node:/.test(id))this.error('Browser tooling leak: '+id)}}},
    {name:'proof-shadow-emitted-capture',enforce:'post',transform(code,id){if(id.includes('proof-shadow.tsx'))writeFileSync(${JSON.stringify(join(author, 'captured-shadow-module.js'))},code)}},
  ],
  build:{sourcemap:true, minify:false, lib:{entry:'register-shadow.js',formats:['es'],fileName:'shadow'}},
};`,
    );
    await runConsumerOrThrow(
      'node',
      ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.shadow.config.js'],
      author,
    );
    await writeFile(
      join(author, 'ssr-shadow-entry.js'),
      `import {ProofShadow__ssrHost} from './proof-shadow.tsx';
export function renderShadow() {
  // Canonical host-attribute input only: the same standard SSR product path the
  // router build uses; no fabricated property seed.
  return ProofShadow__ssrHost(undefined, undefined, [['title', 'server title'], ['count', '2']]);
}
`,
    );
    await writeFile(
      join(author, 'vite.shadow-ssr.config.js'),
      `import {element} from '@openelement/compiler/vite';
export default {
  plugins: [${shadowSitePlugin}],
  ssr: { noExternal: true },
  build:{ssr:'ssr-shadow-entry.js', outDir:'dist-ssr', sourcemap:true, minify:false, emptyOutDir:true, rollupOptions:{output:{format:'es', entryFileNames:'ssr-shadow-entry.js'}}},
};`,
    );
    await runConsumerOrThrow(
      'node',
      ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.shadow-ssr.config.js'],
      author,
    );
    const shadowJs = await readFile(join(author, 'dist/shadow.js'), 'utf8');
    const shadowMap = JSON.parse(
      await readFile(join(author, 'dist/shadow.js.map'), 'utf8'),
    ) as unknown;
    // The packed compiler plugin's own emitted module is the artifact the S3
    // no-__partProgram fact is about (the browser bundle legitimately carries the
    // packed shell/runtime it imports). The config's post-transform capture plugin
    // writes exactly the code the packed compiler emitted for this module.
    const emittedShadow = await readFile(join(author, 'captured-shadow-module.js'), 'utf8');
    assert(
      emittedShadow.includes('ProofShadow__ssrHost'),
      'packed compiler must emit the shadow host producer export',
    );
    assert(
      !emittedShadow.includes('__partProgram'),
      'packed generated shadow module must not carry __partProgram',
    );
    assert(
      !emittedShadow.includes('customElements'),
      'packed generated module must not register the element itself',
    );
    assert(
      ts
        .preProcessFile(shadowJs)
        .importedFiles.every(
          ({ fileName }) =>
            !/workspace:|@openelement\/(?:router|compiler)\/(?:vite|cli)|^node:/.test(fileName),
        ),
      'packed generated shadow browser artifact boundary',
    );
    const shadowMapEvidence = assertAuthoredSourceMap(shadowMap, 'proof-shadow.tsx', 10);
    const ssrModule = (await import(
      pathToFileURL(join(author, 'dist-ssr/ssr-shadow-entry.js')).href
    )) as { renderShadow: () => unknown };
    const serverHostHtml = ssrModule.renderShadow();
    assert(
      typeof serverHostHtml === 'string' &&
        serverHostHtml.includes('<template shadowrootmode="open">') &&
        serverHostHtml.includes('server title') &&
        serverHostHtml.includes('>2<'),
      'packed compiler+shell must emit the shadow host DSD server markup',
    );
    const shadowPage = `<!doctype html><html><head><meta charset="utf-8"></head><body>${
      serverHostHtml as string
    }<script>
(function () {
  var host = document.querySelector('proof-shadow');
  var shadow = host.shadowRoot;
  var input = shadow.querySelector('#shadow-field');
  var records = [];
  window.__s3 = {
    records: records,
    preHost: host.outerHTML,
    preShadow: shadow.innerHTML,
    typed: 'typed before activation'
  };
  input.value = window.__s3.typed;
  var observe = function (target) {
    var observer = new MutationObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) records.push(entries[i].type);
    });
    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    return observer;
  };
  observe(host);
  observe(shadow);
})();
</script><script type="module" src="/shadow.js"></script></body></html>`;
    await writeFile(join(consumer, 'shadow.js'), shadowJs);
    await writeFile(join(consumer, 'shadow.js.map'), JSON.stringify(shadowMap));
    await writeFile(join(consumer, 'shadow-s3.html'), shadowPage);
    console.log(
      `PASS packed S3 build: generated module ${shadowJs.length}B, SSR host ${(serverHostHtml as string).length}B, ` +
        `source map ${shadowMapEvidence.matchingSegments}/${shadowMapEvidence.totalSegments} authored segments`,
    );

    // M12-S3: packed shadow generated island — SSR bytes -> browser parse ->
    // claim. The observer and the pre-activation input are installed by the
    // inline classic script, so both happen before the deferred module runs.
    const shadowBrowser = await chromium.launch({ headless: true });
    try {
      const page = await shadowBrowser.newPage();
      const response = await page.goto(`${serverOrigin}/shadow-s3`);
      const responseText = await response!.text();
      assert(
        responseText.includes(serverHostHtml as string),
        'served packed S3 page must carry the server SSR bytes verbatim',
      );
      await page.waitForFunction(
        () =>
          document.querySelector('proof-shadow')?.shadowRoot?.querySelector('#shadow-title')
            ?.textContent === 'server title',
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const evidence = await page.evaluate(() => {
        const s3 = (
          window as unknown as {
            __s3: { records: string[]; preHost: string; preShadow: string; typed: string };
          }
        ).__s3;
        const host = document.querySelector('proof-shadow')!;
        const shadow = host.shadowRoot!;
        return {
          claimMutations: s3.records.length,
          mutationTypes: s3.records,
          preHost: s3.preHost,
          preShadow: s3.preShadow,
          postHost: host.outerHTML,
          postShadow: shadow.innerHTML,
          typed: s3.typed,
          inputValue: (shadow.querySelector('#shadow-field') as HTMLInputElement).value,
          title: shadow.querySelector('#shadow-title')?.textContent,
          count: shadow.querySelector('#shadow-count')?.textContent,
          defined: typeof customElements.get('proof-shadow'),
        };
      });
      // DSD parsing moves the `<template shadowrootmode>` into host.shadowRoot,
      // so `host.outerHTML` alone cannot carry it. Reconstruct the serialized DSD
      // from the parsed host open tag + the parsed shadow content and compare it
      // to the server bytes: the claim must not have changed either half.
      const parsedDsa = `${evidence.postHost.slice(
        0,
        -'</proof-shadow>'.length,
      )}<template shadowrootmode="open">${evidence.preShadow}</template></proof-shadow>`;
      assert.strictEqual(
        parsedDsa,
        serverHostHtml,
        'parsed host+shadow byte-equal to server SSR bytes',
      );
      assert.strictEqual(evidence.title, 'server title', 'SSR title reached the claimed DOM');
      assert.strictEqual(evidence.count, '2', 'SSR count reached the claimed DOM');
      assert.strictEqual(evidence.defined, 'function', 'packed generated class registered');
      assert.strictEqual(
        evidence.claimMutations,
        0,
        `claim-period mutations must be 0, saw ${evidence.mutationTypes.join(',')}`,
      );
      assert.strictEqual(evidence.postHost, evidence.preHost, 'claim kept the host bytes');
      assert.strictEqual(evidence.postShadow, evidence.preShadow, 'claim kept the shadow bytes');
      assert.strictEqual(evidence.typed, 'typed before activation');
      assert.strictEqual(
        evidence.inputValue,
        'typed before activation',
        'pre-activation input value must survive claim',
      );
      console.log(
        `PASS chromium (packed, LOCAL): shadow generated S3 SSR->claim bytes, 0 claim mutations, ` +
          `pre-activation input, source map ${shadowMapEvidence.matchingSegments}/${shadowMapEvidence.totalSegments} authored segments`,
      );
    } finally {
      await shadowBrowser.close();
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
