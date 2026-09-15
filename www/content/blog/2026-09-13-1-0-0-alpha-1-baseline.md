---
title: '1.0.0-alpha.1: a new baseline'
date: '2026-09-13'
lang: 'en'
tags: ['release', 'alpha']
excerpt: 'Element and Router converge on a fresh 1.0 Alpha baseline: public core, supported creation entry, experimental UI, and independently qualified packages.'
---

## What 1.0.0-alpha.1 is

`1.0.0-alpha.1` is a new baseline for Element and Router, not an upgrade of the
0.x lines. There is no supported migration path from 0.x: new projects start
from `@openelement/create`.

## Product surface

- **Element** and **Router** are the public framework core.
- **Create** is the supported creation entry.
- **UI** ships in this repository as experimental: usable, but outside the 1.0
  stable API promise.
- The **site** you are reading is the official product surface; the bundled
  **SaaS** app is an independent first-party consumer application maintained in
  this repository but governed separately — it is not framework core and not
  part of the Alpha repository candidate.

## How it is qualified

Every release candidate must survive independent packed consumers: the published
tarballs — never the monorepo sources — build a minimal Element app, a Router
SSR/SSG app, and browser claim/hydration checks on current Chromium, Firefox,
and WebKit. Deployment targets are Deno 2.9 and Node.js 24 via the Nitro
server adapter; local preview serves through `Deno.serve` from TypeScript
source. There is no first-party Node HTTP bridge.

## What to expect next

Alpha APIs may still change. Breaking changes land with the baseline, and each
step must re-pass the packed-consumer gate before it counts as progress.
