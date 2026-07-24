---
title: "The wire"
description: "Dates, BigInts, Maps, cycles, and Files cross intact \u2014 a pinned, versioned serializer with byte limits."
---

Error definitions describe the encoded value, not an optimistic in-memory
type:

```ts
export const SaveConflict = error({
  tag: "doc/save-conflict",
  data: wire.object({
    docId: wire.string,
    theirSavedAt: wire.date,      // a real Date on both sides of the wire
    revision: wire.bigint,        // a real BigInt, not a stringified one
  }),
  httpStatus: 409,
})
```

result-rpc uses a pinned, protocol-versioned devalue transport. Success values
and tagged error data transparently preserve:

- `undefined`, `NaN`, infinity, and `-0`
- `Date`, `BigInt`, `RegExp`, `URL`, and `URLSearchParams`
- `Map`, `Set`, `ArrayBuffer`, and typed arrays
- Temporal values when `Temporal` is available in both runtimes
- cycles and repeated object identity

```ts
const RichDoc = wire.object({
  savedAt: wire.date,
  revision: wire.bigint,
  pattern: wire.regexp,
  homepage: wire.url,
})
```

For a recursive or otherwise richer application type, validate serializer
support at the boundary:

```ts
const Graph = wire.serializable<DocGraph>()
```

Functions, symbols, unsupported class instances, and arbitrary `Error` causes
are rejected. Tagged error constructors perform a real serializer preflight,
so a custom wire codec cannot smuggle an unsupported runtime value into an
error.

Encoded request, response, hydration, and tagged-error byte limits are
enforced at runtime. Invalid values are never reflected back to the client.
Custom procedure codecs can enforce finer domain-specific collection, string,
and nesting limits.

## File uploads keep the typed input

`File` and `Blob` cannot cross a value serializer, and the usual answer —
degrade the whole input to `FormData` — costs the contract exactly where
uploads need it most. result-rpc keeps the typed object; files ride as
multipart sidecar parts the runtime substitutes transparently:

```ts
const setAvatar = app.procedure()
  .input(wire.object({
    userId: wire.string,
    image: wire.file({ maxBytes: 5_000_000, accept: ["image/*"] }),
  }))
  .output(AvatarCodec)
  .errors({ ImageUnprocessable })
  .mutation(async ({ input }) => {
    // input.image is a real File — name, size, stream(), the works
    return ok(await store(input.userId, input.image))
  })

await client.setAvatar({ userId, image: fileInput.files[0] })
```

Size and MIME constraints are declared on the codec and enforced on both sides
— oversized or wrong-typed files reject at the client before any bytes move,
and again on the server. Uploads bypass batching (one multipart request per
call), subscriptions reject file inputs, and a file marker smuggled into an
ordinary request never resolves — the substitution only exists on multipart
requests and must be a perfect bijection with the parts.
