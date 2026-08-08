<p align="center">
  <img src="brand/logo/result-rpc-lockup-preview.png" alt="result-rpc" width="720" />
</p>

<p align="center"><strong>Typed RPC for React. Errors accumulate along the call path and discharge along the component tree.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/result-rpc"><img src="https://img.shields.io/npm/v/result-rpc?color=2357d9" alt="npm version" /></a>
  ·
  <a href="https://github.com/jokull/result-rpc/actions/workflows/ci.yml"><img src="https://github.com/jokull/result-rpc/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  ·
  <a href="https://result-rpc.com/start/quickstart/">Quickstart</a>
  ·
  <a href="https://result-rpc.com">Documentation</a>
  ·
  <a href="https://demo.result-rpc.com">Live demo</a>
</p>

---

> **Coding agent?** Start at [`https://result-rpc.com/skill.md`](https://result-rpc.com/skill.md).
>
> Package already installed? Read
> `node_modules/result-rpc/skills/result-rpc/SKILL.md`.

result-rpc is an RPC layer for React with one closed, wire-safe failure union
per operation. Results are [better-result](https://github.com/dmmulroy/better-result) 3.0's
errors-as-values runtime — result-rpc adds the RPC boundary: only declared,
serializable tagged errors cross the wire. Procedures return expected failures
as tagged values; unexpected exceptions remain defects and cross the server
boundary only as a sanitized `server/internal` failure.

The client adds the failures that originate along its part of the call path:
offline, network, timeout, protocol, decode, and stale-client failures. React
shells then claim the failures owned by higher-level UI behavior and subtract
them from the unions visible below.

```ts
const query = useResultQuery(client.doc.byId, { id: "doc_123" });

if (query.state === "failure") {
  // DocNotFound | Unauthorized | ServerInternal | Offline | NetworkFailure |
  // Timeout | HttpFailure | ProtocolViolation | DecodeFailure | Stale
  query.error;
}
```

The same operation under authentication and transport shells exposes only the
failure this component still owns:

```ts
const query = AuthShell.useQuery(client.doc.byId, { id: "doc_123" });

if (query.state === "failure") {
  // DocNotFound
  query.error;
}
```

Nothing was removed from the operation. The mounted shell chain owns the other
tags and provides the corresponding behavior: a login dialog, offline banner,
redirect, retry surface, or error-boundary escalation.

## Install

```sh
npm install result-rpc
```

Also available through `pnpm add result-rpc`, `yarn add result-rpc`, or
`bun add result-rpc`.

Requirements: Node.js 20.19.5 or newer and TypeScript 5.4 or newer. The React
bindings require React 18.3 or newer. Published declarations are tested with
TypeScript 5.4, 5.9, and 7.0.

[Build the smallest complete app →](https://result-rpc.com/start/quickstart/)

## What it provides

- Runtime contracts with codecs for inputs, outputs, tagged errors, and rich
  wire values.
- Server middleware and layers whose errors become part of each affected
  procedure's union.
- Direct browser and server clients that resolve `Result<T, ExactUnion>`.
- A Result-native query runtime with caching, retries, pagination, optimistic
  updates, invalidation, entities, SSR, and hydration.
- React shells that own classes of failure and narrow procedure unions by tree
  position.
- Structured observability for declared failures and private server defects.

The package keeps runtime boundaries explicit:

| Import               | Purpose                                                     |
| -------------------- | ----------------------------------------------------------- |
| `result-rpc`         | Isomorphic contracts, codecs, Results, errors, and models   |
| `result-rpc/server`  | Server implementations, handlers, and direct server clients |
| `result-rpc/client`  | Browser clients and transports                              |
| `result-rpc/query`   | React-free query runtime, including SSR work                |
| `result-rpc/react`   | Providers, hooks, shells, and hydration boundaries          |
| `result-rpc/testing` | Wire-parity test clients                                    |

Database error handling is not an entry point — it lives in
[`db-result`](https://github.com/jokull/db-result), a driver-agnostic Result
boundary built on better-result. Fold its `db/*` tags into declared domain
errors at the handler boundary; the procedure contract guards the lane.

Browser code imports the shared contract, never the implemented server router.
That boundary keeps handlers, database drivers, secrets, and server-only error
graphs out of client bundles.

## Documentation

- [Coding-agent start and canonical skill](https://result-rpc.com/start/agents/)
- [Introduction](https://result-rpc.com/start/introduction/)
- [Quickstart](https://result-rpc.com/start/quickstart/)
- [Errors and visibility](https://result-rpc.com/concepts/errors/)
- [Shells and positional failure ownership](https://result-rpc.com/concepts/shells/)
- [Client/server bundle boundaries](https://result-rpc.com/concepts/client-boundary/)
- [Entities and cache coherence](https://result-rpc.com/concepts/entities/)
- [SSR and React Server Components](https://result-rpc.com/guides/rsc/)
- [Migrating from tRPC](https://result-rpc.com/guides/migrating-from-trpc/)
- [Runnable examples](https://result-rpc.com/reference/examples/)

The [ticket demo](https://demo.result-rpc.com) exercises optimistic updates,
pagination, invalidation, entity patching, offline behavior, and layered error
ownership.

The target architecture, the invariants it holds itself to, and the research
behind them ship with the package: [ARCHITECTURE.md](ARCHITECTURE.md) and
[DESIGN.md](DESIGN.md).

## Status

`0.4.0` is published with npm provenance. The project is pre-1.0, so its API
may still change between minor releases. [CHANGELOG.md](CHANGELOG.md) records
what changed; [RELEASING.md](RELEASING.md) documents the release and
verification process.

MIT
