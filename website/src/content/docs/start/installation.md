---
title: "Installation"
description: "One versioned package with one entry per runtime; the root is the contract language."
---

Install the single `result-rpc` package with your package manager:

```sh
npm install result-rpc
# or: pnpm add result-rpc
# or: yarn add result-rpc
# or: bun add result-rpc
```

Requirements:

- Node.js 20.19.5 or newer
- TypeScript 5.4 or newer
- React 18.3 or newer when using `result-rpc/react`

`result-rpc` brings [`better-result@^3.0.0`](https://github.com/dmmulroy/better-result)
as a peer dependency — npm 7+ and pnpm install it automatically, so there is no
extra install step for apps that don't use better-result directly. The `Result`
you compose is better-result's class; result-rpc re-exports the surface (`ok`,
`err`, `gen`, `tryCatch`, `tryPromise`, `InferErr`/`InferOk`/`GenErr`), and the
shared class identity is what the boundary's `instanceof` checks rely on. See
[Results](/concepts/results/) for the division of labor and the
[FAQ](/reference/faq/) for the identity rule.

The published declaration surface is tested with TypeScript 5.4, 5.9, and 7.0.
The package is ESM-only.

One versioned package, one entry per runtime — the root is everything
isomorphic (the contract language):

```ts
import {
  rpc,
  error,
  errorCatalog,
  err,
  ok,
  wire,
  defineLayer,
  defineService,
  resolveServices,
  type RouterInputs,
  type RouterOutputs,
} from "result-rpc";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import { batchFetchTransport, createBrowserClient } from "result-rpc/client";
import { createQueryRuntime } from "result-rpc/query";
import { defineShell, layerShell, ResultRpcProvider, useResultQuery } from "result-rpc/react";
import { createParityClient } from "result-rpc/testing";
```

| Entry                | Use it for                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| `result-rpc`         | Shared contracts, codecs, Results, error definitions, layers, services, and models |
| `result-rpc/server`  | Procedure implementations, fetch handlers, and direct server clients               |
| `result-rpc/client`  | Browser clients, transports, and client-originated failures                        |
| `result-rpc/query`   | The React-free query runtime, including server-side prefetching                    |
| `result-rpc/react`   | Providers, hooks, shells, and hydration boundaries                                 |
| `result-rpc/testing` | Test clients that exercise the real wire boundary                                  |

> **Keep implementations out of browser bundles.** Put the contract in a shared
> module and import that value when creating a browser client. Do not import the
> implemented server router: it retains its handlers and may retain database
> drivers, environment access, and private error classes. See [The client
> boundary](/concepts/client-boundary/).

Continue with the [quickstart](/start/quickstart/) to build one complete query.
