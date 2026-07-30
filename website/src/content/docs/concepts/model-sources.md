---
title: "Model source compatibility"
description: "Use $satisfies<Source>() to catch drift without importing source code into the client."
---

A model is an explicit public wire contract. When it represents part of an
upstream row or domain object, `$satisfies<Source>()` proves that the selected
fields still agree with that source:

```ts
interface UserRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  passwordHash: string;
}

export const User = defineModel("user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    avatarUrl: wire.nullable(wire.string),
  },
}).$satisfies<UserRow>();
```

The assertion enforces one precise relationship:

- Every model field must exist in the source.
- Its TypeScript type and nullability must match exactly. (`readonly` is not a
  difference in values, so it is compared modulo `readonly` — wire codecs
  decode readonly by design, and a source column typed `string[]` matches.)
- The source may contain additional fields. They do not join the model.
- The method returns the same model and performs no runtime reflection.

`passwordHash` is allowed as a source field but is absent from the model, so
it cannot appear in a model view or RPC response. If `avatarUrl` becomes
non-nullable—or the model forgets that it is nullable—the assertion stops
type-checking.

## Type-only sources

Use `import type` when the source lives in a server module:

```ts
import type { notes } from "../server/schema.js";

export const Note = defineModel("note", {
  key: "id",
  shape: {
    id: wire.string,
    title: wire.string,
    updatedAt: wire.date,
  },
}).$satisfies<typeof notes.$inferSelect>();
```

TypeScript erases that import. The client receives the `defineModel` codec,
not the database table, its builders, driver, or private column names. This
works with any source type: a query row, Prisma payload, Kysely result,
generated API type, or ordinary interface.

## What it does not prove

`$satisfies<Source>()` is a structural drift check. It does not derive or
validate:

- Runtime codecs or refinements
- That the model's declared identity matches a database primary key
- Length, uniqueness, foreign-key, or check constraints
- Mapping logic between differently shaped fields

Those remain explicit contract decisions. If the source uses `created_at`
and the public model uses `createdAt`, map the row in the handler and check
the model against the mapped domain type instead.

`defineModel` itself still enforces the local identity contract: key codecs
must decode to `string` or `number`, and every `pick`/`select` must include all
key fields. `$satisfies<Source>()` does not infer that those fields are the
source system's primary key; it only checks their TypeScript types.

This separation is deliberate: runtime reflection would require importing
and executing the source module in the browser, while type-only compatibility
keeps the model small, inspectable, and bundler-independent.

## Views remain the endpoint allowlist

The model shape answers “may this field cross the wire at all?” A view answers
“does this endpoint ship it?” Continue to scope outputs with `pick`, `select`,
or an explained `all`:

```ts
export const UserRef = User.pick("id", "name");
export const UserCard = User.pick("id", "name", "avatarUrl");
export const UserSelf = User.all("the viewer is the subject of this record");
```

Source compatibility does not widen any of those views.
