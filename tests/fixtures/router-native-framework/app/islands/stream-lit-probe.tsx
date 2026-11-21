/**
 * stream-lit-probe — wiring island for the /stream-lit-proof route (#1451 T2).
 *
 * The island itself proves nothing about Lit; it exists so the generated
 * client entry loads a module that registers <stream-lit-pill> before (or as)
 * the streamed shell upgrades. It follows the third-party fixture's client
 * wiring: activation hooks dynamically import a client-only module, so the
 * Lit registration runs in the browser only. Its status paragraph is
 * CLIENT-rendered at island activation — a streamed deferred shell emits
 * islands as opaque empty hosts (the deferred executor admits no nested
 * renderer), so this paragraph is evidence that island hydration ran, never
 * evidence about shell survival; the shell-survival marker is the page's
 * #shell-marker, which the server-born shell carries.
 *
 * GENERATED lane (2026-11-21 Alpha16 closeout). `root: 'shadow'` keeps the class
 * lane's `shadow-open`: the spec locates the status paragraph THROUGH the page
 * host's shadow tree (`stream-lit-proof-page #lit-loader #lit-loader-status`),
 * so a light root would move the paragraph out of the tree it is read from.
 */
import { onConnect } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
});

export default function StreamLitProbe() {
  // The class spellings onDsdHydrated/onCsrRendered split one event (the island
  // is live) across the claim and fresh-creation paths; onConnect runs after
  // either, so importing here registers the Lit module exactly once per
  // document on both paths — ESM module evaluation is the dedupe, not a guard.
  //
  // onConnect is a connection hook: the SSR producer serializes the markup
  // without replaying it, so this import can only run in the browser even
  // though the server also evaluates this module for its DSD template.
  onConnect(() => {
    void import('../client/stream-lit-client.ts');
  });

  return <p id="lit-loader-status">lit pill loader armed</p>;
}
