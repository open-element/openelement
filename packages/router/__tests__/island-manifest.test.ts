import { expect, test } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractCustomElementTags,
  generateIslandManifests,
  type PageIslandManifest,
  writeIslandManifests,
} from '../src/vite/internal/ssg/index.ts';

const TMP_DIR = join(import.meta.dirname!, '__tmp_manifest_test__');

function setup() {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

test('extractCustomElementTags: extracts hyphenated tags', () => {
  const html =
    '<div><open-theme-toggle></open-theme-toggle><open-hero-ping auto></open-hero-ping></div>';
  const tags = extractCustomElementTags(html);
  expect(tags.sort()).toEqual(['open-hero-ping', 'open-theme-toggle']);
});

test('extractCustomElementTags: ignores non-custom elements', () => {
  const html = '<div class="foo"><span>text</span><p>paragraph</p></div>';
  const tags = extractCustomElementTags(html);
  expect(tags).toEqual([]);
});

test('extractCustomElementTags: handles tags with attributes', () => {
  const html = '<open-button disabled>Click</open-button><open-input type="text" />';
  const tags = extractCustomElementTags(html);
  expect(tags.sort()).toEqual(['open-button', 'open-input']);
});

test('extractCustomElementTags: matches the client island custom-element name contract', () => {
  const html = '<my_component-v1></my_component-v1><my.component-v1></my.component-v1>';
  const tags = extractCustomElementTags(html);
  expect(tags.sort()).toEqual(['my.component-v1', 'my_component-v1']);
});

test('extractCustomElementTags: ignores false positives outside real markup', () => {
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

  expect(extractCustomElementTags(html)).toEqual(['open-real']);
});

test('generateIslandManifests: produces manifests with known islands', () => {
  setup();
  writeFileSync(join(TMP_DIR, 'index.html'), '<open-theme-toggle></open-theme-toggle>');

  const chunkMap = { 'open-theme-toggle': '/client/islands/island-open-theme-toggle-abc.js' };
  const strategyMap = { 'open-theme-toggle': 'idle' as const };
  const layerMap = { 'open-theme-toggle': 'dsd-interactive' as const };

  const manifests = generateIslandManifests(TMP_DIR, chunkMap, strategyMap, layerMap);
  expect(manifests.length).toEqual(1);
  expect(manifests[0].route).toEqual('/');
  expect(manifests[0].islands.length).toEqual(1);
  expect(manifests[0].islands[0].tagName).toEqual('open-theme-toggle');
  expect(manifests[0].islands[0].chunkUrl).toEqual(
    '/client/islands/island-open-theme-toggle-abc.js',
  );
  expect(manifests[0].islands[0].strategy).toEqual('idle');
  expect(manifests[0].islands[0].layer).toEqual('dsd-interactive');
  expect(manifests[0].builtAt).toEqual(expect.anything());
  cleanup();
});

test('generateIslandManifests: empty islands for pages without custom elements', () => {
  setup();
  writeFileSync(join(TMP_DIR, 'about.html'), '<div><span>hello</span></div>');

  const manifests = generateIslandManifests(TMP_DIR, {});
  expect(manifests.length).toEqual(1);
  expect(manifests[0].route).toEqual('/about');
  expect(manifests[0].islands).toEqual([]);
  cleanup();
});

test('generateIslandManifests: defaults strategy to idle and layer to dsd-static', () => {
  setup();
  writeFileSync(join(TMP_DIR, 'guide.html'), '<open-button>Click</open-button>');

  const chunkMap = { 'open-button': '/client/islands/island-open-button-xyz.js' };
  const manifests = generateIslandManifests(TMP_DIR, chunkMap);

  expect(manifests[0].islands[0].strategy).toEqual('idle');
  expect(manifests[0].islands[0].layer).toEqual('dsd-static');
  cleanup();
});

test('generateIslandManifests: nested routes use one POSIX slash', () => {
  setup();
  mkdirSync(join(TMP_DIR, 'guide', 'start'), { recursive: true });
  writeFileSync(join(TMP_DIR, 'guide', 'start', 'index.html'), '<open-button></open-button>');
  const manifests = generateIslandManifests(TMP_DIR, {
    'open-button': '/client/islands/island-open-button-a1b2.js',
  });
  expect(manifests[0].route).toEqual('/guide/start');
  expect(manifests[0].route.includes('//')).toEqual(false);
  cleanup();
});

test('writeIslandManifests: creates JSON files in island-manifests dir', async () => {
  setup();
  const manifests: PageIslandManifest[] = [
    {
      route: '/',
      islands: [
        {
          tagName: 'open-toggle',
          chunkUrl: '/client/toggle.js',
          strategy: 'load',
          layer: 'dsd-static',
        },
      ],
      builtAt: '2026-05-08T00:00:00.000Z',
    },
  ];

  await writeIslandManifests(TMP_DIR, manifests);

  const manifestDir = join(TMP_DIR, 'island-manifests');
  expect(manifestDir).toEqual(expect.anything());

  const files = readdirSync(manifestDir, { withFileTypes: true });
  expect(files.length).toEqual(1);

  const content = JSON.parse(readFileSync(join(manifestDir, files[0].name), 'utf8'));
  expect(content.route).toEqual('/');
  expect(content.islands.length).toEqual(1);
  expect(content.islands[0].tagName).toEqual('open-toggle');
  cleanup();
});
