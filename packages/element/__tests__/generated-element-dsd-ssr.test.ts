/**
 * M09-2a — the host-level DSD producer (`generated-element/dsd-ssr.ts`).
 *
 * The generated `<Name>__ssr` stays content-only; this leaf is the ONE place
 * that closes the content, the descriptor root and the host tag into the
 * artifact the browser parser adopts. The proof here is byte-level and
 * browser-free:
 *
 * - the exact host shape for a shadow root — host tag, canonical template, then
 *   light children AFTER the template — and the light-root shape with no
 *   template;
 * - the typed DSD options reach the template through the ONE spelling
 *   (`dsd.ts` `serializeDsdAttributes` / `serializeShadowTemplate`), and an
 *   unrequested option is absent;
 * - a light root refuses light children (they are projections into its own
 *   slots, never appendages) exactly like the class serializer;
 * - attributes are `[name, value]` string pairs only: the canonical
 *   safe-attribute predicate refuses an unsafe name, duplicates are refused
 *   case-insensitively, a non-string value is refused instead of guessed, and
 *   the value is escaped by the shared `escapeAttrValue` (one escape table);
 * - no `<style>`, no `<link>`, no raw-markup prefix, and no second DSD spelling
 *   in the emitted bytes;
 * - the producer never imports the server serializer: the source imports only
 *   the browser-safe leaf set.
 *
 * Node-only, LOCAL. Not a browser, not SSR→claim, not the M09-2a vertical (that
 * one parses these bytes in Chromium).
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { escapeAttrValue } from '../src/internal/core/html-escape.ts';
import { serializeGeneratedElementHtml } from '../src/internal/compiled/generated-element/dsd-ssr.ts';
import { serializeShadowTemplate } from '../src/internal/compiled/dsd.ts';
import { CompiledProgramValidationError } from '../src/internal/compiled/runtime/values.ts';

const CONTENT = '<p id="panel">hello</p>';

function refusal(run: () => unknown): CompiledProgramValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof CompiledProgramValidationError) return error;
    throw error;
  }
  throw new Error('expected the DSD host producer to refuse the request');
}

test('an open shadow root produces the host tag, the canonical template and light children last', () => {
  expect(
    serializeGeneratedElementHtml({
      tag: 'profile-card',
      root: 'open',
      content: CONTENT,
      lightChildren: '<span slot="title">T</span>',
    }),
  ).toBe(
    '<profile-card><template shadowrootmode="open"><p id="panel">hello</p></template><span slot="title">T</span></profile-card>',
  );
});

test('a closed shadow root uses the same template spelling and the same host shape', () => {
  expect(serializeGeneratedElementHtml({ tag: 'x-card', root: 'closed', content: CONTENT })).toBe(
    '<x-card><template shadowrootmode="closed"><p id="panel">hello</p></template></x-card>',
  );
});

test('a light root emits no template and refuses light children', () => {
  expect(serializeGeneratedElementHtml({ tag: 'x-card', root: 'light', content: CONTENT })).toBe(
    '<x-card><p id="panel">hello</p></x-card>',
  );
  const error = refusal(() =>
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'light',
      content: CONTENT,
      lightChildren: '<span>light</span>',
    }),
  );
  expect(error.path).toBe('lightChildren');
});

test('the template bytes are the canonical serializer bytes, not a second spelling', () => {
  for (const mode of ['open', 'closed'] as const) {
    expect(serializeGeneratedElementHtml({ tag: 'x-card', root: mode, content: CONTENT })).toBe(
      `<x-card>${serializeShadowTemplate(mode, CONTENT)}</x-card>`,
    );
    expect(
      serializeGeneratedElementHtml({
        tag: 'x-card',
        root: mode,
        content: CONTENT,
        dsd: { delegatesFocus: true, slotAssignment: 'manual', clonable: true },
      }),
    ).toBe(
      `<x-card>${serializeShadowTemplate(mode, CONTENT, {
        delegatesFocus: true,
        slotAssignment: 'manual',
        clonable: true,
      })}</x-card>`,
    );
  }
});

test('a requested DSD option reaches the template and an unrequested one does not', () => {
  const html = serializeGeneratedElementHtml({
    tag: 'x-card',
    root: 'open',
    content: CONTENT,
    dsd: { delegatesFocus: true },
  });
  expect(html).toContain('<template shadowrootmode="open" shadowrootdelegatesfocus>');
  expect(html).not.toContain('shadowrootclonable');
  expect(html).not.toContain('shadowrootserializable');
  expect(html).not.toContain('shadowrootslotassignment');
  expect(html).not.toContain('shadowrootcustomelementregistry');
});

test('an invalid DSD option fails closed with the canonical identity', () => {
  const error = refusal(() =>
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'open',
      content: CONTENT,
      dsd: { slotAssignment: 'sideways' as 'manual' },
    }),
  );
  expect(error.path).toBe('dsd.slotAssignment');
});

test('host attributes are validated pairs escaped by the shared escaper', () => {
  const value = 'a"b<c>&d';
  expect(
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'open',
      content: CONTENT,
      attributes: [
        ['data-id', value],
        ['aria-label', 'label'],
      ],
    }),
  ).toBe(
    `<x-card data-id="${escapeAttrValue(value)}" aria-label="label"><template shadowrootmode="open">${CONTENT}</template></x-card>`,
  );
});

test('an unsafe attribute name, a duplicate and a non-string value are refused', () => {
  const unsafe = refusal(() =>
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'open',
      content: CONTENT,
      attributes: [['onclick', 'boom']],
    }),
  );
  expect(unsafe.path).toBe('attributes');
  expect(unsafe.message).toContain('unsafe attribute name');

  const duplicate = refusal(() =>
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'open',
      content: CONTENT,
      attributes: [
        ['data-id', 'a'],
        ['DATA-ID', 'b'],
      ],
    }),
  );
  expect(duplicate.path).toBe('attributes');
  expect(duplicate.message).toContain('duplicate attribute');

  const nonString = refusal(() =>
    serializeGeneratedElementHtml({
      tag: 'x-card',
      root: 'open',
      content: CONTENT,
      attributes: [['data-id', 7 as unknown as string]],
    }),
  );
  expect(nonString.path).toBe('attributes[0]');
});

test('an invalid root, tag and content are refused instead of guessed', () => {
  expect(
    refusal(() =>
      serializeGeneratedElementHtml({
        tag: 'x-card',
        root: 'shadow' as 'open',
        content: CONTENT,
      }),
    ).path,
  ).toBe('root');
  expect(
    refusal(() => serializeGeneratedElementHtml({ tag: '', root: 'open', content: CONTENT })).path,
  ).toBe('tag');
  expect(
    refusal(() =>
      serializeGeneratedElementHtml({
        tag: 'x-card',
        root: 'open',
        content: 7 as unknown as string,
      }),
    ).path,
  ).toBe('content');
});

test('the emitted bytes carry no style, link or raw prefix channel', () => {
  const html = serializeGeneratedElementHtml({
    tag: 'x-card',
    root: 'open',
    content: CONTENT,
    attributes: [['data-id', 'a']],
    lightChildren: '<span>slot content</span>',
  });
  expect(html).not.toContain('<style');
  expect(html).not.toContain('<link');
  expect(html.indexOf('</template>')).toBeLessThan(html.indexOf('<span>slot content</span>'));
});

test('the producer leaf imports only the browser-safe set', () => {
  const source = readFileSync(
    new URL('../src/internal/compiled/generated-element/dsd-ssr.ts', import.meta.url),
    'utf8',
  );
  const specifiers = [...source.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map(
    (match) => match[1]!,
  );
  expect(specifiers.sort()).toEqual([
    '../../core/html-escape.ts',
    '../../core/security.ts',
    '../dsd.ts',
    '../runtime/values.ts',
  ]);
});
