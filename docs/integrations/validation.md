# Validation recipe (zod / valibot)

> Status: **verified by the `fixture:request-time:e2e:browsers` gate in
> the CI release gate (three engines)** — both shapes are exercised end-to-end by
> the request-time fixture
> (`packages/adapter-vite/__fixtures__/request-time/`: `/register` with
> zod, `/subscribe` with valibot, 422/303 asserted in three engines).

The framework is deliberately validation-agnostic: an action receives the
standard `FormData`, and any schema library runs inside it. The contract is
the ADR-0120 protocol, not the library:

1. Parse `ctx.formData` with your schema.
2. On failure `return fail(422, { error, ...submittedValues })` — the page
   re-renders with the message and the echo (no JavaScript required).
3. On success `redirect(...)` (or return data for the default 303 PRG).
4. Because a failed action may be re-run, validate first and mutate only
   after validation passes.

```ts
import { fail, redirect } from '@openelement/app';
import { z } from 'zod';

const schema = z.object({ email: z.string().email('a valid email is required') });

export function action(ctx: { formData: FormData }) {
  const parsed = schema.safeParse({ email: String(ctx.formData.get('email') ?? '') });
  if (!parsed.success) {
    return fail(422, {
      error: parsed.error.issues[0]?.message ?? 'invalid input',
      email: String(ctx.formData.get('email') ?? ''),
    });
  }
  redirect(`/register?welcome=${encodeURIComponent(parsed.data.email)}`);
}
```

valibot is interchangeable (`v.safeParse(schema, input)`); see the fixture
for both. The dual-library presence is the interop proof, and published
packages stay validation-library-free by policy; the package boundary is
recorded in [packages and distribution](../architecture/packages-and-distribution.md).
The page reads the failure through its descriptor's `props`
projector (`actionData` on the projector context, mapped onto the compiled
page properties); mark the form
`data-open-enhance` to get the morph-based enhanced path for free.
