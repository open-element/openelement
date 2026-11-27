# Changelog

## 1.0.0-alpha.16

Install the published Alpha16 starter with
`npm create @openelement@1.0.0-alpha.16 my-app` on Node.js 24.2 or newer.
[Release state](./docs/release/release-state.json)

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
- Router accepts JavaScript JSX alongside TypeScript TSX for compiled pages
  and islands. JavaScript authors can declare prop shapes with JSDoc.
- Local fixtures exercise the generated Nitro Node and Workers hosts, including
  public asset delivery, request isolation, and private artifact denial.
- The SaaS reference app supports workspace creation and single-use invitation
  codes. Private attachments pass through server-side reservation and scan
  checks. Disposable PostgreSQL and Chromium fixtures cover the local flows.

See the [compiler and element runtime](./docs/architecture/compiler-and-element-runtime.md)
for the current contract.
