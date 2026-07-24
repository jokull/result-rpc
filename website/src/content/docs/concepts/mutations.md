---
title: "Mutations"
description: "Result-state mutations, optimistic arcs, and declared invalidation: the blast radius lives in the contract."
---

```tsx
import { useResultMutation } from "result-rpc/react"
import { client } from "./client"

function RenameDoc({ id }: { id: string }) {
  const rename = useResultMutation(client.doc.rename, {
    optimistic: ({ title }, cache) => {
      const rollback = cache.update(
        client.doc.byId,
        { id },
        doc => doc && { ...doc, title },
      )

      return { rollback }
    },
    onFailure: (_error, _input, context) => {
      context?.rollback()
    },
    onCancel: (_input, context) => {
      context?.rollback()
    },
  })

  async function submit(title: string) {
    const result = await rename.mutate({ id, title })

    if (!result.ok && result.error._tag === "doc/title-conflict") {
      focusTitleField()
    }
  }

  return <RenameForm pending={rename.state === "pending"} onSubmit={submit} />
}
```

`AuthShell.useMutation` is the narrowed form: claimed failures never reach
`onFailure` or the returned state, and the `mutate` promise rejects with the
distinguishable `claimed` signal, as described under
[What a claimed error does](/concepts/shells/#what-a-claimed-error-does-to-the-operation).

Optimistic rollback runs before observers receive the final failure state.
Cancellation is explicit because cancelling a request cannot guarantee that a
server-side mutation did not happen: call `rename.cancel()`. Cancellation
resets lifecycle state and rejects the pending `mutate` promise with the
`cancelled` control sentinel; it never appears as an operation `Err`.

## Declared invalidation

You noticed what the example above does *not* contain: `onSettled` with a
`cache.invalidate` call. That line — the most-repeated and most-forgotten
line in any React Query app, whose absence is a stale-UI bug — lives in the
contract now. A mutation declares its blast radius once, where it is defined:

```ts
const byId = app.procedure()
  .input(wire.object({ id: wire.string }))
  .output(DocCodec)
  .query()

const rename = app.procedure()
  .input(wire.object({ id: wire.string, title: wire.string }))
  .output(DocCodec)
  .affects(byId, (input) => ({ id: input.id }))   // rename touches this doc
  .affects(list)                                  // and every cached list page
  .mutation()
```

Every `useResultMutation` of `rename` — in any component, forever —
invalidates those queries on success. The `map` turns the mutation's input
into the target's input; omitting it invalidates every cached input of the
target. The declaration is also documentation: the contract states which
reads each write disturbs, and a reviewer can see a missing `.affects()` in
the same diff that adds the mutation. Server-driven invalidation (the handler
reporting what it actually touched, over the response envelope) is the
planned extension of the same channel — and with entities (next section),
`.affects()` recedes to what only a declaration can express: membership.
