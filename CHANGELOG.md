# Changelog

## 1.0.0-alpha.16

This entry records the release candidate. The release state below tracks npm availability.

- Function components power compiled native custom elements and server-rendered
  pages. Generated elements manage local `signal` and `computed` state, keyed
  lists, and retained DOM during claim and updates.
- Generated owners support lifecycle callbacks, context, native element refs,
  host access, and error handling. A client error handler works within its
  existing owner scope. Server rendering can report a failed nested expansion
  through `onNestedFailure` and keep rendering siblings.
- Generated custom elements support Declarative Shadow DOM, light and shadow
  stylesheets, Custom Elements Manifest output, and form participation through
  `ElementInternals`.
- The starter uses server function pages, a generated layout, and a stateful
  counter island. The packed consumer qualification covers the authored Board's
  keyed identity, pre-upgrade input, focus, selection, and cleanup in Chromium,
  Firefox, and WebKit.

See the [compiler and element runtime](./docs/architecture/compiler-and-element-runtime.md)
for the current contract and the [release state](./docs/release/release-state.json)
for the versions on npm.
