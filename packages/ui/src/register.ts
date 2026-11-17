/**
 * @openelement/ui - explicit registration
 *
 * Every first-party UI element is now authored as a function component: the
 * build emits each element class from the manifest declaration and the island
 * entry defines it. The class registration table this module used to carry is
 * therefore empty — `open-button` was the last entry, and it migrated to the
 * generated lane after `open-input`.
 *
 * The function stays: it is a published API (`registerOpenUi`), callers may
 * invoke it repeatedly, and a future class-authored component joins by adding
 * one row here. Removing the export is a P5 retirement decision, not a
 * migration side effect.
 */

/** Explicitly register every class-authored first-party UI element. */
export function registerOpenUi(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry) return;
  // No class-authored components remain (see the module doc comment).
}
