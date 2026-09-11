import { assertEquals, assertExists } from '@std/assert';
import { existsSync } from '@std/fs';
import { join } from '@std/path';
import {
  extractCustomElementTags,
  generateIslandManifests,
  type PageIslandManifest,
  writeIslandManifests,
} from '../src/vite/internal/ssg/index.ts';

const TMP_DIR = join(import.meta.dirname!, '__tmp_manifest_test__');

function setup() {
  if (existsSync(TMP_DIR)) Deno.removeSync(TMP_DIR, { recursive: true });
  Deno.mkdirSync(TMP_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP_DIR)) Deno.removeSync(TMP_DIR, { recursive: true });
}

Deno.test('extractCustomElementTags: extracts hyphenated tags', () => {
  const html =
    '<div><open-theme-toggle></open-theme-toggle><open-hero-ping auto></open-hero-ping></div>';
  const tags = extractCustomElementTags(html);
  assertEquals(tags.sort(), ['open-hero-ping', 'open-theme-toggle']);
});

Deno.test('extractCustomElementTags: ignores non-custom elements', () => {
  const html = '<div class="foo"><span>text</span><p>paragraph</p></div>';
  const tags = extractCustomElementTags(html);
  assertEquals(tags, []);
});

Deno.test('extractCustomElementTags: handles tags with attributes', () => {
  const html = '<open-button disabled>Click</open-button><open-input type="text" />';
  const tags = extractCustomElementTags(html);
  assertEquals(tags.sort(), ['open-button', 'open-input']);
});

Deno.test('extractCustomElementTags: matches the client island custom-element name contract', () => {
  const html = '<my_component-v1></my_component-v1><my.component-v1></my.component-v1>';
  const tags = extractCustomElementTags(html);
  assertEquals(tags.sort(), ['my.component-v1', 'my_component-v1']);
});

Deno.test('extractCustomElementTags: ignores false positives outside real markup', () => {
  const html = `
    <!-- <open-commented></open-commented> -->
    <script>
      const text = '<open-script></open-script>';
    </script>
    <style>
      open-style { display: block; }
    </style>
    <div data-template="<open-attribute></open-attribute>">
      &lt;open-text&gt;
      <open-real></open-real>
    </div>
  `;

  assertEquals(extractCustomElementTags(html), ['open-real']);
});

Deno.test('generateIslandManifests: produces manifests with known islands', () => {
  setup();
  Deno.writeTextFileSync(join(TMP_DIR, 'index.html'), '<open-theme-toggle></open-theme-toggle>');

  const chunkMap = { 'open-theme-toggle': '/client/islands/island-open-theme-toggle-abc.js' };
  const strategyMap = { 'open-theme-toggle': 'idle' as const };
  const layerMap = { 'open-theme-toggle': 'dsd-interactive' as const };

  const manifests = generateIslandManifests(TMP_DIR, chunkMap, strategyMap, layerMap);
  assertEquals(manifests.length, 1);
  assertEquals(manifests[0].route, '/');
  assertEquals(manifests[0].islands.length, 1);
  assertEquals(manifests[0].islands[0].tagName, 'open-theme-toggle');
  assertEquals(
    manifests[0].islands[0].chunkUrl,
    '/client/islands/island-open-theme-toggle-abc.js',
  );
  assertEquals(manifests[0].islands[0].strategy, 'idle');
  assertEquals(manifests[0].islands[0].layer, 'dsd-interactive');
  assertExists(manifests[0].builtAt);
  cleanup();
});

Deno.test('generateIslandManifests: empty islands for pages without custom elements', () => {
  setup();
  Deno.writeTextFileSync(join(TMP_DIR, 'about.html'), '<div><span>hello</span></div>');

  const manifests = generateIslandManifests(TMP_DIR, {});
  assertEquals(manifests.length, 1);
  assertEquals(manifests[0].route, '/about');
  assertEquals(manifests[0].islands, []);
  cleanup();
});

Deno.test('generateIslandManifests: defaults strategy to idle and layer to dsd-static', () => {
  setup();
  Deno.writeTextFileSync(join(TMP_DIR, 'guide.html'), '<open-button>Click</open-button>');

  const chunkMap = { 'open-button': '/client/islands/island-open-button-xyz.js' };
  const manifests = generateIslandManifests(TMP_DIR, chunkMap);

  assertEquals(manifests[0].islands[0].strategy, 'idle');
  assertEquals(manifests[0].islands[0].layer, 'dsd-static');
  cleanup();
});

Deno.test('generateIslandManifests: nested routes use one POSIX slash', () => {
  setup();
  Deno.mkdirSync(join(TMP_DIR, 'guide', 'start'), { recursive: true });
  Deno.writeTextFileSync(
    join(TMP_DIR, 'guide', 'start', 'index.html'),
    '<open-button></open-button>',
  );
  const manifests = generateIslandManifests(TMP_DIR, {
    'open-button': '/client/islands/island-open-button-a1b2.js',
  });
  assertEquals(manifests[0].route, '/guide/start');
  assertEquals(manifests[0].route.includes('//'), false);
  cleanup();
});

Deno.test('writeIslandManifests: creates JSON files in island-manifests dir', async () => {
  setup();
  const manifests: PageIslandManifest[] = [
    {
      route: '/',
      islands: [{
        tagName: 'open-toggle',
        chunkUrl: '/client/toggle.js',
        strategy: 'load',
        layer: 'dsd-static',
      }],
      builtAt: '2026-05-08T00:00:00.000Z',
    },
  ];

  await writeIslandManifests(TMP_DIR, manifests);

  const manifestDir = join(TMP_DIR, 'island-manifests');
  assertExists(manifestDir);

  const files = Array.from(Deno.readDirSync(manifestDir));
  assertEquals(files.length, 1);

  const content = JSON.parse(Deno.readTextFileSync(join(manifestDir, files[0].name)));
  assertEquals(content.route, '/');
  assertEquals(content.islands.length, 1);
  assertEquals(content.islands[0].tagName, 'open-toggle');
  cleanup();
});
