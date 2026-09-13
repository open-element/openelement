# ADR-0141: Node Bridge Disconnect Propagation Preserves First-Mile Start Semantics

- Status: Accepted
- Date: 2026-08-24
- Amends: ADR-0122 §4
- Related: #1135, #1136

## Context

The 0.43.x runtime audit found that the Node bridge did not fully connect the
lifetimes of a Node request, its Fetch `Request`, the Fetch response body and
the Node response. A client abort could leave request work alive; response
disconnects did not reliably cancel the web stream; and a saturated Node
response did not wait for `drain`. The standalone generated server and
`openElement start` share this bridge, so the correction touches
`packages/router/src/cli/start.ts`, which ADR-0122 freezes as part of the
first-mile start contract.

## Decision

Accept the Node bridge lifetime correction as a contract-preserving patch:

1. `nodeRequestToWeb` derives an abort signal from request/socket termination
   and removes the paired listeners when either side completes.
2. `writeWebResponse` waits for Node `drain`, cancels the Fetch body after a
   response disconnect and removes response listeners on every terminal path.
3. `openElement start` passes the originating Fetch request to the shared
   response writer, matching the generated standalone server.

The documented `build` then `start` path, static-to-routes-to-action-to-error
pipeline order, host/port configuration, HTTP status and header behavior, and
public package interfaces are unchanged. This amendment strengthens failure
cleanup only; it does not add production recovery, retry or persistence
semantics.

## Consequences

- Node and generated-server response handling remain single-sourced.
- Aborts, disconnects and backpressure are observable through existing web and
  Node stream semantics instead of a new OpenElement API.
- Tests lock request abort, response cancellation, `drain`, listener cleanup,
  keep-alive reuse and repeated-run resource behavior
  (`packages/router/__tests__/node-bridge-lifecycle.test.ts`,
  `packages/router/__tests__/node-bridge-adversarial-http.test.ts`),
  including the two terminal-race holes closed in #1152 (a disconnect that
  precedes `writeWebResponse` is detected from the response's terminal state,
  not a missed event) and #1154 (listener cleanup is never gated on a hanging
  `reader.cancel()`).
- Future changes to first-mile request-pipeline meaning still require a
  separate amendment to ADR-0122.
