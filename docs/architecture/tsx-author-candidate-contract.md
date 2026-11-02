# TSX author candidate contract

Date: 2026-11-03. Status: **CANDIDATE / NOT IMPLEMENTED OR VERIFIED**.
This is the author-review prerequisite for [ADR-0173](../adr/ADR-0173-component-execution-and-composition.md)
and [ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md),
not an alpha.15 tutorial, runnable fixture suite or frozen public API.
The [product model](./product-model.md) separates current support from direction.

## Reading the samples

All snippets are candidate TSX, not imports users can install. Names such as
`component`, `signal`, `computed`, `Children`, `onConnect`, `onDispose`, `ref`,
`context`, `provide`, `useContext`, `nativeElement` and `ErrorBoundary` are review
notation with **unreleased/unselected signatures**. No module exporting this set
is promised. Standard JSX syntax is the input target, not React semantics or a
promise that arbitrary JavaScript values render. `Item`, `loadItems`, probe helpers
and similar domain names stand for application/test inputs, not framework APIs.

Candidate baseline: synchronous client setup once per logical instance; SSR and
client initialize separately. Server does not run connection callbacks. Explicit
Signals use `.value`. Tracked JSX reads and explicit computed derivation can update;
ordinary locals and destructuring are snapshots. Candidate readonly tracked props
are compared with explicit Signal props before choosing public types. **Props,
computed and Children API/type contracts remain OPEN**, as do ref/context,
non-array iterables, batching/flush/read-DOM timing and generated ABI. These
examples propose observable expectations for owner review, not settled syntax.

Every case below still requires separate type-positive/negative, compile-positive/
negative and browser behavior evidence. Default phases are SSR, fresh Mount,
Claim, Update and Dispose; a case-specific exception below explains when a phase
is inapplicable. Record setup/cleanup counts, source locations and resource counts
with test probes, not a new public debugging API. Generated-source snapshots alone
are insufficient. All implementation tests in this document are **NOT RUN**.

## TSX-01 — roots, fragments and empty output

```tsx
const Title = component(() => <h1>Hello</h1>);
const Pair = component(() => <><h1>Hello</h1><p>World</p></>);
const Empty = component(() => <></>);
const Page = component(() => <><Title /><Pair /><Empty /></>);
```

Evaluate each inserted instance once per environment. SSR and Mount have equivalent
visible content; Claim keeps matching nodes. Empty output still has a disposable
logical owner. Update is not applicable to these static bindings; disposing an
empty instance must not leak ownership.

## TSX-02 — signal and computed

```tsx
const Counter = component(() => {
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  return <button onClick={() => count.value++}>{count.value}:{doubled.value}</button>;
});
```

Initial text is `0:0`; a click eventually produces `1:2` without repeating setup.
Only dependent bindings update. Exact computed evaluation caching and flush timing
remain OPEN. After Dispose, writing a retained signal must not write DOM or keep
subscriptions alive. SSR does not execute the event handler.

## TSX-03 — primitive props versus destructuring

```tsx
const Label = component((props: { readonly value: number }) => {
  const { value: snapshot } = props;
  return <p>{props.value}/{snapshot}</p>;
});
const Parent = component(() => {
  const n = signal(1);
  return <><Label value={n.value} /><button onClick={() => n.value++}>Next</button></>;
});
```

Candidate tracked-props behavior is `1/1` then `2/1`, with one child instance.
Plain destructuring is not rewritten into reactive magic. Compare this with an
explicit Signal-prop sample before selecting props types; these annotations do
not establish the released type contract. Claim separately initializes the client.

## TSX-04 — replacement item, stable private draft

```tsx
const Row = component((props: { readonly item: Item; readonly save: (item: Item) => void }) => {
  const draft = signal(props.item.name);
  return <><span>{props.item.name}</span><input value={draft.value}
    onInput={(event) => { draft.value = event.currentTarget.value; }} />
    <button onClick={() => props.save(props.item)}>Save</button></>;
});
const List = component((props: { readonly items: Item[]; readonly save: (item: Item) => void }) =>
  <>{props.items.map((item) => <Row key={item.id} item={item} save={props.save} />)}</>);
```

Replacing an item object under the same parent/key/type updates its displayed name
but preserves edited draft. Save must read the new item, not a stale captured
object. Removing the row disposes it. Seed agreement and pre-activation input
preservation require Claim tests, not just text assertions.

## TSX-05 — local filter versus computed filter

```tsx
const Filtered = component((props: { readonly items: Item[] }) => {
  const query = signal('');
  const snapshot = props.items.filter((item) => item.name.includes(query.value));
  const live = computed(() => props.items.filter((item) => item.name.includes(query.value)));
  return <><input onInput={(event) => { query.value = event.currentTarget.value; }} />
    <p>{snapshot.length}/{live.value.length}</p></>;
});
```

The ordinary filter runs during setup, not on every query update. The computed
filter follows its dependencies. SSR/client each evaluate their own initial
snapshot. A historical Todo example must not silently gain different JS semantics.
Exact computed API and invalidation timing remain OPEN.

## TSX-06 — conditions and numeric zero

```tsx
const Conditional = component(() => {
  const shown = signal(false);
  return <><button onClick={() => { shown.value = !shown.value; }}>Toggle</button>
    {shown.value && <Counter />}{shown.value ? <Pair /> : <Empty />}{0}</>;
});
```

Inactive branches do not set up. Exit cleans the active subtree; reentry creates
new private state. Zero renders as text while booleans contribute no visible child.
Claim must select the same seeded branch or diagnose a bounded mismatch. Test
multi-root and empty branch cleanup, not only the visible counter.

## TSX-07 — keyed movement

```tsx
const Keyed = component((props: { readonly items: Item[]; readonly save: (item: Item) => void }) =>
  <section>{props.items.map((item) => <Row key={item.id} item={item} save={props.save} />)}</section>);
```

Keys are scoped to the parent list/region. Same key and type preserve instance and
draft on reorder, insert and delete; qualify node identity, input, focus and
selection, not just order. Duplicate keys fail deterministically. A key/type change
replaces cleanly. Platform CE move callbacks are not promised to disappear.

## TSX-08 — unkeyed positions

```tsx
const Unkeyed = component((props: { readonly items: Item[]; readonly save: (item: Item) => void }) =>
  <>{props.items.map((item) => <Row item={item} save={props.save} />)}</>);
```

Candidate rule: unkeyed instances belong to positions, not item identities.
Swapping data updates positional props; private draft remains at its position.
This rule requires author approval before implementation; until selected, do not
promise item-state retention. Tail removal disposes remaining resources correctly.

## TSX-09 — JSX values and factories

```tsx
export function makeCaption(text: string) { return <span>{text}</span>; }
const Captions = component(() => {
  const caption = makeCaption('one');
  return <>{caption}{makeCaption('two')}</>;
});
const Duplicate = component(() => {
  const caption = makeCaption('once');
  return <>{caption}{caption}</>;
});
```

Evaluate each factory call normally; mounting is governed by insertion, not an
implicit function call or a stateful clone. `Duplicate` must fail deterministically
rather than share one live instance twice. Uninserted values must not acquire live
connection resources. Test cross-module source maps and disposal. The representation
of a dynamic JSX value remains OPEN, not a public VNode ABI.

## TSX-10 — Children and render callback

```tsx
const Frame = component((props: { readonly children: Children }) => <section>{props.children}</section>);
const Caller = component(() => {
  const label = signal('A');
  return <Frame><span>{label.value}</span></Frame>;
});
const RenderLabel = component((props: { readonly render: (name: string) => Children }) =>
  <div>{props.render('A')}</div>);
```

Children retain creation-site lexical dependencies, with one active cleanup owner.
A callback runs only where explicitly called, not merely because it is a prop.
Repeated projection of the same fragment and transfer across roots must reject;
a fresh factory invocation can create a distinct value. `Children` types, callback
tracking scope and invocation/update policy are OPEN and must be resolved before
this API expands. Do not infer that a bare function child is a callback.

## TSX-11 — spread order and removal

```tsx
const Spread = component((props: { readonly attrs: Record<string, unknown> }) =>
  <button {...props.attrs} title="explicit" onClick={() => recordClick()}>Go</button>);
const Link = component((props: { readonly url: string }) => <a href={props.url}>Open</a>);
```

Observe getter evaluation in source order; later explicit bindings win. When a
spread key disappears, remove its prior binding/listener instead of retaining stale
state. Attribute versus property routing is an explicit sink contract. Test unsafe
URLs, prototype-related keys and event replacement/removal; spread cannot bypass
safe sinks. Exact reactive spread diffing and getter re-evaluation require tests.

## TSX-12 — events, callbacks and refs

```tsx
const Action = component((props: { readonly done: (event: MouseEvent) => void }) => {
  const button = ref<HTMLButtonElement>();
  onConnect(() => { observe(button.current); return () => stopObserving(); });
  return <button ref={button} onClick={(event) => props.done(event)}>Done</button>;
});
```

Passing `done` must not call it. DOM events are native objects. Ref-ready connected
lifetime is separate from setup and post-update; SSR invokes no connection work.
Replace handlers without duplicate listeners; clear refs/resources on teardown and
contain handler/cleanup exceptions. Ref spellings, nullability and exact readiness
API remain OPEN; do not read DOM during setup as if already connected.

## TSX-13 — Context isolation

```tsx
const Theme = context('light');
const ThemeLabel = component(() => <span>{useContext(Theme).value}</span>);
const Themed = component(() => {
  const theme = signal('dark');
  provide(Theme, theme);
  return <ThemeLabel />;
});
```

Candidate lookup selects the nearest logical owner, including hostless owners.
Explicit signal updates reach descendants; siblings and concurrent SSR requests
do not share values. Context API, default representation and provider lifetime
remain OPEN. Test nested providers, disposal and independent requests, not global
mutable storage masquerading as Context.

## TSX-14 — CE connection lifecycle

```tsx
const Clock = component(() => {
  const ticks = signal(0);
  onConnect(() => {
    const timer = setInterval(() => ticks.value++, 1000);
    return () => clearInterval(timer);
  });
  return <span>{ticks.value}</span>;
});
nativeElement('sample-clock', Clock);
```

The adapter name/signature is candidate. Disconnect releases the timer; reconnect
may register once without repeating logical setup. CSS hiding does not disconnect.
SSR starts no timer. Dispose is idempotent, and a throwing cleanup must not prevent
other cleanups. A platform move may cause CE callbacks; no zero-callback promise.

## TSX-15 — runtime renderability

```tsx
const UnknownChild = component((props: { readonly value: unknown }) => <div>{props.value}</div>);
const Values = component(() => <>{'text'}{42}{null}{false}{['a', 2]}</>);
```

Candidate admitted values: strings/numbers become text; null/undefined/booleans
are empty; arrays flatten under the selected ownership rules. Objects, symbols,
bigints, bare functions and Promises reject with source locations rather than
implicit stringify/invocation. Runtime-unknown values need runtime guards; static
invalid values may fail compilation. These negative cases require separate tests;
server async functions below do not admit arbitrary Promise children.

## TSX-16 — iterables are not automatically arrays

```tsx
const ArrayItems = component(() => <>{['a', 'b'].map((value) => <span>{value}</span>)}</>);
function* names() { yield 'a'; yield 'b'; }
const IterableCandidate = component(() => <>{names()}</>);
```

Arrays are the initial candidate collection. Non-array iterable admission remains
OPEN; until selected, reject the generator case rather than consume it implicitly.
Explicitly test one-shot exhaustion and infinite iterables before any wider support.
No unbounded SSR or browser consumption is acceptable. Rejection means Mount/Claim/
Update are inapplicable for that input, not silently considered passing.

## TSX-17 — server async boundary

```tsx
export default async function ServerList() {
  const items = await loadItems();
  return <ul>{items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
}
```

Await server data before output under the selected server contract. Diagnose
server-only code reaching the client graph at authored locations. The server
function itself has no browser Mount/Claim/Update/Dispose instance; its emitted
HTML and any separately declared interactive descendants still need those tests.
Rejections/errors and request isolation remain required. This does not authorize
unbounded defer or a Promise as a normal child.

## TSX-18 — SSR seed and Claim fidelity

```tsx
const Editor = component((props: { readonly initial: string }) => {
  const text = signal(props.initial);
  return <input value={text.value}
    onInput={(event) => { text.value = event.currentTarget.value; }} />;
});
```

SSR and client setup each run once with matching serialized input. Successful
Claim must preserve the DOM node, pre-activation user input, focus and
selection under the input-fidelity contract. Random/time-dependent seeds and
structural mismatches require source-located bounded recovery, not an unexplained
whole-page rebuild. Capture counts to catch duplicate subscriptions after Claim.

## TSX-19 — error and cleanup containment

```tsx
const Risky = component(() => {
  onDispose(() => { throw new Error('first cleanup'); });
  onDispose(() => releaseResource());
  return <span>{readPossiblyFailingValue()}</span>;
});
const Guarded = component(() => <ErrorBoundary fallback={<p>Unavailable</p>}><Risky /></ErrorBoundary>);
```

Boundary and disposal APIs are candidate, not imports. Setup failure midway must
release already acquired resources; one cleanup failure must not suppress the
remaining cleanup. Qualify SSR errors, claim mismatch, update/flush errors,
reentrancy and idempotent Dispose with zero surviving resources. Boundary reset
and error propagation policy are OPEN; do not claim this snippet defines them all.

## TSX-20 — explicit CE and third-party WC

```tsx
const Badge = component((props: { readonly label: string }) => <span>{props.label}</span>);
nativeElement('sample-badge', Badge);
const Foreign = component(() => <third-party-editor><span slot="help">Help</span></third-party-editor>);
```

Qualify the Native export from ordinary HTML/foreign frameworks with properties,
events, slots, forms and shadow behavior; the mapping API remains OPEN. Third-party
Lit WC stays client-only: connect object properties and event listeners through
an explicitly tested boundary, not guessed attribute stringify. Foreign identity
or a manifest declaration alone does not prove SSR capability. Foreign internals'
SSR/Claim are inapplicable without separate admission; fallback HTML, client
upgrade, late hosts, repeated registration and disposal still need testing.

## TSX-21 — independent precompiled package

```tsx
// Library source: compiled by the library's build, not the consumer's TSX loader.
export const Greeting = component((props: { readonly name: string }) => <p>Hello {props.name}</p>);
// Fresh consumer source; illustrative package name, not a published API.
import { Greeting as LibraryGreeting } from 'candidate-library';
export const App = component(() => <LibraryGreeting name="Ada" />);
```

The tarball must supply selected server/client entries, declarations and relocatable
CSS/resources. Run SSR/Mount/Claim/Update/Dispose in the fresh consumer without
library TSX or workspace aliases. Reject incompatible ABI, duplicate ownership-
crossing runtimes, missing CSS/types and server chunks in client graphs. Metadata
format and version ranges remain OPEN. Start this evidence before ABI freeze.

## TSX-22 — HMR and source locations

```tsx
const HotCounter = component(() => {
  const count = signal(0);
  onConnect(() => subscribeToProbe(() => count.value++));
  return <button onClick={() => count.value++}>Count: {count.value}</button>;
});
```

Edit the authored label/handler and map errors back to this TSX, not generated
helper offsets. HMR must dispose replaced subscriptions and avoid duplicate live
resources. State-preservation policy remains OPEN; a documented reset is not a
promise of arbitrary state recovery. SSR covers initial output and mapped errors;
HMR replacement itself is a development-client operation, not SSR behavior.

## Review and implementation sequence

Owner review first: describe expected updates from the samples, record surprises,
and compare alternative props/Children spellings before explaining implementation
limitations. Resolve each OPEN item before its dependent public surface; do not
freeze helper names to make the samples appear executable.

Alpha16: semantic matrix, generated leaf execution, then stateful hostless list;
the same list proceeds through SSR/Claim/failure, with independent tarball work
starting as soon as the list foundation exists. Alpha17: consumer-backed Full TSX
APIs and app/Starter migration. Alpha18: bounded defer on the stable model. G1/G2/G3
are the existing codegen/identity/consumer gates. Preserve required class capability,
safe sinks, independent CE consumption, three engines and byte/input budgets.
These 22 cases may share fixtures, but their positive/negative assertions must stay
traceable. No case is marked implemented, typechecked, browser-qualified or released
by the existence of this document.
