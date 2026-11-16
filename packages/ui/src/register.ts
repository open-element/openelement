import { OpenButton } from './open-button.tsx';
import { OpenCodeBlock } from './open-code-block.tsx';
import { OpenDialog } from './open-dialog.tsx';
import { OpenDropdown } from './open-dropdown.tsx';
import { OpenInput } from './open-input.tsx';

// Compiled modules carry no runtime tagName export (the compiled
// program owns the tag), so the registration table lives here, beside the
// class imports. Keep aligned with manifest.declarations order.
//
// A component authored as a function component has no class to register: the
// build emits its element class from the manifest declaration and the island
// entry defines it. `open-theme-toggle` is the first such component, so it is
// deliberately absent from this table.
const COMPONENTS: ReadonlyArray<readonly [string, CustomElementConstructor]> = [
  ['open-button', OpenButton],
  ['open-input', OpenInput],
  ['open-code-block', OpenCodeBlock],
  ['open-dialog', OpenDialog],
  ['open-dropdown', OpenDropdown],
];

/** Explicitly register every first-party UI element. Safe to call repeatedly. */
export function registerOpenUi(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
): void {
  if (!registry) return;
  for (const [tagName, constructor] of COMPONENTS) {
    if (!registry.get(tagName)) registry.define(tagName, constructor);
  }
}
