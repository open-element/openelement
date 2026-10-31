---
title: 'Alpha16–18: from CE-centered components to function composition'
date: '2026-10-31'
lang: 'en'
tags: ['roadmap', 'architecture', 'alpha']
excerpt: 'Function JSX and Signals, stateful composition without extra hosts, and explicit native boundaries: the planned sequence for compilation, component authoring, and deferred delivery.'
---

OpenElement's next component model will use function JSX and Signals so that
components can encapsulate their own state and subscriptions without adding a
DOM host for every piece of business UI. Custom Elements remain a first-class
export for native properties and events, slots, Shadow DOM, form association,
and cross-framework use. Alpha16–18 will address compilation and safe delivery,
component authoring, and asynchronous content delivery in that order.

These are **planned capabilities, not released features**. API spellings and
contracts still need implementation and validation. This roadmap makes no fixed
release-date or new performance-number promise.

## How authoring will change

This excerpt comes from the current
[`compiled-element-v2/counter.tsx` fixture](https://github.com/open-element/openelement/blob/main/packages/element/__fixtures__/compiled-element-v2/counter.tsx).
It retains the property, method and button; styles and the list are omitted.
The existing button displays `+`, not the count. This excerpt was not separately
recompiled for this article.

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('oe-program-counter')
export class ProgramCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  increment(): void {
    this.count++;
  }

  render() {
    return <button type='button' onClick={this.increment}>+</button>;
  }
}
```

The proposed internal-component form below shows local state only, and displays
the count. `component(...)` is an **unreleased candidate**, not an API available
today; this example has not been claimed to compile. Property reflection from
the old example must be provided by the formal CE export. These snippets are
not proof of equivalent UI output or equivalent native-platform capabilities.

```tsx
// Target API, not released or validated as compiling code.
const Counter = component(() => {
  const count = signal(0);
  return (
    <button type='button' onClick={() => count.value++}>
      {count.value}
    </button>
  );
});
```

Authors will be able to keep drafts, expanded state and subscriptions inside a
component while the framework manages cleanup. Existing class users will not
need to rewrite immediately. OpenElement does not currently support React
Hooks; the new model keeps Signals and does not introduce a Hooks or React
ecosystem compatibility layer. Specific names and types still need validation.

## What the current architecture provides

OpenElement already has a compiled component foundation. The build transforms
TSX into a versioned Part Program containing static structure, dynamic locations
and identity information. The server serializes HTML from it; the browser
executor creates nodes, claims existing DOM, establishes reactive bindings and
cleans up resources.

Interactive components center on `OpenElement extends HTMLElement`. An element
instance owns a root, program instance, subscriptions and cleanup scope. That
aligns Custom Element platform identity with framework instances and gives DSD,
native properties and cross-framework use a clear boundary. CE connection
callbacks do not replace resource scopes: internal conditions, lists and tasks
already require lifetime management. That existing responsibility is not all a
new cost of hostless components.

The browser still reads program structure and establishes bindings by Part type.
The compiler locates dynamic positions ahead of time, so runtime does not have
to rediscover them; the executor nevertheless understands Part Program
structure and semantics. Direct DOM Codegen must replace real execution work
while preserving claim, pre-activation events, styles, error recovery and cleanup.

## Internal composition needs a boundary other than an element

[ADR-0143](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0143-0-44-compiled-element-model-reentry.md)
sets the CE class model and gives the element ownership of Parts, structure,
subscriptions and cleanup.

That is useful for independently distributed native elements. Inside an
application, extra hosts, element registration and property/attribute mapping
can make ordinary UI decomposition more expensive. Multiple adjacent roots or
empty output also do not naturally fit an element-per-instance assumption.

We plan to use function components for internal composition without an extra
host by default. Native slots, Shadow DOM, property reflection, form association
and cross-framework use will have explicit Custom Element exports. Initial
island roots will retain the current CE activation boundary.

The framework must connect logical instances to DOM regions: removing a branch
releases its subtree, keyed moves preserve identity and state, and Children
insertion has one cleanup owner. Authors will still compose through props and
children rather than managing these ownership details themselves.

[ADR-0173: Component execution and composition](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0173-component-execution-and-composition.md)
formally accepts the direction and amends the exclusive CE/class constraint in ADR-0143 while retaining claim fidelity,
native interoperability and independent-consumer requirements. New functions
and compatible old classes will share a backend and Signals; reflection,
forms, Context and connection behavior still need individual adaptation tests.

## Shared semantics do not require one executable program

[ADR-0148](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0148-compiler-semantic-core-vite-integration-boundary.md)
separates the semantic core from Vite integration and requires deterministic,
serializable, versioned compiler/runtime artifacts. One program made sharing
structure across SSR, browser creation and claim convenient, but also bound
browser execution to that format.

Alpha16 will generate browser modules for mount, claim, update and dispose,
with three distinct contracts:

- **Compile-time structure:** analysis, lowering and generation information,
  not necessarily delivered to the browser.
- **Generated-module ABI:** calls between generated code and small shared helpers.
- **HTML and data wire:** DOM location markers, permitted initial data,
  resources and build identity.

Servers can keep serialization paths that suit their work; browsers can receive
component-specific code. Identity matching, Signals, events, regions and cleanup
may still use shared helpers. Their cost and generated-code cost must both be
counted in the page's reachable closure.

[ADR-0174: Generated code, shared runtime and compatibility](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0174-generated-code-runtime-and-compatibility.md)
formally accepts the direction and amends the single-serializable-artifact constraint while preserving the one-way
semantic-core/integration boundary. Principle P2 now describes necessary
runtime responsibility and measurement; implementation and qualification remain pending. The no-runtime-JSX-fallback requirement
remains; the old generic client execution path retires only after coverage and
qualification. Codegen is not a claim of inherently smaller or faster output.

## Extend the server functions that already exist

OpenElement already has server-function composition. The current compiler
rejects async declarations on that path and requires a single JSX return.
Ordinary local calculations and data-in-place rendering are consequently
restricted, with asynchronous data prepared in loaders.

Alpha16 will extend that existing path with local calculations, async execution
and cross-module composition. Full-await comes first: finish the work, then
deliver HTML. Interactive component setup will remain synchronous initially.

Evaluation timing needs runnable examples: which expressions execute during SSR,
mount, claim and update; whether an inactive or exited conditional branch owns
active subscriptions; and which boundary cleans up after failure. Unknown JSX
helpers, dynamic components and nonserializable cross-end values will still
have explicit restrictions. This builds on TSX, `definePage` and the layout
convention, without silently changing published class behavior.

## Safe delivery still needs structural separation

[ADR-0171](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0171-private-artifact-static-boundary.md)
records today's private-artifact protection: static delivery rejects the server
artifact namespace and accounts for decoding, case and realpath, with explicit
host coverage and remaining limits.

Alpha16 will further separate the public root from private server output and
use a publish manifest to define the allowed-public file set. Each host must
perform runtime validation or packaging/upload filtering rather than relying
on an operator to exclude private directories manually. This will first amend
ADR-0171. Removing `/client/` from URLs is an independent Alpha17 migration;
Alpha16 directory safety does not wait for it. A manifest is not a proof of HTML
safety, serialization safety or application authorization.

## Function components keep Signals

The proposed model is setup-once per client instance. Later props or signal
changes update the relevant bindings and structures. SSR and client claim
create separate instances. State uses explicit `.value` reads and writes;
ordinary local variables and destructuring keep JavaScript semantics.

Functions, JSX, props and children provide familiar composition, not React
execution semantics or a React Hooks compatibility promise.

Connection lifetime and instance lifetime are separate internally. Reconnection
may establish subscriptions again only after the old ones have been released.
Same-owner keyed moves preserve framework instance state, without promising
that third-party CEs receive no native connection callbacks.

`onConnect` is an **unreleased candidate** for connection lifetime: run when DOM
and refs are ready and connected; allow a returned cleanup; do not run during
SSR. Reconnecting the same instance may run the callback again, not setup. It
is neither a visibility callback nor a layout effect after every DOM update,
and does not globally change existing `effect()` timing.

CSS hiding while still mounted keeps the instance and subscriptions. An
inactive conditional branch has no instance; exit disposes it, and re-entry
creates a new instance. There is no implicit keep-alive in the first version.
Claim must avoid accidental repeat client setup or duplicate active
subscriptions; bounded recovery must clean up before rebuilding.

The recommended path still needs real author examples, type checks, source
locations, mixed old/new use and full-page comparison. Existing class users
will not have to rewrite immediately.

## Component packages must leave the monorepo

Running a library inside its workspace does not prove distribution. A fresh
application must install only a tarball and consume server/client entries, props
types, CSS, component identity and compatibility metadata correctly.

The formal implementation slice starts with library-side precompilation; the
application selects entries, links resources and bundles them. The first
version supports one validated distribution mode, not arbitrary dependency TSX
recompilation. Two physical runtime or Signals copies crossing ownership
boundaries must deduplicate or reject clearly: matching version numbers do not
prove a single instance.

A precompiled-component distribution contract will follow this independent
consumer slice. Metadata and version ranges are not frozen; the public API
needs complete qualification. Internal module consumption and native CE exports
have distinct requirements.

## Why component streaming follows in Alpha18

Existing route/field streaming is not new component-level defer.
[ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md)
already defines admission, HTTP commitment, bounded queues, backpressure,
cancellation and deployment evidence.

Component defer adds subtree identity, resource readiness and DOM-write
ownership. Old navigation results must not overwrite a new page; delayed
fragments must not activate without styles or with the wrong version, or own
the same region as navigation morph.

We will stabilize the backend and component identity first. The existing ADR
will gain finite concurrency, queued/cumulative tasks, buffered bytes, depth,
deadlines and host-capacity policies; material protocol changes will get a
successor record. Cancellation controls framework scheduling, held resources
and stale-result isolation, not guaranteed immediate termination of arbitrary
user Promises or external services. Full-await fallback also obeys output and
time limits.

Deployment measurements must include proxy buffering, first useful content,
server residence and peak memory. Paths without correctness or benefit evidence
will not be enabled by default. Existing streaming channels remain maintained
and regression-tested.

## Validate the chosen architecture in formal slices

The first slices reuse one list and existing infrastructure: hostless rows with
private drafts, reordering, deletion, conditions and multiple/empty roots;
the same list through SSR, claim, update and disposal with local mismatches and
cleanup failures; then its components precompiled into a package consumed by a
fresh application with types, CSS and both entries. Successful slices stay in
the implementation and expand.

A local failure means fixing the implementation first, then narrowing supported
structures if necessary. Private state, framework cleanup and required WC
capabilities cannot be deleted to manufacture success. Independent work such
as output safety continues without waiting for every slice.

## Delivery order

| Release | Main work | User impact |
| --- | --- | --- |
| Alpha16 | Direct DOM codegen, public/private output, server-function extensions, page client-needs analysis | Existing components migrate to the new backend; zero JS is the goal for pages with no actual client need |
| Alpha17 | Reactive function components, composition, explicit CE, independent packages and migration | One recommended path for new projects; compatible old classes; general upgrade tooling and URL migration proceed independently |
| Alpha18 | Component defer, resource readiness, bounded resources and navigation integration | Useful content can arrive first, with explicit handling and fallback for late results and failures |

Element and Router remain independently usable core products. Existing Lit
compatibility stays maintained; OhMyLit is a separate product effort, not a
condition for the main release. A new Native capability is not automatically
a promise of equivalent Lit support. The layout convention remains.

These are planning targets. ADR-0173 and ADR-0174 formally accept the architecture direction;
the registered amendments preserve history and relationships. Implementation remains pending,
and the precompiled-component distribution contract is not frozen.
Actual APIs, availability and performance benefits depend on implementation and
validation. See the [roadmap](/roadmap) for the planned sequence; current
published capability remains defined by released versions and their docs.
