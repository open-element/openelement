/**
 * visible-probe — client:visible island for the #606 e2e.
 *
 * The /visible-probe page puts a 5000px spacer before it, so the island module
 * may only evaluate after the reader scrolls the host into view. `data-hydrated`
 * is set from the compiled claim path, so the spec observes real hydration
 * (not just a network prefetch).
 */
import { onConnect, useHost } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'visible',
  ssr: true,
  dsd: true,
  // The class lane declared `shadow-open`, and the spec asserts the island sits
  // inside the PAGE's shadow root while its own marker is claimed in place; a
  // light root would move the marker into the page tree.
  root: 'shadow',
});

export default function VisibleProbe() {
  const host = useHost();
  // Both class hooks (onDsdHydrated for the claim path, onCsrRendered for the
  // fresh-creation path) collapse into this one connect callback: the generated
  // lane runs it after either activation, which is the same moment the class
  // lane had two spellings for.
  onConnect(() => {
    host.setAttribute('data-hydrated', '1');
  });

  return <span id='visible-probe-marker'>probe</span>;
}
