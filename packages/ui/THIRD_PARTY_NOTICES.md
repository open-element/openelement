# @openelement/ui — Third-Party Notices

This file is part of the published package tarball. It records the
third-party components redistributed inside `@openelement/ui` itself. The
repository-level inventory (vendored assets, fonts, Prism) lives in the
repository root `THIRD_PARTY_NOTICES.md`; package-level copies like this one
exist because a package tarball cannot reach repository-root files.

## None

`@openelement/ui` currently redistributes no third-party content. The token
sheet (`src/theme-tokens.ts`) is generated exclusively from the package's own
`src/theme-tokens.css` (@theme source, alpha9 C1): the shadcn role values were
adopted by value into a first-party source file and carry no upstream
tool output, and Tailwind is a pinned build-time devDependency whose compiler
never ships in the tarball. This file is kept (empty) so the tarball layout
and any future notice obligations have a stable home.
