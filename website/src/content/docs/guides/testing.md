---
title: "Testing and SSR"
description: "Parity-mode test clients, the fetch-handler-as-fetch harness, and validated hydration."
---

```ts
import { createTestClient } from "result-rpc/testing"
import { appRouter } from "./router"

const client = createTestClient(appRouter, {
  context: testContext,
  mode: "parity",
})

const result = await client.doc.byId({ id: "missing" })

expect(result).toEqual({
  ok: false,
  error: {
    _tag: "doc/not-found",
    data: { docId: "missing" },
  },
})
```

Parity mode runs the same codecs and undeclared-error checks as the remote
protocol. A separate test transport covers malformed envelopes, 5xx responses,
timeouts, offline behavior, and batch failures.

And when a test should cross the real wire — protocol, serializer, HTTP
statuses and all — the fetch handler *is* the fetch, no server process
required. The examples run their full React trees this way:

```ts
const handler = createFetchHandler({ router, createContext: () => context })

const client = createClient({
  router,
  transport: fetchTransport({
    url: "https://example.test/rpc",
    fetch: (input, init) => handler(new Request(input, init)),
  }),
})

// full round-trip: devalue envelope, HTTP status, rich values intact
const events = await collect(client.doc.events({ id: "doc_1" }))
expect(events[0]).toEqual(ok({ docId: "doc_1", kind: "renamed", at: new Date("2026-01-01") }))
```

Note the `Date` inside the assertion — it crossed the wire as a `Date`.
