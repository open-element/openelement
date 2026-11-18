/**
 * Light-root slot-anchor substitution — the serializer half (LOCAL, Node).
 *
 * The producer writes a slot's interior between `oe:s:<ordinal>:<hex name>` and
 * `oe:/s:<ordinal>:<hex name>` comments. This file pins the consumer:
 *
 *   1. a projection lands INSIDE the `<slot>` element whose anchor names it, and
 *      the anchor comments never reach the emitted document (they are the
 *      lane's private locator);
 *   2. a slot with no projection keeps its fallback bytes;
 *   3. a projection naming a slot the content does not declare fails closed with
 *      the serializer's existing `CompiledProgramValidationError` identity and
 *      the same `projectedChildren` path the class lane uses;
 *   4. a slotless light producer with no projection is returned untouched
 *      (byte identity), and foreign markers (range/`when`/`each`/text) are
 *      copied through rather than rewritten;
 *   5. a half-anchored producer (a start with no end) is refused instead of
 *      emitting half-substituted markup.
 *
 * The producer-side bytes are pinned by
 * `packages/compiler/__tests__/semantic-ir/generated-leaf.slot-anchors.test.ts`;
 * the end-to-end render is pinned by `slot-anchors-render.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import { substituteSlotAnchors } from '../src/internal/compiled/slot-anchors.ts';
import { markerText, slotAnchorMarker } from '../src/internal/compiled/runtime/markers.ts';

/**
 * One `<slot>` element carrying its anchor pair, exactly as the emitter writes
 * it: the slot element's open tag, then the start anchor, the fallback, the end
 * anchor and the slot's close tag.
 */
function anchored(name: string, ordinal: number, fallback = ''): string {
  const attributes = name === '' ? '' : ` name="${name}"`;
  return (
    `<slot${attributes}>` +
    '<!--' +
    markerText(slotAnchorMarker(ordinal, name)) +
    '-->' +
    fallback +
    '<!--' +
    markerText(slotAnchorMarker(ordinal, name, true)) +
    '-->' +
    `</slot>`
  );
}

describe('slot-anchor substitution — projection placement', () => {
  const named = anchored('header', 0);
  const fallback = anchored('body', 1, '<em>nothing</em>');
  const content = `<article data-x="1">${named}<p>between</p>${fallback}</article>`;

  test('a named projection replaces that slot interior and keeps the element', () => {
    const result = substituteSlotAnchors(content, new Map([['header', '<h1>T</h1>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    // The `<slot>` element survives; only its interior changed.
    expect(result.html).toContain('<slot name="header"><h1>T</h1></slot>');
    // The anchors are private: they never reach the document.
    expect(result.html).not.toContain('oe:s:');
    expect(result.html).not.toContain('oe:/s:');
    // The unprojected slot keeps its fallback.
    expect(result.html).toContain('<slot name="body"><em>nothing</em></slot>');
  });

  test('the default slot is named by the empty string', () => {
    const defaultOnly = `<div>${anchored('', 0)}</div>`;
    const result = substituteSlotAnchors(defaultOnly, new Map([['', '<p>body</p>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe('<div><slot><p>body</p></slot></div>');
  });

  test('both slots project in one pass, and each is consumed exactly once', () => {
    const result = substituteSlotAnchors(
      content,
      new Map([
        ['header', '<h1>T</h1>'],
        ['body', '<p>B</p>'],
      ]),
    );
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe(
      '<article data-x="1">' +
        '<slot name="header"><h1>T</h1></slot>' +
        '<p>between</p>' +
        '<slot name="body"><p>B</p></slot>' +
        '</article>',
    );
    expect([...result.consumed].sort()).toEqual(['body', 'header']);
  });

  test('no projection strips the anchors and preserves every fallback', () => {
    const result = substituteSlotAnchors(content, undefined);
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe(
      '<article data-x="1"><slot name="header"></slot><p>between</p>' +
        '<slot name="body"><em>nothing</em></slot></article>',
    );
    expect(result.html).not.toContain('oe:s:');
  });

  test('projected bytes are inserted verbatim (the caller escaped them)', () => {
    const escaped = '<b title="a&amp;b">&lt;x&gt;</b>';
    const result = substituteSlotAnchors(content, new Map([['header', escaped]]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toContain(escaped);
  });
});

describe('slot-anchor substitution — fail closed', () => {
  const content = `<div>${anchored('header', 0)}</div>`;

  test('a projection naming a slot the content lacks is refused', () => {
    const result = substituteSlotAnchors(content, new Map([['absent', '<i>x</i>']]));
    expect('path' in result).toBe(true);
    if (!('path' in result)) return;
    expect(result.path).toBe('projectedChildren');
    expect(result.message).toBe('light content targets missing slot "absent"');
  });

  test('a projection into content with no anchor at all is refused', () => {
    const result = substituteSlotAnchors('<p>plain</p>', new Map([['', '<b>x</b>']]));
    expect('path' in result).toBe(true);
    if (!('path' in result)) return;
    expect(result.path).toBe('projectedChildren');
    // The default slot is spelled the way a caller reads it.
    expect(result.message).toBe('light content targets missing slot "default"');
  });

  test('slotless content with no projection is byte-identical', () => {
    const plain = '<p class="x">untouched &amp; final</p>';
    const result = substituteSlotAnchors(plain, undefined);
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe(plain);
  });

  test('a start anchor with no closing marker is refused', () => {
    const dangling = `<!--${markerText(slotAnchorMarker(0, ''))}--><b>x</b>`;
    const result = substituteSlotAnchors(dangling, new Map([['', '<i>y</i>']]));
    expect('path' in result).toBe(true);
    if (!('path' in result)) return;
    expect(result.path).toBe('content');
    expect(result.message).toContain('has no closing marker');
  });

  test('a mismatched end anchor is refused instead of guessed', () => {
    const swapped =
      `<!--${markerText(slotAnchorMarker(0, 'a'))}-->` +
      `<!--${markerText(slotAnchorMarker(1, 'a', true))}-->`;
    const result = substituteSlotAnchors(swapped, new Map([['a', '<i>x</i>']]));
    expect('path' in result).toBe(true);
    if (!('path' in result)) return;
    expect(result.path).toBe('content');
    expect(result.message).toContain('does not close the innermost open anchor');
  });
});

describe('slot-anchor substitution — foreign markers', () => {
  test('range, when, each and text markers are copied through untouched', () => {
    const foreign =
      '<ul><!--oe:r:0--><li>a</li><!--oe:/r:0--></ul>' +
      '<!--oe:when--><b>on</b><!--oe:/when-->' +
      '<!--oe:each--><!--oe:k:s:61--><i>x</i><!--oe:/each-->' +
      '<!--oe:t:0-->t<!--oe:/t:0-->';
    const content = `<div>${foreign}${anchored('s', 0)}</div>`;
    const result = substituteSlotAnchors(content, new Map([['s', '<em>y</em>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe(`<div>${foreign}<slot name="s"><em>y</em></slot></div>`);
  });

  test('a non-anchor comment that merely starts like one is left alone', () => {
    // `oe:s:` followed by a non-canonical payload is not this family's marker;
    // the parser refuses it and the scan must not treat it as an anchor.
    const near = '<!--oe:s:not-an-ordinal-->';
    const content = `<div>${near}${anchored('', 0)}</div>`;
    const result = substituteSlotAnchors(content, new Map([['', '<b>z</b>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe(`<div>${near}<slot><b>z</b></slot></div>`);
  });
});

describe('slot-anchor substitution — non-ASCII and hostile names', () => {
  test('a non-ASCII name round-trips through the hex payload', () => {
    const content = `<div>${anchored('héader → 名', 0)}</div>`;
    const result = substituteSlotAnchors(content, new Map([['héader → 名', '<b>z</b>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toBe('<div><slot name="héader → 名"><b>z</b></slot></div>');
  });

  test('a name carrying ">" cannot terminate the comment early', () => {
    // `-->` inside a raw comment would end it; the hex payload makes that
    // impossible, which is why the name is not spliced as text.
    const hostile = 'x-->y';
    expect(markerText(slotAnchorMarker(0, hostile))).not.toContain('-->');
    const content = `<div>${anchored(hostile, 0)}</div>`;
    const result = substituteSlotAnchors(content, new Map([[hostile, '<b>z</b>']]));
    expect('path' in result).toBe(false);
    if ('path' in result) return;
    expect(result.html).toContain('<b>z</b>');
  });
});
