---
status: active
topic: M09-2d bounded form association on the generated element
summary: The bounded generated-element form mechanism — sidecar formAssociated, declared value/required/disabled conventions, one shell-owned ElementInternals record shared with closed-root discovery, standard form callbacks and reset/restore, with the documented no-JS and host-access limits.
---

# M09-2d: bounded form association on the generated element

Date: 2026-11-14. Status: **bounded implemented — LOCAL review pending.**
Baseline: merged `main@7581fbf60` (event/ref + security docs). This is the
minimal form mechanism for the generated native element, **not** the M09 exit
and **not** full OpenInput migration parity.

This record corrects the pre-implementation `m09-2-design.md` §5 sketch in one
place: there is **no `formValue` field**. The existing declared string `value`
property is the form value source.

## Author setup

- Island sidecar: `formAssociated: true` (public boolean field, validated at
  runtime authoring and by the static scan, then re-read by the compiler lane
  like `root`/`delegatesFocus`). No closed-root author spelling exists.
- The root component's typed props declare `value: string`; the sidecar
  `properties` table declares it (normal attribute/reflection/default facts).
  The compiler requires that string property and refuses a missing/non-string
  one with `OEIR_GENERATED_ELEMENT_FORM_VALUE_UNSUPPORTED`.
- Optional declared boolean properties:
  - `required` enables the `required && value === '' → valueMissing` mirror;
  - `disabled` enables the fieldset-disabled effective state. It must not be
    declared `reflect: true` (the fieldset/authored state must stay reversible;
    the class path already writes the property, never the host attribute).
- Host `name` remains the platform submission name: the shell does not invent a
  name mapping. `value` is published from the declared property; no JSON/attribute
  wire is invented.
- No author lifecycle callbacks or `ElementInternals` access. A function
  component has no host `this`; the shell owns the standard APIs. The inner-input
  typing→host-value path is therefore **not** claimed by this slice (see
  "Host access gap").

## One internals owner

The closed-root discovery record (`root.ts`) is the ONE element-lifetime
`ElementInternals` record. Form association and closed discovery share it; the
shell lazily attaches once, and `ElementFormController` gains an internal
`attachWith(getInternals)` mode that consumes the record instead of calling
`attachInternals()` again. The class-path `attach(element, ctor)` is unchanged.
`static formAssociated = true` is installed on the returned constructor before
registration (the platform reads the static, not the descriptor).

A form-associated element must fail closed when the platform cannot provide
`attachInternals` or the one-shot channel was consumed elsewhere: the shell
throws the internal `OEIR_SHELL_FORM_INTERNALS_UNAVAILABLE` rather than claiming
form support. The browser negative covers both the missing and already-consumed
channel.

## Platform behavior

- `setFormValue`: published on connect and on every accepted `value`
  property/attribute write; the value is the declared string.
- `setValidity`: required + empty value → `{ valueMissing: true }` with the
  class path's fallback message; otherwise cleared. No generic validity policy,
  anchor, `File`/`FormData`, or multiple-entry mapping.
- `formResetCallback`: restores **only** the declared `value` property to its
  descriptor default (and its attribute mirror when the row has an attribute
  channel), then republishes/validates. It does not reset `required`, `disabled`,
  `name`, or other declared properties.
- `formStateRestoreCallback`: a string state is written to the declared value;
  `File`/`FormData` states are ignored (out of slice).
- `formDisabledCallback`: records the platform/ancestor-fieldset effective
  disabled state separately from the authored `disabled` property; the auth
  property is never overwritten by the callback. `disabled` and `invalid` custom
  states track the effective/authored state for the same styling hook the class
  component uses.
- `formAssociatedCallback`: class-parity no-op.
- Reconnect keeps the one internals record and the form value; no second attach.

## No-JS behavior (baseline preserved, not widened)

A form-associated custom element is associated only after the class is defined
and the shell attaches internals/publishes a value. Without JavaScript the SSR
host and DSD shadow markup render, but the host is not listed as a form control
and no value is submitted; the inner shadow control is not owned by the outer
form. This is the existing class-component baseline. This slice adds no hidden
native input, no light-DOM duplicate and no SSR form-value wire; a no-JS fallback
would be a separate progressive-enhancement contract (double-submit/removal,
SSR/claim bytes) and is not invented here.

## Host access gap (explicit non-claim)

The shell publishes the form value from the declared `value` property. A
generated function component's inline event handler can still reach the host
with standard DOM (`event.target.getRootNode().host` for a shadow root, or
`closest(tag)` for light DOM) and assign `host.value`; that pattern is a
documented prerequisite, not a framework API. First-class host/internals access
for custom validity/custom states and a fully official typing→value path remains
a required later slice. Full `open-input` typing/interaction migration is **not**
claimed.

## Scope and non-claims

- No `generate.ts`, class kernel/lane, UI source, router entry, or OpenInput
  source changes; the controller change is additive internal injection only.
- No closed root author spelling; a closed descriptor + form combination is
  exercised through the internal descriptor and the shared record.
- No generic validity policy, anchor, `File`/`FormData` values, author lifecycle
  callbacks, custom states beyond `invalid`/`disabled`, no-JS hidden-input
  fallback, or form SSR.
- One browser engine (Chromium), LOCAL evidence; bounded mechanism, not M09
  exit/release qualification.

## Evidence

- Compiler/descriptor contract:
  [`generated-element.forms.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.forms.test.ts)
  (sidecar/descriptor admission, no `formValue`, value/required/disabled gates,
  descriptor normalization, native static).
- Chromium vertical:
  [`generated-element.forms.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.forms.browser.test.ts)
  (FormData/property writes, required blocked submission + `:invalid`, reset
  value-only, string restore, fieldset-effective disabled vs author property,
  reuse/reconnect, closed-descriptor single attach, missing/consumed internals
  coded failure, no-JS static baseline).
- Controller injection / class-path preservation:
  `packages/element/__tests__/open-element-collaborators.test.ts`.
- Two-reader sidecar drift:
  `packages/router/__tests__/island-metadata-drift-guard.test.ts` (forms facts).
- Docs/scanner/authoring: router `authoring.test.ts`, `island-scanner.test.ts`.
- Full gates and existing class form conformance results are recorded in the
  outside implementation report.

## Seam

Registered in [`seams.md`](./seams.md) as "Generated-element form association
and value publication (M09-2d)".
