/**
 * One safe-attribute-name predicate (#1033).
 *
 * The canonical implementation lives in internal/protocol/forbidden-sinks.ts;
 * every admitting boundary — the SSR security face (security.ts, re-exported
 * through the package root and /authoring) and the compiler semantic core
 * (analyze-module.ts) — delegates to it, so the exported faces cannot
 * diverge on which attribute names are admissible.
 *
 * Behavior contract enforced here (fail-closed on every face):
 * - valid HTML attribute-name grammar only (blocks quote/space/`=``>` injection, #602);
 * - no `on*` event-handler prefix, case-insensitive;
 * - no forbidden-sink name (`innerhtml`/`srcdoc`), case-insensitive — the
 *   sinks are admissible only through the dedicated trusted-HTML `html` Part,
 *   never as a plain attribute name.
 */

import { expect, test } from 'vitest';
import { isSafeAttributeName as securityFace } from '../src/internal/core/security.ts';
import { isSafeAttributeName as compilerFace } from '../../../packages/compiler/src/internal/compiler/semantic-core/analyze-module.ts';
import { isSafeAttributeName as canonical } from '@openelement/protocol/forbidden-sinks';
// The exact binding the router head-injection path imports
// (`@openelement/element/authoring`), so the head channel's fail-closed
// rejection is pinned at the seam the router actually consumes.
import { isSafeAttributeName as authoringFace } from '../src/authoring.ts';

const FACES: Array<[string, (name: string) => boolean]> = [
  ['canonical (forbidden-sinks)', canonical],
  ['security.ts (SSR / head-injection via /authoring)', securityFace],
  ['analyze-module.ts (compiler)', compilerFace],
  ['authoring.ts re-export (router import seam)', authoringFace],
];

const ACCEPTED = [
  'href',
  'data-id',
  'aria-label',
  'xml:lang',
  'xlink:href',
  'data:x-tra',
  'flag',
  'integrity',
  'http-equiv',
  'a',
  '_private',
  ':namespaced',
];

const REJECTED = [
  // Grammar violations (quote/space/equals injection, #602).
  '',
  'has space',
  'name=description',
  'foo onload=alert(1)',
  'na"me',
  "na'me",
  'a/b',
  'a>b',
  '1abc',
  '-leading',
  '.leading',
  // Event handlers, case-insensitive.
  'onclick',
  'ONLOAD',
  'onMouseDown',
  'onauxclick',
  // Forbidden sinks, case-insensitive.
  'innerhtml',
  'InnerHTML',
  'INNERHTML',
  'srcdoc',
  'SRCDOC',
  'SrcDoc',
];

test('every attribute-name face accepts the same grammar-valid names', () => {
  for (const [label, face] of FACES) {
    for (const name of ACCEPTED) {
      expect(face(name), `${label} must accept ${JSON.stringify(name)}`).toEqual(true);
    }
  }
});

test('every attribute-name face rejects the same unsafe names (parity)', () => {
  for (const [label, face] of FACES) {
    for (const name of REJECTED) {
      expect(face(name), `${label} must reject ${JSON.stringify(name)}`).toEqual(false);
    }
  }
});
