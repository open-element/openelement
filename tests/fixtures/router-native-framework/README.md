# router-native-framework

Minimal openElement app proving the complete **Native Framework Mode**
application flow (Beta.2.2, #1339): a notes app with a static home page
(build-time data), request-time list/detail/create/edit pages, the ADR-0120
action protocol with native validation, the ADR-0129 response-header channel,
`loader notFound()`, and a styled 404. The counter island hydrates on dynamic
pages exactly like on prerendered pages — the generated request-time server
entry injects the island client entry itself.

```bash
pnpm --dir tests/fixtures/router-native-framework run build   # build
pnpm --dir tests/fixtures/router-native-framework run gate    # build + e2e (chromium/firefox/webkit)
```

The fixture consumes workspace sources (relative paths to `packages/*/src`),
never npm releases, so it always proves the checkout.
