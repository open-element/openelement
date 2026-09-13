# WWW page architecture

The WWW has three deliberate densities. The home page is the long-form
cinematic proof. Entry pages use a short technical, editorial, timeline, or
error scene followed by quiet evidence. Guides and articles use the reading
shell: a 740px measure, stable rail, 1.7 line height, explicit code frames and
an unambiguous next step.

`open-page-hero`, `open-reading-shell`, `open-section-frame`,
`open-page-rail`, and `open-artifact-panel` are WWW-only structure. Product
packages must not export them. Page authors provide facts and real technical
artifacts through slots; they do not duplicate navigation, scroll coordination,
glass panels, hero geometry, table-of-contents treatment, or reading pagination.

Every current page selects one of four hero variants: `technical`, `editorial`,
`timeline`, or `error`. Guides and Architecture reference pages use a rail; the
rail has an HTML overview fallback, a narrow-screen disclosure, and an
enhanced current-section state. Guide shells declare their adjacent previous
and next destinations rather than reimplementing footer navigation.

Dark is the reference mode; light is the violet daylight equivalent. Motion is
limited to View Transitions and small scene reveals away from the homepage.
Reduced-motion renders the completed composition without timing-dependent
content. Historical blog and changelog text is preserved verbatim while being
placed in the same reading shell.
