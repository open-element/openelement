---
title: 'WC Standards Contract'
lede: 'OpenElement relies on web-platform contracts rather than a proprietary registry product. Custom Elements, DSD, CEM, Request/Response and FormData define the direction of the public application model.'
order: 80
---

## Elements + DSD

Standard Custom Elements and Declarative Shadow DOM define the durable component boundary.

## Request semantics

`Request`, `Response` and `FormData` are the basis of the 0.42 loader/action surfaces — application interaction without a proprietary transport.

## Four-package ownership

`Element`, `Router`, `Create` and the experimental `UI` package are the current consumer surface; internal contracts stay internal.
