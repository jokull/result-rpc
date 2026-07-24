---
title: "The client"
description: "Every call resolves Result with the complete union; batching, cancellation, and wire-parity server calls."
---

```ts
import { createClient, batchFetchTransport } from "result-rpc/client"
import { appContract } from "../shared/contract"

export const client = createClient({
  contract: appContract,
  transport: batchFetchTransport({ url: "/rpc" }),
})

const result = await client.doc.byId({ id: "doc_123" })
```

Calls issued in the same microtask share one HTTP request. Every batch item
keeps its own status, decoder, rich-value envelope, and tagged Result. Use
`fetchTransport` when batching is not wanted; the client API is unchanged.

The direct client is the honest base: it always resolves the complete union.
Narrowing is a property of where a call is *rendered*, and the direct client
is not rendered anywhere, so it never subtracts anything.

```ts
Result<
  Doc,
  | Unauthorized
  | DocNotFound
  | ServerInternal
  | Offline
  | NetworkFailure
  | Timeout
  | HttpFailure
  | ProtocolViolation
  | DecodeFailure
>
```

Handle the union with an ordinary switch (`result.error satisfies never` in
the default arm keeps it exhaustive), or build a reusable projection — a
message catalog, a metrics mapper — once, from the same definition map
middleware and shells use:

```ts
import { errorCatalog } from "result-rpc"

const message = errorCatalog({ DocNotFound, Unauthorized }, {
  "doc/not-found": (e) => `Doc ${e.data.docId} is gone`,
  "auth/unauthorized": () => "Sign in to continue",
})
```

Adding a definition to the map breaks every catalog missing the new tag. For
inline one-offs, `matchError(result.error, { ...handlers })` gives the same
exhaustiveness on a single value.

## Cancellation is not an operation error

Query cancellation updates lifecycle state without producing an `Err`,
consuming a retry, or entering an error boundary.

Direct calls accept an `AbortSignal`:

```ts
const controller = new AbortController()

const pending = client.doc.byId(
  { id: "doc_123" },
  { signal: controller.signal },
)

controller.abort()
```

Internally result-rpc uses a tagged `control/cancelled` sentinel so
cancellation does not depend on platform-specific `AbortError` identity. It is
control flow and is excluded from the recoverable error union. Its sibling,
`control/claimed`, is what a shell-claimed mutation rejects with — the same
family, one `catch` at the call site, and `isCancelled`/`isClaimed` to tell
the two events apart when the UX differs.

## Server-side calls keep wire parity

```ts
import { createServerClient } from "result-rpc/server"
import { appRouter } from "./router"

const serverClient = createServerClient(appRouter, {
  mode: "parity",
  context,
})

const result = await serverClient.doc.byId({ id: "doc_123" })
```

Parity mode executes locally but still applies input, output, and error
codecs. A value that would fail remotely also fails during SSR, tests, and
server components. Parity is the only mode for now; an unchecked fast path can
follow if profiling ever demands one.
