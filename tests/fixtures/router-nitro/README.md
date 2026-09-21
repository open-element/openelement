# router-nitro

**Nitro host qualification** proof. Builds this fixture with real Nitro presets
(`node-server` and `cloudflare_module`) and smokes the generated output: route
behavior, island/client-only asset delivery, public assets, and the host-level
Nitro cache route rule. The fixture consumes workspace SOURCE artifacts
(packages/router tooling invoked from this repository checkout), never a
published release.

```bash
deno task --cwd tests/fixtures/router-nitro proof:node
deno task --cwd tests/fixtures/router-nitro proof:workers
```

`deno.lock` is generated from the real build (not a source entrypoint) — see
`tests/fixtures/README.md`.
