---
title: "Subscriptions"
description: "Streams under the same union, with connection lifecycle separate from failure."
---

Declare the stream in the shared contract and attach its generator only on the
server:

```ts
import { serverRpc } from "result-rpc/server";

export const docEventsContract = app
  .procedure()
  .input(wire.object({ docId: wire.string }))
  .output(DocEvent)
  .errors({ Unauthorized, DocNotFound })
  .subscription();

const server = serverRpc.context<AppContext>();
export const docEvents = server
  .implement(docEventsContract)
  .use(authenticated)
  .stream(async function* ({ input, errors, context }) {
    const doc = await context.docs.find(input.docId);
    if (!doc) {
      yield err(errors.DocNotFound({ docId: input.docId }));
      return;
    }

    for await (const event of context.docs.events(input.docId)) {
      yield ok(event);
    }
  });
```

The direct client is an async iterable of the same Result union. React
observes connection state independently from the latest event or terminal
failure:

```tsx
const events = useResultSubscription(client.doc.events, { docId });

events.connection; // "connecting" | "open" | "reconnecting" | "paused" | "closed"
events.result; // Ok<DocEvent> | Err<GetDocEventsError> | undefined
```

Subscriptions are the one hook that keeps a `result` envelope. Queries and
mutations flatten to `value`/`error` because `state` discriminates them;
`connection` is deliberately orthogonal to the latest outcome, so here
`Result | undefined` is the honest shape — flat `value`/`error` fields would
be exactly the independently-nullable pair this library exists to avoid.

`AuthShell.useSubscription` narrows the same way: a claimed terminal failure
leaves `connection` at `"paused"` with no `result`, and the owning shell
reacts. A retryable disconnect moves through `reconnecting` and does not
publish a temporary `Err`; if retry policy is exhausted, the final connection
error appears in `events.result`. Every frame is sequence-checked and
independently encoded by the same versioned serializer as unary and batched
responses.

## Resuming an interrupted stream

By default a reconnect reopens the stream from the top: the handler runs again
from its first line, so events emitted during the gap are lost and events
already delivered may arrive twice. `.resumable()` closes that gap.

```ts
const feed = app
  .procedure()
  .input(wire.object({ roomId: wire.string }))
  .output(Message)
  .resumable({ eventId: (message) => message.id })
  .subscription();
```

```ts
server.implement(feed).stream(async function* ({ input, lastEventId }) {
  // undefined on a first connect; the last event this client saw on a reconnect
  for await (const message of room(input.roomId, { after: lastEventId })) {
    yield ok(message);
  }
});
```

`eventId` derives a resume token from an event's **value**. Both sides run the
same declared function, so the client computes the token from the event it just
decoded and sends it back on the next connect — no event id rides the wire
frame, and the procedure's input codec is unchanged. Resuming is automatic:
the subscription runtime already reconnects on a retryable failure, and this
only decides where the new connection starts.

Three rules worth knowing:

**A changed input is a new stream, not a resumed one.** The resume point is
dropped whenever the subscription is created or its input changes; resuming one
room's position into another room would be wrong.

**A procedure that did not declare `.resumable()` never receives a resume
point**, even if a client sends one. Undeclared handlers cannot be handed
client-supplied state they never asked for.

**`.resumable()` is in the contract digest.** A client and server that disagreed
about it would silently re-deliver events after a deploy, which is exactly the
class of bug the digest exists to catch.

Whether a drop reconnects at all is still the declared `RetryPolicy` of the
error that ended the stream — `transient` and `after` reconnect, `never` does
not. Resumability decides _where_ a reconnect resumes, not _whether_ one happens.

## Transports

Subscriptions run over the streaming HTTP transport.
Both `fetchTransport` and `batchFetchTransport` implement this streaming path;
the latter batches unary calls while opening subscriptions as individual
streams. Use the same client instance for both.
