---
title: "Services and request context"
description: "Two kinds of context: a process-lifetime service graph and request middleware composed by requirement."
---

A procedure sees one `context`, but two different things feed it, with
different lifetimes and failure rules:

| | Services | Request middleware |
| --- | --- | --- |
| Examples | database pool, worker bindings, API clients | session, viewer, organization |
| Lifetime | process | request |
| Shape | dependency graph | ordered chain |
| Can fail with a wire error | no — a broken service is a broken process | yes — failures join the operation union |
| Owned by | `defineService` / `resolveServices` | middleware |

## Services

If you have read about Effect: this is its service/dependency-injection idea
at its useful core — declare what each resource needs, resolve the graph once,
memoize by identity — without fibers, without `Effect.gen`, without a runtime.
It is a small feature, not a religion.

```ts
import { defineService, resolveServices } from "result-rpc"

const Db = defineService("db", {
  create: () => createPool(env.DATABASE_URL),
})

const Mailer = defineService("mailer", {
  needs: { db: Db },
  create: ({ db }) => createMailer(db),
})

const services = await resolveServices({ db: Db, mailer: Mailer })
```

The graph is resolved once at process start and memoized by definition
reference — a service two others depend on is constructed exactly once. The
sharp edge, stated plainly: identity is by reference, so store definitions in
module constants; two `defineService` calls are two services.

The resolved record becomes the root context that every request closes over:

```ts
export const handleRpc = createFetchHandler({
  router: appRouter,
  createContext: ({ request }) => ({ ...services, request }),
})
```

Nothing pulls services per call — the auth middleware reads `context.db`
because the root context guarantees it, and swapping the whole record for a
test double is one argument to `createContext`.

## Middleware composes by requirement, not by ordering

The footgun: middleware order as tribal knowledge — `session` must run before
`requireViewer`, enforced by a comment. Here a middleware declares what it
runs after; the dependency's output becomes its input, the dependency's errors
join the union, and any `.use()` site pulls the whole chain in dependency
order:

```ts
const session = app.middleware<{ viewer: User | null }>()
  .use(async ({ context, next }) =>
    next({ context: { ...context, viewer: await userFromCookie(context) } }))

const requireViewer = app.middleware<{ viewer: User }>()
  .after(session)                        // handler sees viewer: User | null
  .errors({ Unauthorized })
  .use(({ context, errors, next }) =>
    context.viewer === null
      ? err(errors.Unauthorized({}))
      : next({ context: { ...context, viewer: context.viewer } }))
```

A mutation then demands exactly one thing:

```ts
export const renameDoc = app.procedure()
  .input(RenameInput)
  .output(DocCodec)
  .use(requireViewer)                    // session comes along, in order
  .mutation(({ context, input }) =>      // context.viewer: User
    context.db.docs.rename(input, context.viewer))
```

`.use(session)` followed by `.use(requireViewer)` still runs `session` once —
composition is deduplicated by reference identity, the same rule as services
(module constants, not inline builds). A middleware whose input demands
context the procedure cannot supply is a type error, so requirements are
checked, not hoped for.
