/**
 * Round-3 hardening for the shared rendered-HTML walk (round2-review R2-1).
 *
 * The walk drives both the island manifest and the document bootstrap
 * decision. It originally recognized only the literal `-->` comment end, so an
 * abruptly closed comment (`<!-->`, `<!--->`, `--!>`) followed by a later
 * `-->` made the walk skip markup that the browser still parses — an iframe
 * with an authored `srcdoc` script could be hidden from the zero-JS decision
 * (fail open). These tests pin every HTML comment-end form, the fail-closed
 * direction for unreadable nested comments, and the unchanged template/raw
 * text handling that the walk also owns.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createGeneratedApp } from '../src/vite/internal/server-runtime/app.ts';
import { visitRenderedTags, type RenderedTag } from '../src/vite/internal/ssg/rendered-html.ts';

const SRCDOC_FRAME = '<iframe srcdoc="<script>mount()</script>"></iframe>';

beforeEach(() => {
  const definitions = new Map<string, unknown>();
  vi.stubGlobal('customElements', {
    define: (name: string, constructor: unknown) => definitions.set(name, constructor),
    get: (name: string) => definitions.get(name),
  });
});

afterEach(() => vi.unstubAllGlobals());

function visit(html: string) {
  const tags: RenderedTag[] = [];
  const complete = visitRenderedTags(html, (tag) => {
    tags.push(tag);
  });
  return { tags, complete };
}

function makeApp() {
  return createGeneratedApp({
    islands: { 'my-counter': '/counter.tsx' },
    clientIslandTags: ['my-counter'],
    layoutPlan: { default: false, layouts: {} },
    locales: [],
    navSections: [],
    headerNav: [],
    defaultLocale: 'en',
    devClientScriptSrc: '/client/islands/client.js',
    pageHandlerPaths: [],
  });
}

test('normal comments still hide their content from the walk', () => {
  const { tags, complete } = visit('<!-- <my-counter></my-counter> --><p>Copy</p>');
  expect(complete).toBe(true);
  expect(tags.map((tag) => tag.name)).toEqual(['p']);
});

test('every abrupt comment end exposes the markup after it', () => {
  const app = makeApp();
  // Each form is followed by a later `-->`; the old walker skipped straight to
  // that close, never seeing the frame.
  for (const form of ['<!-->', '<!--->', '<!-- note --!>']) {
    const html = `${form}${SRCDOC_FRAME}<!-- trailing -->`;
    const { tags, complete } = visit(html);
    expect(complete, form).toBe(true);
    const frame = tags.find((tag) => tag.name === 'iframe');
    expect(frame, form).toBeDefined();
    expect(frame?.attributes.get('srcdoc'), form).toBe('<script>mount()</script>');
    // End-to-end: the visible frame keeps the client bootstrap instead of
    // letting the document ship zero-JS while the browser runs the srcdoc
    // script with parent access.
    expect(app.clientScriptDescriptors(html), form).toHaveLength(1);
  }
});

test('declarative shadow-root nesting is unchanged across comment forms', () => {
  const html = [
    '<static-shell>',
    '<template shadowrootmode="open">',
    '<!-- <span id="hidden">Copy</span> -->',
    '<!--><span id="target">Copy</span>',
    '</template>',
    '</static-shell>',
  ].join('');
  const { tags, complete } = visit(html);
  expect(complete).toBe(true);
  expect(tags.map((tag) => tag.name)).toEqual(['static-shell', 'template', 'span']);
  expect(tags[2]?.attributes.get('id')).toBe('target');
  expect(tags[2]?.inOpenShadow).toBe(true);
});

test('raw-text content is still skipped instead of parsed as markup', () => {
  const html = [
    '<script>const frame = "<iframe srcdoc=\'<script>mount()</script>\'></iframe>";</script>',
    '<textarea><iframe srcdoc="<script>mount()</script>"></iframe></textarea>',
    '<style>/* <iframe srcdoc="<script>mount()</script>"> */</style>',
    '<title><iframe srcdoc="<script>mount()</script>"></iframe></title>',
    '<p>Copy</p>',
  ].join('');
  const { tags, complete } = visit(html);
  expect(complete).toBe(true);
  expect(tags.map((tag) => tag.name)).toEqual(['script', 'textarea', 'style', 'title', 'p']);
});

test('unreadable comments fail closed instead of claiming completeness', () => {
  expect(visit('<p>Copy</p><!-- unterminated').complete).toBe(false);

  // A nested opener before the close reaches tokenizer states where a plain
  // search can disagree with the browser, so the walk stops and the caller
  // keeps the client.
  const nested = visit(`<!-- nested <!-- -->${SRCDOC_FRAME}`);
  expect(nested.complete).toBe(false);
  expect(nested.tags).toEqual([]);
});
