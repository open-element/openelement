/** Block structure drift must fail closed while untampered SSR and fresh DOM agree. */

import { expect, test } from 'vitest';
import { ClaimErrorCode } from '@openelement/protocol/errors';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { PartProgramHydrationError } from '../../src/internal/compiled/runtime.ts';
import { parseHtml, TestDocument, TestElement } from '../compiled-runtime/test-dom.ts';
import {
  claimExisting,
  createFresh,
  eachHost,
  eachSiblingProgram as buildEachSiblingProgram,
  serializeSeed,
  serializeServer,
  whenHost,
  whenSiblingProgram as buildWhenSiblingProgram,
} from './hydrate-harness.ts';

const TAG_PREFIX = 'oe-a10v';
const whenSiblingProgram = () => buildWhenSiblingProgram(TAG_PREFIX);
const eachSiblingProgram = () => buildEachSiblingProgram(TAG_PREFIX);

test('claim fails closed when a static attr is REMOVED inside a when Block branch', () => {
  const program = whenSiblingProgram();
  const host = whenHost();
  const html = serializeServer(program, host);
  // SSR/fresh parity holds on the untampered payload.
  expect(serializeSeed(program, host)).toEqual(html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  createFresh(program, host, freshRoot as unknown as Node).dispose();
  expect(freshRoot.innerHTML).toEqual(html);

  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const span = root.childNodes[2] as TestElement;
  expect(span.getAttribute('title')).toEqual('static-on');
  span.removeAttribute('title'); // tamper: deletion, not value rewrite
  const error = assertThrowsIncludes(
    () => claimExisting(program, whenHost(), root as unknown as Node),
    PartProgramHydrationError,
  );
  expect(error.code).toBe(ClaimErrorCode.STRUCTURE_MISMATCH);
  expect(error.message).toContain('template[1].branch[0]');
});

test('claim fails closed when an unexpected attr is INJECTED into an each Block item', () => {
  const program = eachSiblingProgram();
  const host = eachHost();
  const html = serializeServer(program, host);
  expect(serializeSeed(program, host)).toEqual(html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  createFresh(program, host, freshRoot as unknown as Node).dispose();
  expect(freshRoot.innerHTML).toEqual(html);

  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const li = root.childNodes[3] as TestElement; // second keyed item
  li.setAttribute('data-injected', 'evil'); // tamper: injection, not rewrite
  const error = assertThrowsIncludes(
    () => claimExisting(program, eachHost(), root as unknown as Node),
    PartProgramHydrationError,
  );
  expect(error.code).toBe(ClaimErrorCode.STRUCTURE_MISMATCH);
  expect(error.message).toContain('template[1].item');
});

test('untampered SSR payload still claims with zero allocations (control)', () => {
  const program = eachSiblingProgram();
  const doc = new TestDocument();
  const root = parseHtml(doc, serializeServer(program, eachHost()));
  const before = { ...doc.counts };
  claimExisting(program, eachHost(), root as unknown as Node).dispose();
  expect({ ...doc.counts }, 'a clean claim must allocate nothing').toEqual(before);
});
