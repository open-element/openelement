import { expect, test } from 'vitest';
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'vite';

test('Navigation API: three-browser push/replace/traversal and stale guard regression', async function fn() {
  const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
  const source = `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
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
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
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
      },
    ],
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
        expect(await page.evaluate('window.router.currentPath'), type.name()).toEqual('/a');
        await page.evaluate('window.router.replace("/b")');
        await page.goBack();
        await page.waitForFunction('window.router.currentPath === "/"');
        await page.goForward();
        await page.waitForFunction('window.router.currentPath === "/b"');
        await page.evaluate('window.pending = window.router.navigate("/slow"); void 0');
        await page.evaluate('window.router.navigate("/a")');
        await page.evaluate('window.releaseGuard("/b"); window.pending');
        expect(await page.evaluate('window.router.currentPath')).toEqual('/a');
        await page.evaluate('window.router.navigate("/redirect")');
        expect(await page.evaluate('window.router.currentPath')).toEqual('/b');
        // Read layout directly: WebKit's Playwright locator auto-wait treats
        // Navigation API same-document traversals as pending document loads.
        const link = await page.evaluate(() =>
          document.querySelector('#link')!.getBoundingClientRect().toJSON(),
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
        expect(await page.evaluate('location.pathname')).toEqual('/b');
        expect(await page.evaluate('window.router.currentPath')).toEqual('/b');
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
        expect((await downloaded).suggestedFilename()).toEqual('proof.txt');
        expect(await page.evaluate('window.router.currentPath')).toEqual('/b');
        await page.route('https://external.invalid/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<p>external document</p>' }),
        );
        await page.evaluate(
          'const a=document.querySelector("#link"); a.removeAttribute("download"); a.href="https://external.invalid/a"; a.click()',
        );
        await page.waitForURL('https://external.invalid/a');
        expect(await page.evaluate('typeof window.router')).toEqual('undefined');
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
}, 300_000);

test('Navigation API: native POST / fragment / reload stay browser-owned (three browsers)', async function fn() {
  const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
  const source = `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
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
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
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
              req.on('data', (chunk) => (body += chunk));
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
      },
    ],
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
        expect(await page.evaluate('location.pathname'), type.name()).toEqual('/a');
        expect(await page.evaluate('window.router.currentPath'), type.name()).toEqual('/a');
        expect(await page.evaluate('window.pending'), type.name()).toEqual(0);
        expect(await page.evaluate('window.changes.length'), type.name()).toEqual(0);
        expect(Number(await page.evaluate('scrollY')) > 0, type.name()).toEqual(true);
        expect(seen.length, type.name()).toEqual(0);
        // Reload: full document load through the browser, fresh router after.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction('window.router');
        expect(await page.evaluate('window.router.currentPath'), type.name()).toEqual('/a');
        // Real form POST: method/body reach the server; the SPA never
        // converts it into a GET page navigation (full document load).
        await page.evaluate('location.hash=""');
        await Promise.all([page.waitForURL('**/submit'), page.click('#submit')]);
        expect(await page.evaluate('location.pathname'), type.name()).toEqual('/submit');
        expect(seen.length, type.name()).toEqual(1);
        expect(seen[0].method, type.name()).toEqual('POST');
        expect(seen[0].body.includes('field=hello'), type.name()).toEqual(true);
        expect(await page.evaluate('document.body.textContent'), type.name()).toEqual('submitted');
        console.log(`${type.name()} ${browser.version()}: POST/fragment/reload browser-owned PASS`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}, 300_000);

test('View Transitions: settle-then-click flows on every engine (regression pin)', async function fn() {
  const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
  const source = `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
window.changes = [];
window.vtStarts = 0;
const origVT = document.startViewTransition?.bind(document);
if (origVT) {
  document.startViewTransition = (cb) => { window.vtStarts++; return origVT(cb); };
}
window.router = createRouter({
  mode: 'history',
  viewTransitions: true,
  routes: [
    { path: '/', tagName: 'home-page' },
    { path: '/a', tagName: 'a-page' },
    { path: '/b', tagName: 'b-page' },
  ],
  onChange: () => { window.changes.push(window.router.currentPath); },
});
// Deterministic window: without a pinned animation the default transition
// can finish before the click lands (engine- and load-timing-dependent —
// WebKit was observed both ways), which made this probe flaky. Five
// seconds on every transition pseudo guarantees the click lands inside an
// active transition; whatever each engine does then IS its true behavior.
const pin = document.createElement('style');
pin.textContent = '::view-transition-group(*), ::view-transition-image-pair(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 5s !important; }';
document.head.append(pin);`;
  const server = await createServer({
    root,
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'vt-settle',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/proof.js') {
              res.setHeader('content-type', 'text/javascript');
              res.end(source);
              return;
            }
            if (req.headers.accept?.includes('text/html')) {
              res.setHeader('content-type', 'text/html');
              res.end('<script type="module" src="/proof.js"></script><a href="/a" id="la">a</a>');
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  try {
    const address = server.httpServer!.address() as { port: number };
    for (const type of [chromium, firefox, webkit]) {
      const browser = await type.launch({ headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(10_000);
      try {
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction('window.router');
        await page.evaluate('window.router.navigate("/b")');
        await page.waitForFunction('window.router.currentPath === "/b"');
        // Settle first: every engine now ships the VT API, and an anchor
        // activation whose input burst begins while a transition is still
        // active is suppressed (see the retirement-probe test below).
        await page
          .waitForFunction(
            'window.vtStarts === 0 || window.changes.length >= 1 && !document.startViewTransition',
          )
          .catch(() => {});
        await page.waitForTimeout(300);
        const link = await page.evaluate(() =>
          document.querySelector('#la')!.getBoundingClientRect().toJSON(),
        );
        await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
        await page.waitForFunction('window.router.currentPath === "/a"');
        expect(await page.evaluate('location.pathname'), type.name()).toBe('/a');
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}, 90_000);

test('View Transitions: input bursts during an active transition stay suppressed (retirement probe)', async function fn() {
  const root = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
  const source = `import {createRouter} from '/@fs/${root}/packages/router/src/internal/router/client-router.ts';
window.changes = [];
window.vtLog = [];
window.vtStarts = 0;
window.__activeVT = null;
const origVT = document.startViewTransition?.bind(document);
if (origVT) {
  document.startViewTransition = (cb) => {
    window.vtLog.push('start');
    const t = origVT(cb);
    window.__activeVT = t;
    t.finished.then(() => { if (window.__activeVT === t) window.__activeVT = null; }, () => {});
    window.vtStarts++;
    return t;
  };
  document.addEventListener(
    'pointerdown',
    () => { if (window.__activeVT) { window.vtLog.push('skip-on-interact'); window.__activeVT.skipTransition(); } },
    { capture: true },
  );
}
window.router = createRouter({
  mode: 'history',
  viewTransitions: true,
  routes: [
    { path: '/', tagName: 'home-page' },
    { path: '/a', tagName: 'a-page' },
    { path: '/b', tagName: 'b-page' },
  ],
  onChange: () => { window.changes.push(window.router.currentPath); },
});
// Deterministic window: without a pinned animation the default transition
// can finish before the click lands (engine- and load-timing-dependent —
// WebKit was observed both ways), which made this probe flaky. Five
// seconds on every transition pseudo guarantees the click lands inside an
// active transition; whatever each engine does then IS its true behavior.
const pin = document.createElement('style');
pin.textContent = '::view-transition-group(*), ::view-transition-image-pair(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 5s !important; }';
document.head.append(pin);`;
  const server = await createServer({
    root,
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'vt-probe',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/proof.js') {
              res.setHeader('content-type', 'text/javascript');
              res.end(source);
              return;
            }
            if (req.headers.accept?.includes('text/html')) {
              res.setHeader('content-type', 'text/html');
              res.end('<script type="module" src="/proof.js"></script><a href="/a" id="la">a</a>');
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  try {
    const address = server.httpServer!.address() as { port: number };
    for (const type of [chromium, firefox, webkit]) {
      const browser = await type.launch({ headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(8_000);
      try {
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction('window.router');
        await page.evaluate('window.router.navigate("/b")');
        // Resolve the moment the route committed — the first transition is
        // still in flight here by construction.
        await page.waitForFunction('window.router.currentPath === "/b"');
        const link = await page.evaluate(() =>
          document.querySelector('#la')!.getBoundingClientRect().toJSON(),
        );
        await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
        await page.waitForTimeout(600);
        const state = await page.evaluate('({path: location.pathname, log: window.vtLog})');
        // 2026-10-08 verified on Chromium 147, Firefox Nightly and WebKit
        // 26.4: the pointerdown reaches the page (the skip fires), yet the
        // anchor activation is suppressed — a same-burst skipTransition()
        // cannot rescue it. This pin documents the RouterOptions.viewTransitions
        // default-off retirement condition: the day an engine lets this
        // click navigate, this assertion fails and the default flip is
        // unblocked for that engine.
        expect(
          state.log.some((entry) => entry === 'skip-on-interact'),
          type.name(),
        ).toBe(true);
        expect(
          state.path,
          `${type.name()} suppressed the click (retire this pin to flip the default)`,
        ).toBe('/b');
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}, 90_000);
