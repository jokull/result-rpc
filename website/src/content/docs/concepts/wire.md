---
title: "The wire"
description: "Dates, BigInts, Maps, and cycles cross intact \u2014 a pinned, versioned serializer with byte limits. Binaries stay out of band."
---

Error definitions describe both representations: the validated encoded value
and the `TaggedError` instance reconstructed from it:

```ts
export const SaveConflict = error({
  tag: "doc/save-conflict",
  data: wire.object({
    docId: wire.string,
    theirSavedAt: wire.date, // a real Date on both sides of the wire
    revision: wire.bigint, // a real BigInt, not a stringified one
  }),
  httpStatus: 409,
});
```

result-rpc uses a pinned, protocol-versioned devalue transport. Success values
and tagged error data transparently preserve:

- `undefined`, `NaN`, infinity, and `-0`
- `Date`, `BigInt`, `RegExp`, `URL`, and `URLSearchParams`
- `Map`, `Set`, `ArrayBuffer`, and typed arrays
- cycles and repeated object identity

The error prototype is not serialized as bytes or guessed from a constructor
name. The procedure contract first authorizes `_tag`, decodes `data`, and then
uses that exact definition to create a fresh instance. Thus
`SaveConflict.is(result.error)` and `result.error instanceof Error` work after
the RPC call without claiming that the server and client shared object identity.

Test the property you care about through a real wire-parity client:

```ts
const result = await parityClient.doc.byId({ id: "doc_123" });
if (result.ok) {
  result.value.savedAt instanceof Date; // true after encode + HTTP + decode
}
```

`createParityClient` comes from `result-rpc/testing`; unlike a direct server
client, it exercises the serializer and protocol boundary.

```ts
const RichDoc = wire.object({
  savedAt: wire.date,
  revision: wire.bigint,
  pattern: wire.regexp,
  homepage: wire.url,
});
```

A nullable field is common enough to have a name: `wire.nullable(codec)` is
exactly the union you would otherwise spell by hand.

```ts
const Author = wire.object({
  name: wire.string,
  avatarUrl: wire.nullable(wire.url), // wire.union([wire.url, wire.null])
});
```

It builds that same union, so the encoding — and therefore the contract digest
— is unchanged. It is shorter, and it says "this field may be null" rather
than making the reader infer it from a two-member union.

String literal unions have the same shorthand. The tuple must be non-empty,
and its values remain literal types without `as const`:

```ts
const Task = wire.object({
  status: wire.enum(["open", "blocked", "done"]),
});
// InputOf<typeof Task>["status"] is "open" | "blocked" | "done"
```

Like `wire.nullable`, `wire.enum` is a spelling of the expanded union rather
than a new wire construct. Its encoding and contract digest are identical to
`wire.union([wire.literal("open"), wire.literal("blocked"), wire.literal("done")])`.

For a recursive or otherwise richer application type, supply an actual type
guard. Serializer support alone cannot prove an application shape:

```ts
const Graph = wire.serializable((value): value is DocGraph => isDocGraph(value), {
  id: "doc-graph/v1",
});
```

The stable `id` is the structural contract identity for a guard the library
cannot introspect. Change it whenever the accepted wire shape changes.

Functions, symbols, unsupported application class instances, and arbitrary
`Error` causes are rejected. `TaggedError` is the deliberate exception because
its definition downgrades it before serialization and reifies it after validation.
Tagged error constructors perform a real serializer preflight,
so a custom wire codec cannot smuggle an unsupported runtime value into an
error.

Encoded request, response, hydration, and tagged-error byte limits are
enforced at runtime. Invalid values are never reflected back to the client.
Custom procedure codecs can enforce finer domain-specific collection, string,
and nesting limits.

## Binaries are out of band

result-rpc deliberately does **not** move file bytes over the RPC wire. Every
request is the one JSON-shaped protocol content-type — there is no multipart
path — which keeps the surface small and, not incidentally, keeps the
[CSRF defense](/concepts/client-boundary/) uniform (a browser cannot send that
content-type cross-origin without a preflight).

Modern stacks already handle binaries better out of band. Upload the bytes
straight to object storage (R2, S3, a Hono endpoint you mount yourself),
usually with a presigned URL, and let the RPC contract carry only the
**reference** — a bucket key:

```ts
// 1. A tiny RPC to mint an upload target (or mount a plain POST route for it).
const createUpload = server
  .procedure()
  .input(wire.object({ contentType: wire.string }))
  .output(wire.object({ uploadUrl: wire.url, key: wire.string }))
  .mutation(async ({ input, context }) => ok(await context.storage.presignPut(input.contentType)));

// 2. The client PUTs the file to uploadUrl directly — bytes never touch RPC.
await fetch(uploadUrl, { method: "PUT", body: file });

// 3. The RPC that finishes the job carries only the reference.
const setAvatar = server
  .procedure()
  .input(wire.object({ userId: wire.string, key: wire.string }))
  .output(UserCard)
  .errors({ ImageUnprocessable })
  .mutation(async ({ input, context }) =>
    ok(await context.users.setAvatarFromKey(input.userId, input.key)),
  );
```

The contract stays fully typed and wire-safe, uploads scale on your storage
provider instead of your app server, resumable and multipart-to-storage uploads
work with no library involvement, and the RPC endpoint keeps its single
content-type. A profile picture, a video, an attachment — all the same shape: a
reference on the contract, the bytes handled by infrastructure built for bytes.
