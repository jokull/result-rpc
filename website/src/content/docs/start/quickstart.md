---
title: "Quickstart"
description: "One query, one domain error, a provider, and a hook \u2014 the smallest possible result-rpc app."
---

The smallest browser-safe app: one procedure, one domain error, no shells.
The contract is separate from its server implementation because the browser
needs the codecs and error definitions, not the handler or its dependencies.

Coming from tRPC, watch for two differences. The handler _returns_ its
failure — `err(...)` against a declared union — instead of throwing it. And
the component switches over one channel that includes the transport: there is
no `query.error` on the side, and no `Result` buried inside `query.data`
either.

## Install

```sh
npm install result-rpc
```

Installing result-rpc brings in its peer dependency
[`better-result@^3.0.0`](https://github.com/dmmulroy/better-result) — npm 7+ and
pnpm install peers automatically. The `Result` you compose is better-result's
class; result-rpc re-exports the surface (`ok`, `err`, `gen`, `tryPromise`,
`InferErr`/`InferOk`/`GenErr`), and the shared class identity is what the
boundary's `instanceof` checks rely on. See [Results](/concepts/results/) for
the division of labor and the [FAQ](/reference/faq/) for the identity rule.

This quickstart requires Node.js 20.19.5 or newer, TypeScript 5.4 or newer, and
React 18.3 or newer. See [Installation](/start/installation/) for other package
managers and the package's runtime entry points.

## Declare the error and the procedure

```ts
import { error, rpc, wire } from "result-rpc";

export const GreetingNotFound = error({
  tag: "greeting/not-found",
  data: wire.object({ name: wire.string }),
  httpStatus: 404,
});

export const app = rpc.context<{}>();

export const greetContract = app
  .procedure()
  .input(wire.object({ name: wire.string }))
  .output(wire.string)
  .errors({ GreetingNotFound })
  .query();

export const appContract = app.contract({
  greet: greetContract,
});
```

This shared module contains only the runtime contract: codecs, error
definitions, and policies. It is safe to import from either side of the wire.

Infer application types from the procedure instead of restating the codec or
its error union:

```ts
import type { ProcedureError, ProcedureOutput } from "result-rpc";

type Greeting = ProcedureOutput<typeof greetContract>; // string
type GreetingFailure = ProcedureError<typeof greetContract>; // GreetingNotFound
```

Use `RouterInputs`, `RouterOutputs`, and `RouterErrors` instead when the nested
application shape is more useful than one named procedure.

For rich values, describe the real value on the contract. Do not flatten it to
a JSON-shaped substitute:

```ts
const availabilityContract = app
  .procedure()
  .input(wire.object({ propertyId: wire.string }))
  .output(wire.object({ available: wire.boolean, updatedAt: wire.date }))
  .query();
```

The browser receives `updatedAt` as a `Date`. See [The wire](/concepts/wire/)
for the full codec table.

## Implement and serve it

```ts
import { err, ok } from "result-rpc";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import { greetContract } from "./contract";

const server = serverRpc.context<{}>();
const greet = server
  .implement(greetContract)
  .handler(({ input, errors }) =>
    input.name === "nobody"
      ? err(errors.GreetingNotFound({ name: input.name }))
      : ok(`Hello, ${input.name}!`),
  );

export const router = server.router({ greet });

export const handler = createFetchHandler({
  router,
  createContext: () => ({}),
});
```

`handler` is a `(request: Request) => Promise<Response>` — mount it on any
fetch-native server (Bun, Deno, Cloudflare Workers, Node 20+, Hono, Next
route handlers).

For a concrete Hono + Vite development setup, mount that fetch handler on a
small Node server:

```ts
// server.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { handler } from "./server/rpc";

const server = new Hono();
server.all("/rpc", (context) => handler(context.req.raw));
serve({ fetch: server.fetch, port: 3001 });
```

and let the browser keep using the relative `/rpc` URL through Vite:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/rpc": "http://127.0.0.1:3001" } },
});
```

Run `tsx watch server.ts` and `vite` as the two development processes. In a
single fetch-native deployment, mount `handler` directly and omit the proxy.

The handler must return the declared Result. Returning an undeclared tag is a
type error; throwing unexpectedly or smuggling a malformed error is treated as
a defect and yields a sanitized `server/internal`. Configure `onInternalError`
on the fetch handler to report the private cause.

## Adopt fallible external I/O

An anticipated failed fetch, database call, or SDK call belongs in a declared
Result branch. Use `tryPromise(fn, onThrow)` at that throwing boundary:

```ts
import { tryPromise } from "result-rpc";

const response =
  yield *
  (await tryPromise(
    () => fetch(url),
    () => errors.GreetingNotFound({ name: input.name }),
  ));
```

Fold provider-specific detail into the public error the caller can act on;
unexpected programmer defects may still throw and become sanitized
`server/internal`. The complete pattern is in
[Result composition](/concepts/results/) and [Errors](/concepts/errors/).

## Call it

```ts
import { createBrowserClient, fetchTransport } from "result-rpc/client";
import { appContract } from "./contract";

export const client = createBrowserClient({
  contract: appContract,
  transport: fetchTransport({ url: "/rpc" }),
});
```

Do not import the implemented router into browser code. A router retains its
handlers and may retain server-only dependencies; the contract is the public
runtime value intended for the client bundle.

## Render it

```tsx
import { ResultRpcProvider, useResultQuery } from "result-rpc/react";

export function App({ name }: { name: string }) {
  return (
    <ResultRpcProvider client={client}>
      <Greeting name={name} />
    </ResultRpcProvider>
  );
}

function Greeting({ name }: { name: string }) {
  const greeting = useResultQuery(client.greet, { name });

  switch (greeting.state) {
    case "pending":
      return <p>…</p>;
    case "success":
      return <p>{greeting.value}</p>;
    case "failure":
      switch (greeting.error._tag) {
        case "greeting/not-found":
          return <p>No greeting for {greeting.error.data.name}</p>;
        default:
          return <p>Something went wrong</p>;
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
