/**
 * @openelement/ui - openElement UI Component Library
 *
 * Swiss International Style: minimal, typography-driven, violet brand accent.
 * Zero Lit dependency - built on openElement (native HTMLElement).
 *
 * Components:
 * - open-button: Button with variants (default, primary, ghost, accent)
 * - open-card: Card container with optional header/footer
 * - open-input: Input field with label and error states
 * - open-code-block: Code block with copy button
 * - open-badge: Open Props status badge
 * - open-theme-toggle: Theme toggle Island (Dark/Light)
 * - open-dialog: Dialog component using native <dialog>
 * - open-callout: Callout/notice box (info/warning/danger/tip)
 * - open-dropdown: Dropdown toggle with trigger slot and content slot
 * - open-tabs: Tab interface with tab and panel slots
 *
 * Usage:
 * ```ts
 * // Import all components
 * import { registerOpenUi } from '@openelement/ui';
 * registerOpenUi();
 *
 * // Or import specific components
 * import { OpenButton } from '@openelement/ui/open-button';
 * ```
 *
 * @module @openelement/ui
 */

// Design tokens (CSSStyleSheet, zero Lit dependency)
export { openPropsRootSheet, openPropsTokenSheet } from './open-props-tokens.ts';

// Components
export { OpenButton } from './open-button.tsx';
export { OpenCard } from './open-card.tsx';
export { OpenInput } from './open-input.tsx';
export { OpenCodeBlock } from './open-code-block.tsx';
export { OpenBadge } from './open-badge.tsx';
export { OpenThemeToggle } from './open-theme-toggle.tsx';
export { OpenDialog } from './open-dialog.tsx';
export { OpenCallout } from './open-callout.tsx';
export { OpenDropdown } from './open-dropdown.tsx';
export { OpenTabs } from './open-tabs.tsx';

// Package manifest (WC Package Protocol)
// Consumers (adapter-vite) read manifest.declarations to derive island metadata.
export { manifest } from './manifest.ts';
export { registerOpenUi } from './register.ts';
