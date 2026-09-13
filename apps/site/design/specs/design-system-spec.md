# Design System Page Spec

## Purpose

The design-system page documents the active dark-first Web Standards Lab rules.
It is a live implementation contract for `www`, not a gallery or moodboard.

## Required Sections

1. Web Standards Lab hero and rule panel.
2. Token contract with semantic roles and Open Props scales.
3. UI package primitives: `open-button`, `open-card`, `open-badge`,
   `open-lab-panel`, `open-lab-stage`, `open-standards-visual`.
4. Standards visual examples: route graph, package graph, token board.
5. Layout principles and QA acceptance notes.

## Visual Rules

- Show actual UI primitives, not local mock components.
- Every swatch or token example is expressed as a token name.
- Dark is the primary brand composition; light is the complete daylight mode.
- Typography uses fixed token steps, never viewport-scaled font sizes.
- Kinetic examples must respect `prefers-reduced-motion`.
- Site-only cinematic visuals remain in `www`; only proven generic primitives
  belong in `@openelement/ui`.
