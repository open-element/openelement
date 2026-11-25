---
status: active
topic: Canonical compiler-native architecture
summary: The product architecture, shared semantics, generated browser execution, independent server rendering and platform boundaries.
---

# Compiler-native architecture

Element provides the component compiler and runtime. Router builds the
application, determines delivery and request behavior, and integrates the
generated artifacts. Both products rely on browser custom elements and HTML
for their platform contracts. [Product model](./product-model.md) · [Packages and distribution](./packages-and-distribution.md)

## Component semantics

A function component produces renderable values. A hostless component composes
into an owning region without creating a custom-element tag. The generated
native custom-element boundary is explicit where native registration,
properties, Shadow DOM, form association or island activation are needed.
Use the platform's element lifecycle, attributes, events and slots at that
boundary.

The frontend resolves lexical identity and produces Semantic IR, with source
locations, ownership, dependencies and render structure. This compile-time
model feeds both backends. It allows framework diagnostics where a construct
has no admitted lowering. [TSX author contract](./tsx-author-candidate-contract.md) · [JSX values and owners](./jsx-value-and-children-model.md)

## Browser execution

The browser runs compiler-generated mount, claim, update and dispose functions.
Generated operations write to their owned DOM ranges and subscribe to the signal
or props channels they read. Runtime helpers own region bookkeeping, lifetimes,
signal integration, event replay and native platform adaptation. The generated
artifact carries templates, markers and needed data. Generic opcode execution
and runtime JSX fallback are outside this model.

Claim first checks the parsed structure and allowed seed state. It then opens
subscriptions and listeners for the existing nodes. Validation failure leaves
borrowed DOM alone. Activation failure releases resources from the failed
attempt within its owner boundary. Equal updates avoid unnecessary DOM writes.
Native controls may carry user input before an island upgrades. Preserve
documented input, focus and selection behavior through claim. [Runtime claim contract](./compiler-and-element-runtime.md)

## Server rendering

The server backend produces HTML with the same expression and ownership model.
Router calls the emitted server artifact for static generation or request-time
rendering. The browser parser creates light DOM or declarative shadow roots
from those bytes. The HTML wire carries markers, approved property seeds and
resource references. Compiler Semantic IR remains at build time. [IR, ABI and wire](./compiler-ir-and-abi-boundary.md)

Server component full await admits a text child or a nested server-component
prop. Those positions settle before HTML is returned. Inputs outside the
admitted positions receive the recorded diagnostic. Browser setup is
synchronous and server-only modules stay outside the browser entry graph.
Future deferred delivery requires its own ownership, readiness and safety
contract. [Full-await definition](./m14-full-await-definition.md)

## Integration and safety

Router owns resolution, build and development graphs, asset URLs, route
classification, request dispatch and delivery. Compiler-generated component
identity and Router route identity are separate facts. Packages expose generated
platform metadata to independent consumers. Styles have one declaration and one
resolution plan, with delivery appropriate to shadow, light or client-only
roots. [Live seam registry](./seams.md)

Treat artifact publication, serialization safety and application authorization as
separate guarantees. Server artifacts stay private, untrusted text crosses
through escaping, and trusted HTML requires the in-process capability. A
navigation morph and component binding each need an explicit owner when they
write DOM. [Private-artifact decision](../adr/ADR-0171-private-artifact-static-boundary.md) · [Security baseline](./security-baseline-matrix.md)

## Acceptance evidence

Review one generated execution model, one signal model and one region owner for
each claimed or mounted instance. Proof comes from authored cases in real
browsers, produced server bytes, actual browser-entry graph artifacts and
independent packed consumers. Each result belongs to its recorded revision and
artifact scope. [Qualification contract](./alpha16-18-execution-plan.md) · [Semantic test matrix](./alpha16-18-semantic-test-matrix.md)
