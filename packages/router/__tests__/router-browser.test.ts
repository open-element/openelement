import { assertEquals } from '@std/assert';
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { generateWorkspaceAliases } from '../src/vite/workspace-alias.ts';

Deno.test({
  name: 'Navigation API: three-browser push/replace/traversal and stale guard regression',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
    const source =
      `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
      window.changes=[];
      window.router=createRouter({mode:'history', routes:[
        {path:'/',tagName:'home-page'}, {path:'/a',tagName:'a-page'}, {path:'/b',tagName:'b-page'},
        {path:'/slow',tagName:'slow-page',guard:()=>new Promise(r=>window.releaseGuard=r)},
        {path:'/download',tagName:'download-page'}, {path:'/redirect',tagName:'redirect-page',guard:async()=>'/b'}, {path:'/blocked',tagName:'blocked-page',guard:async()=>false}
      ],onChange:()=>window.changes.push(window.router.currentPath)});`;
    const server = await createServer({
      root,
      configFile: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'error',
      resolve: { alias: generateWorkspaceAliases(root) },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'nav-proof',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/download') {
              res.setHeader('content-type', 'text/plain');
              res.setHeader('content-disposition', 'attachment; filename="proof.txt"');
              res.end('download proof');
              return;
            }
            if (req.url === '/proof.js') {
              res.setHeader('content-type', 'text/javascript');
              res.end(source);
              return;
            }
            if (req.headers.accept?.includes('text/html')) {
              res.setHeader('content-type', 'text/html');
              res.end(
                '<script type="module" src="/proof.js"></script><a href="/a" id="link">a</a>',
              );
              return;
            }
            next();
          });
        },
      }],
    });
    await server.listen();
    try {
      const address = server.httpServer!.address() as { port: number };
      for (const type of [chromium, firefox, webkit]) {
        const browser = await type.launch({ headless: true });
        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(10_000);
          await page.goto(`http://127.0.0.1:${address.port}`);
          await page.waitForFunction('window.router');
          await page.evaluate('window.router.navigate("/a")');
          assertEquals(await page.evaluate('window.router.currentPath'), '/a', type.name());
          await page.evaluate('window.router.replace("/b")');
          await page.goBack();
          await page.waitForFunction('window.router.currentPath === "/"');
          await page.goForward();
          await page.waitForFunction('window.router.currentPath === "/b"');
          await page.evaluate('window.pending = window.router.navigate("/slow"); void 0');
          await page.evaluate('window.router.navigate("/a")');
          await page.evaluate('window.releaseGuard("/b"); window.pending');
          assertEquals(await page.evaluate('window.router.currentPath'), '/a');
          await page.evaluate('window.router.navigate("/redirect")');
          assertEquals(await page.evaluate('window.router.currentPath'), '/b');
          // Read layout directly: WebKit's Playwright locator auto-wait treats
          // Navigation API same-document traversals as pending document loads.
          const link = await page.evaluate(() =>
            document.querySelector('#link')!.getBoundingClientRect().toJSON()
          );
          await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
          await page.waitForFunction('window.router.currentPath === "/a"');
          await page.evaluate(
            'document.querySelector("#link").href="/blocked"; document.querySelector("#link").click()',
          );
          await page.waitForFunction(
            'location.pathname === "/a" && window.router.currentPath === "/a"',
          );
          await page.evaluate(
            'document.querySelector("#link").href="/slow"; document.querySelector("#link").click()',
          );
          await page.waitForFunction('location.pathname === "/slow"');
          await page.evaluate('window.router.navigate("/b")');
          await page.evaluate('window.releaseGuard(false)');
          assertEquals(await page.evaluate('location.pathname'), '/b');
          assertEquals(await page.evaluate('window.router.currentPath'), '/b');
          await page.evaluate(
            'window.navEvents=[]; navigation.addEventListener("navigate",e=>window.navEvents.push({url:e.destination.url,can:e.canIntercept,download:e.downloadRequest,source:e.sourceElement?.outerHTML}))',
          );
          const downloaded = page.waitForEvent('download').catch(async (error) => {
            console.log(
              type.name(),
              await page.evaluate(
                '({path:location.href,events:window.navEvents,current:window.router?.currentPath})',
              ),
            );
            throw error;
          });
          await page.evaluate(
            'const a=document.querySelector("#link"); a.href="/download"; a.download="proof.txt"',
          );
          await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
          assertEquals((await downloaded).suggestedFilename(), 'proof.txt');
          assertEquals(await page.evaluate('window.router.currentPath'), '/b');
          await page.route(
            'https://external.invalid/**',
            (route) =>
              route.fulfill({ contentType: 'text/html', body: '<p>external document</p>' }),
          );
          await page.evaluate(
            'const a=document.querySelector("#link"); a.removeAttribute("download"); a.href="https://external.invalid/a"; a.click()',
          );
          await page.waitForURL('https://external.invalid/a');
          assertEquals(await page.evaluate('typeof window.router'), 'undefined');
          console.log(
            `${type.name()} ${browser.version()}: navigation, abort, download, cross-origin PASS`,
          );
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  },
});

Deno.test({
  name: 'Navigation API: native POST / fragment / reload stay browser-owned (three browsers)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
    const source =
      `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
      window.pending=0; window.guards=0; window.changes=[];
      window.router=createRouter({mode:'history', routes:[
        {path:'/',tagName:'home-page'}, {path:'/a',tagName:'a-page'}, {path:'/submit',tagName:'submit-page'}
      ],onPending:()=>window.pending++,onChange:()=>window.changes.push(window.router.currentPath)});`;
    const seen: Array<{ method: string; url: string; body: string }> = [];
    const server = await createServer({
      root,
      configFile: false,
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'error',
      resolve: { alias: generateWorkspaceAliases(root) },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [{
        name: 'ownership-proof',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/proof2.js') {
              res.setHeader('content-type', 'text/javascript');
              res.end(source);
              return;
            }
            if (req.method === 'POST' && req.url === '/submit') {
              let body = '';
              req.on('data', (chunk) => body += chunk);
              req.on('end', () => {
                seen.push({ method: req.method!, url: req.url!, body });
                res.setHeader('content-type', 'text/html');
                res.end('<body>submitted</body>');
              });
              return;
            }
            if (req.headers.accept?.includes('text/html')) {
              res.setHeader('content-type', 'text/html');
              res.end(
                '<script type="module" src="/proof2.js"></script>' +
                  '<form method="post" action="/submit"><input name="field" value="hello"/><button type="submit" id="submit">go</button></form>' +
                  '<a href="#section" id="frag">frag</a><div style="height:3000px"></div><div id="section">target</div>',
              );
              return;
            }
            next();
          });
        },
      }],
    });
    await server.listen();
    try {
      const address = server.httpServer!.address() as { port: number };
      for (const type of [chromium, firefox, webkit]) {
        seen.length = 0;
        const browser = await type.launch({ headless: true });
        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(10_000);
          await page.goto(`http://127.0.0.1:${address.port}/a`);
          await page.waitForFunction('window.router');
          // Fragment: native scroll preserved, no guard/pending/change, no server hit.
          await page.click('#frag');
          await page.waitForFunction('location.hash === "#section"');
          assertEquals(await page.evaluate('location.pathname'), '/a', type.name());
          assertEquals(await page.evaluate('window.router.currentPath'), '/a', type.name());
          assertEquals(await page.evaluate('window.pending'), 0, type.name());
          assertEquals(await page.evaluate('window.changes.length'), 0, type.name());
          assertEquals(Number(await page.evaluate('scrollY')) > 0, true, type.name());
          assertEquals(seen.length, 0, type.name());
          // Reload: full document load through the browser, fresh router after.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForFunction('window.router');
          assertEquals(await page.evaluate('window.router.currentPath'), '/a', type.name());
          // Real form POST: method/body reach the server; the SPA never
          // converts it into a GET page navigation (full document load).
          await page.evaluate('location.hash=""');
          await Promise.all([
            page.waitForURL('**/submit'),
            page.click('#submit'),
          ]);
          assertEquals(await page.evaluate('location.pathname'), '/submit', type.name());
          assertEquals(seen.length, 1, type.name());
          assertEquals(seen[0].method, 'POST', type.name());
          assertEquals(seen[0].body.includes('field=hello'), true, type.name());
          assertEquals(await page.evaluate('document.body.textContent'), 'submitted', type.name());
          console.log(
            `${type.name()} ${browser.version()}: POST/fragment/reload browser-owned PASS`,
          );
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  },
});
