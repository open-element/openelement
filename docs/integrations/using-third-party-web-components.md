# Using Third-Party Web Components

The Universal WC qualification gate validates direct consumption of mature Web
Components libraries inside OpenElement apps. The pinned evidence targets are
Lit, Shoelace, Material Web, FAST Element 3.0.2, Ionic 8.8.18 as real
Stencil-compiled output, and a bare native custom element.

## Recommended Pattern

Use the component's standard tag directly in JSX:

```tsx
/** @jsxImportSource @openelement/element */

export function SettingsControls() {
  return (
    <section>
      <sl-switch on-sl-change={(event) => console.log(event)}>Enabled</sl-switch>
      <md-filled-button onClick={() => console.log('clicked')}>Save</md-filled-button>
    </section>
  );
}
```

Load the third-party library according to its SSR contract:

- SSR-safe modules can be imported from route modules when they do not touch
  `window`, `document`, `HTMLElement`, `customElements`, layout APIs, or browser
  storage at module evaluation time.
- Browser-only registration modules must be imported from client-only code or an
  island activation path.
- Route modules should render standards-compliant light DOM so SSG can preserve
  useful markup before the browser upgrades the custom element.

## SSR Behavior

openElement SSR/SSG preserves the third-party tag, attributes, children, and
slots. The browser upgrades the element after the library registers its custom
element class.

Declarative shadow DOM for third-party components is not automatic. It is only
part of the contract when the third-party library itself supports server-side
shadow rendering. Otherwise, light-DOM/client-upgrade fallback is expected.

## SSR-Safe Imports

Use this pattern when a library is safe to evaluate in Deno during SSG:

```tsx
/** @jsxImportSource @openelement/element */
import '@safe-wc/library/register.js';

export default function AccountCard() {
  return (
    <safe-account-card variant='compact'>
      <span slot='title'>Ada Lovelace</span>
    </safe-account-card>
  );
}
```

The route may import the registration module directly only if the package's
entry point avoids browser-only globals during module evaluation. If that is not
true, keep the tag markup in the route and move registration to the client.

## Client-Only Imports

Use this pattern for packages that require browser globals while importing:

```tsx
/** @jsxImportSource @openelement/element */

export default function SettingsRoute() {
  return (
    <section>
      <browser-only-picker value='system'>
        Theme
      </browser-only-picker>
      <script type='module' src='/client/register-browser-only-picker.js' />
    </section>
  );
}
```

```ts
// /client/register-browser-only-picker.js
if (typeof window !== 'undefined' && !customElements.get('browser-only-picker')) {
  await import('browser-only-picker/register.js');
}
```

For reusable app code, prefer a small island or client entry module over inline
scripts. The important boundary is the same: SSG renders the tag and light DOM;
the browser imports the registration module after page load.

## Properties And Events

- Primitive configuration should use attributes where the third-party component
  supports them.
- Boolean attributes serialize as standard boolean attributes.
- Complex object/array properties should use a `ref`, a small local wrapper, or
  the library's own setup API.
- Common DOM events use JSX-style names such as `onClick`.
- Dashed CustomEvent names use dashed props, such as `on-sl-change` for
  Shoelace's `sl-change`.

## Library Evidence

The qualification fixture verifies:

- Lit custom elements upgrade in an openElement page, render slots, and dispatch
  composed custom events.
- Shoelace components install, render, upgrade, and dispatch `sl-*` events.
- Material Web Components install, render, and upgrade inside the same app.
- openElement can contain a Lit element, and a Lit element can contain an
  openElement custom element.
- Browser-only custom element registration can be kept out of the SSG path.
- A FAST element preserves authored slot content, upgrades with its own shadow
  root, round-trips state, and emits a composed custom event.
- A real Stencil `dist-custom-elements` consumer (`ion-button`) requires an
  explicit `defineCustomElement()` registration, then upgrades, preserves light
  DOM, reflects a property, and participates in OpenElement event handling.

The current evidence is deliberately client-only for every foreign tag. That is
a supported interoperability path, not a claim that OpenElement server-renders
another library's shadow tree.

| Package kind                        | Metadata observed                   | SSR form               | Browser evidence                                       |
| ----------------------------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------ |
| OpenElement control                 | `openElement` island config         | DSD + client           | registered, upgraded, hydration-safe                   |
| Shoelace                            | Custom Elements Manifest            | light DOM, client-only | slots, properties, events, shadow upgrade              |
| Ionic / Stencil                     | Stencil collection manifest         | light DOM, client-only | explicit registration, property, event, shadow upgrade |
| Lit, Material, FAST fixture, native | no package CEM used by this fixture | light DOM, client-only | per-tag probes recorded in the corpus                  |

`null` in a corpus browser capability means the capability was not applicable
or not exercised for that tag. It is never converted to a passing `true`.

Run the fixture with:

```sh
deno task third-party-wc:smoke
```

The fixture source lives under `fixtures/third-party-web-components/` and is copied
into a fresh generated OpenElement app during the smoke run.
The same run prints the deterministic capability matrix to standard output so
CI can retain it as ordinary job output without committing generated evidence.
