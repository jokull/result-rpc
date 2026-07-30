# result-rpc ticket demo

The source for [demo.result-rpc.com](https://demo.result-rpc.com): a real ticket
tracker that makes result-rpc cache behavior visible.

It demonstrates:

- optimistic entity updates that patch the list and detail pane before the
  delayed mutation settles;
- cursor pagination under one stable list identity;
- entity responses that reconcile every cached projection without refetching;
- explicit `.affects()` invalidation when a mutation changes list membership
  or an aggregate;
- batched initial queries, a structured client-event timeline, offline holding,
  and contract-skew protection;
- a guided error stack where the built-in transport owner, an authentication
  shell, a write-access shell, and a local optimistic-concurrency conflict each
  discharge at the UI layer that can actually resolve them;
- a browser contract graph that excludes the D1 implementation and server
  handlers.

Each browser gets a durable anonymous workspace. Only the workspace token is
device-local; tickets live in Cloudflare D1.

Open **error stack** in the top bar and arm the guided run. The next real ticket
edit starts signed out, then becomes read-only, then reaches a deliberately
stale version. The two shells open app-level dialogs while the editor receives
only `ticket/not-found | ticket/conflict`. Every retry is explicit because a
shell never silently replays a failed mutation.

## Development

```bash
npm install
npm run dev
```

Deploys go directly to the `result-rpc-demo` Worker and D1 database in the
result-rpc.com Cloudflare account:

```bash
npm run deploy
```

`demo.result-rpc.com` is a Worker Custom Domain declared in `wrangler.jsonc`,
so Cloudflare owns its DNS record and certificate lifecycle.

The Worker configuration is the source of truth for runtime and binding types:

```bash
npm run cf-typegen
npm run cf-types:check
```

`wrangler types` generates `worker-configuration.d.ts` from `wrangler.jsonc`,
including the exact APIs selected by its compatibility date and flags. The same
config is consumed by the Cloudflare Vite plugin.

## Verification

```bash
npm run typecheck
npm run lint
npm test
```

The rendered-build test also scans browser assets for a planted server-only
canary and SQL schema text.

## Structure

- `shared/` contains models, errors, and the handler-free RPC contract.
- `server/` implements that contract against D1.
- `client/` creates the browser client from the shared contract only.
- `app/` contains the vinext/React application and `/api/rpc` mount.
- `db/` owns runtime schema initialization and the D1 access boundary.
