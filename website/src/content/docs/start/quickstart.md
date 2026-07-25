---
title: "Quickstart"
description: "One query, one domain error, a provider, and a hook \u2014 the smallest possible result-rpc app."
---

The smallest possible app: one procedure, one domain error, no shells. This is
`examples/01-hello` in the repository, verbatim.

Coming from tRPC, watch for two differences. The handler *returns* its
failure — `err(...)` against a declared union — instead of throwing it. And
the component switches over one channel that includes the transport: there is
no `query.error` on the side, and no `Result` buried inside `query.data`
either.

## Declare the error and the procedure

```ts
import { err, error, ok, rpc, wire } from "result-rpc"

const GreetingNotFound = error({
  tag: "greeting/not-found",
  data: wire.object({ name: wire.string }),
  httpStatus: 404,
})

const app = rpc.context<{}>()

export const router = app.router({
  greet: app.procedure()
    .input(wire.object({ name: wire.string }))
    .output(wire.string)
    .errors({ GreetingNotFound })
    .query(({ input, errors }) =>
      input.name === "nobody"
        ? err(errors.GreetingNotFound({ name: input.name }))
        : ok(`Hello, ${input.name}!`)),
})
```

The handler must return the declared Result — returning an undeclared tag is a
type error, and smuggling one at runtime yields a sanitized `server/internal`.

## Serve it

```ts
import { createFetchHandler } from "result-rpc/server"

export const handler = createFetchHandler({
  router,
  createContext: () => ({}),
})
```

`handler` is a `(request: Request) => Promise<Response>` — mount it on any
fetch-native server (Bun, Deno, Cloudflare Workers, Node 20+, Hono, Next
route handlers).

## Call it

```ts
import { createClient, fetchTransport } from "result-rpc/client"

export const client = createClient({
  router,
  transport: fetchTransport({ url: "/rpc" }),
})
```

## Render it

```tsx
import { ResultRpcProvider, useResultQuery } from "result-rpc/react"

export function App({ name }: { name: string }) {
  return (
    <ResultRpcProvider client={client}>
      <Greeting name={name} />
    </ResultRpcProvider>
  )
}

function Greeting({ name }: { name: string }) {
  const greeting = useResultQuery(client.greet, { name })

  switch (greeting.state) {
    case "pending":
      return <p>…</p>
    case "success":
      return <p>{greeting.value}</p>
    case "failure":
      switch (greeting.error._tag) {
        case "greeting/not-found":
          return <p>No greeting for {greeting.error.data.name}</p>
        default:
          return <p>Something went wrong</p>
      }
  }
}
```

That `default:` branch is where this quickstart stops and the library begins:
the failure union also carries transport, protocol, and staleness tags, and
branching on all of them in every component is exactly the burden
[shells](/concepts/shells/) remove. Continue with
[errors](/concepts/errors/) → [the contract](/concepts/contract/) →
[shells](/concepts/shells/), or read the
[examples ladder](/reference/examples/) end to end.
