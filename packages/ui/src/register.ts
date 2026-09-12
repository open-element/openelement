import { OpenBadge } from './open-badge.tsx';
import { OpenButton } from './open-button.tsx';
import { OpenCallout } from './open-callout.tsx';
import { OpenCard } from './open-card.tsx';
import { OpenCodeBlock } from './open-code-block.tsx';
import { OpenDialog } from './open-dialog.tsx';
import { OpenDropdown } from './open-dropdown.tsx';
import { OpenInput } from './open-input.tsx';
import { OpenTabs } from './open-tabs.tsx';
import { OpenThemeToggle } from './open-theme-toggle.tsx';

// v0.44: compiled modules carry no runtime tagName export (the compiled
// program owns the tag), so the registration table lives here, beside the
// class imports. Keep aligned with manifest.declarations order.
const COMPONENTS: ReadonlyArray<readonly [string, CustomElementConstructor]> = [
  ['open-card', OpenCard],
  ['open-callout', OpenCallout],
  ['open-button', OpenButton],
  ['open-input', OpenInput],
  ['open-theme-toggle', OpenThemeToggle],
  ['open-code-block', OpenCodeBlock],
  ['open-badge', OpenBadge],
  ['open-dialog', OpenDialog],
  ['open-dropdown', OpenDropdown],
  ['open-tabs', OpenTabs],
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
