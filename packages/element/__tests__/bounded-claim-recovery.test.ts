/**
 * Bounded claim recovery: a light root with authored formatting (#1381).
 *
 * The kernel chose claim-vs-fresh purely on `root.childNodes.length > 0`, so a
 * compiled light-root element legitimately carrying a whitespace-only text
 * node — `<my-el>\n</my-el>`, the shape an HTML formatter or a parsed file
 * produces — threw `PartProgramClaimError` on upgrade. No compiled template
 * begins with a bare newline, so the claim walked into a mismatch that the
 * author could not see and could not fix: the node is invisible in the
 * rendered page.
 *
 * The decision is now content-aware, and these cases pin BOTH directions of
 * that change:
 *
 *   - formatting whitespace mounts fresh, and the whitespace is gone (it must
 *     not survive as a stray first child of the rendered output);
 *   - real content still fails closed. An element, a serializer anchor
 *     comment, or visible authored text keeps the claim path, so a genuine
 *     SSR/claim mismatch is still a structured, catchable error rather than a
 *     silent clear-and-render fallback. That direction is the one that would
 *     be a correctness regression if this heuristic were ever widened.
 *
 * The DOM harness installs browser globals before the package is imported.
 */

import { expect, test } from 'vitest';
import {
  FacadeEvent,
  installFacadeDom,
  mountSerialized,
  toHtml,
} from './compiled-runtime/facade-dom.ts';
import { testProgram } from './compiled-runtime/test-program.ts';
import { defineLightCounter, makeUniqueTag } from './compiled-runtime/light-counter-harness.ts';

const dom = installFacadeDom();

const { OpenElement, renderDsd } = await import('@openelement/element');
const { PartProgramClaimError } = await import('../src/internal/compiled/runtime.ts');

const uniqueTag = makeUniqueTag('bounded');
const lightCounterDeps = { OpenElement, testProgram, registry: dom.registry };

test('#1381: a light root holding only a formatting newline mounts fresh', () => {
  const tag = uniqueTag('newline');
  const ctor = defineLightCounter(lightCounterDeps, tag);
  void ctor;

  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('count', '2');
  // The authored shape: the host's closing tag on its own line.
  el.appendChild(dom.document.createTextNode('\n  '));

  // The upgrade must not throw, and it must not leave the formatting newline
  // in front of the rendered tree.
  dom.document.body.appendChild(el);
  expect(toHtml(el)).toEqual(
    `<${tag} count="2"><button type="button">count: <!--oe:p0-->2</button></${tag}>`,
  );
  expect(
    (el.childNodes[0] as AnyElement).tagName?.toLowerCase() === 'button',
    'the rendered button is the first child',
  ).toBeTruthy();
});

test('#1381: indentation, tabs and mixed whitespace are all formatting', () => {
  const whitespace = ['', ' ', '\n', '\t', '\n\t  \n   ', '   \r\n '];
  for (const text of whitespace) {
    const tag = uniqueTag('ws');
    defineLightCounter(lightCounterDeps, tag);
    const el = dom.document.createElement(tag) as AnyElement;
    el.appendChild(dom.document.createTextNode(text));
    dom.document.body.appendChild(el);
    expect(toHtml(el), `whitespace ${JSON.stringify(text)} must be treated as formatting`).toEqual(
      `<${tag}><button type="button">count: <!--oe:p0-->0</button></${tag}>`,
    );
  }
});

test('#1381: an element in the light root still fails closed as a claim mismatch', () => {
  const tag = uniqueTag('element-drift');
  defineLightCounter(lightCounterDeps, tag);
  const el = dom.document.createElement(tag) as AnyElement;
  // Real content that the compiled template cannot match: the template's root
  // is a <button>, so a <div> is structural drift, not formatting.
  el.appendChild(dom.document.createElement('div'));

  let thrown: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof PartProgramClaimError,
    'real content must still fail closed',
  ).toBeTruthy();
  expect((thrown as Error).message).toContain('[compiled-claim]');
});

test('#1381: a serializer anchor comment still fails closed', () => {
  const tag = uniqueTag('comment-drift');
  defineLightCounter(lightCounterDeps, tag);
  const el = dom.document.createElement(tag) as AnyElement;
  // The serializer's dynamic anchors are comments, so a comment IS content.
  // A stray one is drift the claim must report, never formatting to drop.
  el.appendChild(dom.document.createComment('oe:p0'));

  let thrown: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (error) {
    thrown = error;
  }
  expect(thrown instanceof PartProgramClaimError, 'an anchor comment is content').toBeTruthy();
});

test('#1381: visible authored text still fails closed', () => {
  const tag = uniqueTag('text-drift');
  defineLightCounter(lightCounterDeps, tag);
  const el = dom.document.createElement(tag) as AnyElement;
  el.appendChild(dom.document.createTextNode('stray prose'));

  let thrown: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof PartProgramClaimError,
    'visible text is content, not formatting',
  ).toBeTruthy();
});

test('#1381: whitespace before real content does not rescue the claim', () => {
  const tag = uniqueTag('mixed-drift');
  defineLightCounter(lightCounterDeps, tag);
  const el = dom.document.createElement(tag) as AnyElement;
  // The exact shape the fix must not over-permit: formatting whitespace AND
  // real content. The whitespace is not stripped here, because the root
  // already has content and the claim owns the mismatch report.
  el.appendChild(dom.document.createTextNode('\n  '));
  el.appendChild(dom.document.createElement('div'));

  let thrown: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof PartProgramClaimError,
    'whitespace must not mask real drift',
  ).toBeTruthy();
});

test('#1381: a serialized light host still claims in place (no regression)', () => {
  const tag = uniqueTag('ssr');
  const ctor = defineLightCounter(lightCounterDeps, tag);
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 3 } }).html;

  let button: AnyElement | undefined;
  let countText: AnyElement | undefined;
  const el = mountSerialized(dom, html, (host) => {
    button = host.childNodes[0];
    countText = button.childNodes[2];
  }) as AnyElement;

  // The content-aware decision must not turn a real claim into a fresh mount:
  // server node identity survives, so activation stays O(claimed) rather than
  // discarding and rebuilding the whole subtree.
  expect(el.childNodes[0], 'the SSR button is claimed, not replaced').toBe(button);
  expect(button.childNodes[2], 'the SSR text node is claimed').toBe(countText);
  expect(el.count).toEqual(3);
  button.dispatchEvent(new FacadeEvent('click'));
  expect(el.count).toEqual(4);
  expect(countText.data).toEqual('4');
});
