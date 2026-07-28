---
title: "Services and request context"
description: "Two kinds of context: a process-lifetime service graph and request middleware composed by requirement."
---

A procedure sees one `context`, but two different things feed it, with
different lifetimes and failure rules:

|                            | Services                                    | Request middleware                      |
| -------------------------- | ------------------------------------------- | --------------------------------------- |
| Examples                   | database pool, worker bindings, API clients | session, viewer, organization           |
| Lifetime                   | process                                     | request                                 |
| Shape                      | dependency graph                            | ordered chain                           |
| Can fail with a wire error | no — a broken service is a broken process   | yes — failures join the operation union |
| Owned by                   | `defineService` / `resolveServices`         | middleware                              |

## Services

If you have read about Effect: this is its service/dependency-injection idea
at its useful core — declare what each resource needs, resolve the graph once,
memoize by identity — without fibers, without `Effect.gen`, without a runtime.
It is a small feature, not a religion.

```ts
import { defineService, resolveServices } from "result-rpc";

const Db = defineService("db", {
  create: () => createPool(env.DATABASE_URL),
});

const Mailer = defineService("mailer", {
  needs: { db: Db },
  create: ({ db }) => createMailer(db),
});

const services = await resolveServices({ db: Db, mailer: Mailer });
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
});
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
const session = app
  .middleware<{ viewer: User | null }>()
  .use(async ({ context, next }) =>
    next({ context: { ...context, viewer: await userFromCookie(context) } }),
  );

const requireViewer = app
  .middleware<{ viewer: User }>()
  .after(session) // handler sees viewer: User | null
  .errors({ Unauthorized })
  .use(({ context, errors, next }) =>
    context.viewer === null
      ? err(errors.Unauthorized())
      : next({ context: { ...context, viewer: context.viewer } }),
  );
```

A mutation then demands exactly one thing:

```ts
export const renameDoc = app
  .procedure()
  .input(RenameInput)
  .output(DocCodec)
  .use(requireViewer) // session comes along, in order
  .mutation(({ context, input }) =>
    // context.viewer: User
    context.db.docs.rename(input, context.viewer),
  );
```

`.use(session)` followed by `.use(requireViewer)` still runs `session` once —
composition is deduplicated by reference identity, the same rule as services
(module constants, not inline builds). A middleware whose input demands
context the procedure cannot supply is a type error, so requirements are
checked, not hoped for.

## Setting response headers, and logging someone in

Writing a response header is a **declared capability**. A procedure calls
`.headers()` and receives `context.headers`, a `Headers` to append to — a
session cookie on login, a `cache-control`, a rate-limit hint. A procedure that
does not declare it has no `context.headers` at all.

```ts
const login = app
  .procedure()
  .headers()
  .input(wire.object({ email: wire.string, password: wire.string }))
  .output(wire.object({ userId: wire.string }))
  .errors({ BadCredentials })
  .mutation(async ({ input, context, errors }) => {
    const user = await context.db.verify(input.email, input.password);
    if (!user) return err(errors.BadCredentials({}));

    context.headers.append(
      "set-cookie",
      `session=${await mintToken(user)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
    );
    return ok({ userId: user.id });
  });
```

Note the mutation returns a `Result` like anything else — bad credentials are a
declared failure, not an exception.

Reading cookies needs nothing new; `createContext` has the request:

```ts
createContext: ({ request }) => ({
  db,
  session: parseCookie(request.headers.get("cookie"))?.session,
});
```

A middleware that rotates a session cookie declares the same way, and then
every procedure using it must declare `.headers()` too — the same rule that
makes a middleware's errors part of its procedures' declared unions:

```ts
const rotateSession = app
  .middleware()
  .headers()
  .use(({ context, next }) => {
    context.headers.append("set-cookie", `session=${refresh(context)}; HttpOnly; Path=/`);
    return next({ context });
  });
```

### Why declare it instead of just writing it

The declaration is recorded in the contract, which means a transport knows
_before dispatch_ that this call's response headers cannot be sent early.

That matters because batching and streaming pull in opposite directions. A
streamed batch sends its headers first and its results as they arrive — which
means a `set-cookie` written by a handler that has not finished yet arrives
after the headers are already on the wire, and is silently dropped. tRPC has
exactly this hazard: `ctx.resHeaders` works under `httpBatchLink` and silently
stops working under `httpBatchStreamLink`, with no error and no warning. The
usual workaround is to move the cookie into `responseMeta`, a hook that runs
before the procedure has produced a result.

Declaring the capability makes the conflict statically visible instead of
silent, and it is why the flag is part of the [contract
digest](/concepts/deploys/) — a client and server that disagreed about it
would reintroduce the same dropped cookie.

Two consequences follow:

**A batch shares one response.** Several procedures answered in one HTTP request
share its headers, so their `set-cookie`s combine rather than overwrite. That is
usually what you want; it does mean two logins in one batch set two cookies.

**A subscription cannot declare `.headers()` at all** — it throws. Its response
is on the wire before the stream, and therefore before any of its middleware or
handler code runs, so there is no moment at which a write could land. Set the
header in the request that opens the stream instead.

The response is otherwise the protocol's. Status is derived from the failing
error's declared `httpStatus` rather than chosen by a handler — that is what
lets a client tell a real result-rpc failure from an intermediary's 502 — and
the body is always the Result envelope.
