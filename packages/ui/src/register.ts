import { OpenButton } from './open-button.tsx';
import { OpenCodeBlock } from './open-code-block.tsx';
import { OpenDialog } from './open-dialog.tsx';
import { OpenDropdown } from './open-dropdown.tsx';
import { OpenInput } from './open-input.tsx';
import { OpenThemeToggle } from './open-theme-toggle.tsx';

// Compiled modules carry no runtime tagName export (the compiled
// program owns the tag), so the registration table lives here, beside the
// class imports. Keep aligned with manifest.declarations order.
const COMPONENTS: ReadonlyArray<readonly [string, CustomElementConstructor]> = [
  ['open-button', OpenButton],
  ['open-input', OpenInput],
  ['open-theme-toggle', OpenThemeToggle],
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
