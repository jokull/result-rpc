---
name: result-rpc
description: Build type-safe RPC between a server and a React app with result-rpc — one Result<T,E> and one wire-safe tagged-error union per procedure, error-owning React shells, a normalized entity cache, Drizzle-derived models, cursor pagination, and offline handling. Use when working in a project that depends on `result-rpc`, defining contracts/routers/procedures, wiring the browser client, writing hooks (useResultQuery/useResultMutation/useResultPaginatedQuery/useResultSubscription), boundaryShells, entity models, or migrating from tRPC.
---

# result-rpc

result-rpc is the RPC layer for a React app that outgrew tRPC's happy path:
production teams hitting offline, 5xx, session expiry, and observability. Every
procedure returns one **`Result<T, E>`** on the wire against a **declared,
closed tagged-error union**; failures are values you narrow, not exceptions you
catch. React **shells** own failures by position, an entity cache patches by
identity, and models can be **derived from Drizzle** so the wire contract can't
drift from the database.

This skill is a map. The documentation at **https://result-rpc.solberg.is** is
the single source of truth — every page is also served as raw Markdown by
appending `.md` to its URL, and the whole set is indexed at
`https://result-rpc.solberg.is/llms.txt` (full text at `/llms-full.txt`). For
any task below, **fetch the linked `.md` page** rather than guessing — the docs
carry the current API, and this file only routes you there.

## Read this first — the one rule that is a security bug if broken

result-rpc ships a **real client value** to the browser (not just a type, the
way tRPC ships `AppRouter`). So **what you import decides what bundles**:

> Build the browser client from a **`contract()`**, and define that contract in
> a module that **never imports handler or server code**. Importing the
> **router** (or a contract module that value-imports server code) ships your
> handlers, database driver, and any secret they close over to every visitor.
> Bundlers do **not** tree-shake this away.

If you touch client wiring, read
**https://result-rpc.solberg.is/concepts/client-boundary.md** before anything
else. `import type` from a server module is safe (erased); a value import is the
footgun.

## Task → page map

Fetch the `.md` version (append `.md`) of the page you need:

| When you're… | Read |
| --- | --- |
| Getting the mental model | `/start/introduction` · `/start/quickstart` |
| Installing / project layout | `/start/installation` |
| **Wiring the browser client (do this right)** | **`/concepts/client-boundary`** · `/concepts/client` |
| Declaring errors + visibility | `/concepts/errors` |
| Working with Result values (gen, all, match) | `/concepts/results` |
| Defining procedures/routers/contracts | `/concepts/contract` |
| Passing request context | `/concepts/context` |
| Wire codecs (input/output shapes) | `/concepts/wire` |
| React hooks + provider | `/concepts/react` |
| Mutations, optimistic updates, `.affects()` | `/concepts/mutations` |
| Entity models + normalized cache | `/concepts/entities` |
| Cursor pagination | `/concepts/pagination` |
| Subscriptions | `/concepts/subscriptions` |
| Error-owning shells (boundaryShells) | `/concepts/shells` |
| Layered context/auth | `/concepts/layers` |
| Stale clients across deploys | `/concepts/deploys` |
| Forms + validateStandard | `/guides/forms` |
| Deriving models from Drizzle | `/guides/drizzle` |
| TanStack Router integration | `/guides/routing` |
| Testing (parity client, counter-pins) | `/guides/testing` |
| Sentry/observability | `/guides/observability` |
| Coming from tRPC | `/guides/migrating-from-trpc` |
| Worked examples (01–08) | `/reference/examples` |
| Known sharp edges | `/reference/sharp-edges` |

## Non-negotiables when writing result-rpc code

- **Errors are declared and closed.** Each procedure lists its error union with
  `.errors({...})`; handlers `return err(...)`, they don't throw. Private
  (`visibility: "private"`) errors never appear in a procedure's `.errors()`.
- **The contract is the error registry.** One tag → one definition across the
  app; shells claim by tag.
- **Contracts are handler-free.** See the client-boundary rule above.
- **Mutations declare their blast radius** in the contract (`.affects()`,
  `.writes()`, or by returning an entity) — not with ad-hoc `onSettled` at call
  sites.
- **Paginated queries** use `.paginate({ cursor })` on the server and
  `useResultPaginatedQuery` on the client; one cache entry per list.

When a page's guidance conflicts with this file, the page wins — it is
maintained; this map is not.
