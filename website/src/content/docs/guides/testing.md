---
title: "Testing and SSR"
description: "Parity-mode test clients, the fetch-handler-as-fetch harness, and validated hydration."
---

```ts
import { createTestClient } from "result-rpc/testing";
import { appRouter } from "./router";

const client = createTestClient(appRouter, {
  context: testContext,
  mode: "parity",
});

const result = await client.doc.byId({ id: "missing" });

expect(result).toEqual({
  ok: false,
  error: {
    _tag: "doc/not-found",
    data: { docId: "missing" },
  },
});
```

Parity mode runs the same codecs and undeclared-error checks as the remote
protocol. A separate test transport covers malformed envelopes, 5xx responses,
timeouts, offline behavior, and batch failures.

And when a test should cross the real wire — protocol, serializer, HTTP
statuses and all — the fetch handler _is_ the fetch, no server process
required. The examples run their full React trees this way:

```ts
const handler = createFetchHandler({ router, createContext: () => context });

const client = createClient({
  router,
  transport: fetchTransport({
    url: "https://example.test/rpc",
    fetch: (input, init) => handler(new Request(input, init)),
  }),
});

// full round-trip: devalue envelope, HTTP status, rich values intact
const events = await collect(client.doc.events({ id: "doc_1" }));
expect(events[0]).toEqual(ok({ docId: "doc_1", kind: "renamed", at: new Date("2026-01-01") }));
```

Note the `Date` inside the assertion — it crossed the wire as a `Date`.

## Simulating offline

The connectivity source listens on **`globalThis`** (in a browser that _is_
`window`; in Bun and Node it is not — do not stub `window`). Its online
snapshot is seeded from `navigator.onLine` at module import and is
**event-driven afterwards** — flipping `navigator.onLine` does nothing; you
dispatch events. Listeners attach lazily when the first subscriber appears
(creating a runtime or mounting `BoundaryProvider`), so mount first, dispatch
second:

```tsx
const runtime = createQueryRuntime({ client }); // attaches listeners
// ... render under BoundaryProvider ...

await act(async () => {
  globalThis.dispatchEvent(new Event("offline")); // reads pause, banner flips
});
await act(async () => {
  globalThis.dispatchEvent(new Event("online")); // held work resumes
});
```

Always dispatch a final `online` in test teardown — the source is a module
singleton, and a test that leaves it offline starves the next one.
