---
title: "Subscriptions"
description: "Streams under the same union, with connection lifecycle separate from failure."
---

Declare the stream in the shared contract and attach its generator only on the
server:

```ts
export const docEventsContract = app
  .procedure()
  .input(wire.object({ docId: wire.string }))
  .output(DocEvent)
  .errors({ Unauthorized, DocNotFound })
  .subscription()

export const docEvents = app
  .implement(docEventsContract)
  .use(authenticated)
  .stream(async function* ({ input, errors, context }) {
    const doc = await context.docs.find(input.docId)
    if (!doc) {
      yield err(errors.DocNotFound({ docId: input.docId }))
      return
    }

    for await (const event of context.docs.events(input.docId)) {
      yield ok(event)
    }
  })
```

The direct client is an async iterable of the same Result union. React
observes connection state independently from the latest event or terminal
failure:

```tsx
const events = useResultSubscription(client.doc.events, { docId })

events.connection // "connecting" | "open" | "reconnecting" | "paused" | "closed"
events.result     // Ok<DocEvent> | Err<GetDocEventsError> | undefined
```

`AuthShell.useSubscription` narrows the same way: a claimed terminal failure
leaves `connection` at `"paused"` with no `result`, and the owning shell
reacts. A retryable disconnect moves through `reconnecting` and does not
publish a temporary `Err`; if retry policy is exhausted, the final connection
error appears in `events.result`. Every frame is sequence-checked and
independently encoded by the same versioned serializer as unary and batched
responses.

Subscriptions currently run over the streaming HTTP transport; SSE resume
(`Last-Event-ID`) is deliberately deferred until a real deployment demands it.
