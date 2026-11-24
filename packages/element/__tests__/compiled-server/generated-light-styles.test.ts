/**
 * #1800 (alpha16 closeout) — a LIGHT-root generated element's declared sheets
 * reach the DOCUMENT.
 *
 * Before this slice the chain stopped one link short: the client build emitted
 * the `.css` asset and recorded its URL per delivered tag
 * (`island-style-declarations.ts` / `island-style-build-assets.ts`), but the
 * generated render path never declared it, so the island rendered unstyled and
 * nothing failed. The class lane's light root already delivered its sheets this
 * way (`documentStyleResourcesOf`), so this is the generated lane catching up to
 * one rule, not a second mechanism.
 *
 * Two properties are pinned here: the URLs reach the render's document sink, and
 * the "declared but no carrier" state stays a LOUD failure rather than an
 * unstyled render.
 */
import { afterEach, expect, test } from 'vitest';
import {
  __setRequestTimeStyleSheetUrls,
  requestTimeIslandStyleLinks,
} from '../../src/internal/compiled/server/style-links.ts';

afterEach(() => {
  __setRequestTimeStyleSheetUrls([], null);
});

test('the island channel carries per-tag URLs for a light root too', () => {
  __setRequestTimeStyleSheetUrls([], [['x-light', ['/client/assets/light.css']]]);
  expect(requestTimeIslandStyleLinks('x-light')).toEqual(['/client/assets/light.css']);
  // An island that declares nothing stays undefined: absence is not a failure.
  expect(requestTimeIslandStyleLinks('x-plain')).toBeUndefined();
});

test('a declared-but-unavailable carrier is the explicit null state', () => {
  // `null` is how the channel spells "declared, assets not emitted yet" — the
  // render must fail closed on it (the comment on the setter is the contract).
  __setRequestTimeStyleSheetUrls([], [['x-light', null]]);
  expect(requestTimeIslandStyleLinks('x-light')).toBeNull();
});
