/**
 * @openelement/ui - openElement UI Component Library
 *
 * Minimal, typography-driven components with a violet brand accent, themed
 * by the @theme role table (`theme.css`; see CUSTOMIZATION.md for the parts
 * and value-delivery contracts). Zero Lit dependency - built on openElement
 * (native HTMLElement).
 *
 * Components (frozen roster, owner ruling 2026-10-07 — #1557 retired the four
 * zero-interaction components open-badge/open-callout/open-card/open-tabs to
 * plain HTML+CSS recipes documented in the create starter template):
 * - open-button: Button with variants (default, primary, ghost, accent)
 * * - open-input: Input field with label and error states
 * - open-code-block: Code block with copy button
 * * - open-theme-toggle: Theme toggle Island (Dark/Light)
 * - open-dialog: Dialog component using native <dialog>
 * * - open-dropdown: Dropdown toggle with trigger slot and content slot
 * *
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

// Per-instance mutable state for compiled classes (host-scoped, garbage-
// collected with the host; a side-effect-free module — import the
// './instance-state' subpath from islands to keep chunks minimal).
export { readInstanceState, writeInstanceState } from './instance-state.ts';

// Components
export { OpenButton } from './open-button.tsx';
export { OpenInput } from './open-input.tsx';
export { OpenCodeBlock } from './open-code-block.tsx';
export { OpenThemeToggle } from './open-theme-toggle.tsx';
export { OpenDialog } from './open-dialog.tsx';
export { OpenDropdown } from './open-dropdown.tsx';

// Package manifest (WC Package Protocol)
// Consumers (the router build) read manifest.declarations to derive island metadata.
export { manifest } from './manifest.ts';
export { registerOpenUi } from './register.ts';
