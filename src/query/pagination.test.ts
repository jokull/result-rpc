import { describe, expect, test } from "bun:test";
import { ok, wire } from "../index.js";
import { createClient } from "../client/client.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { defineModel } from "../model.js";
import type { AnyTaggedError } from "../error.js";
import {
  createQueryRuntime,
  type MutationProcedureClientLike,
  type PaginatedProcedureClientLike,
  type PaginatedState,
  type ResultPaginatedObserver,
} from "./runtime.js";

const Item = defineModel("item", {
  key: "id",
  shape: {
    id: wire.string,
    label: wire.string,
  },
});

// A seeded page store: 5 items, page size 2, opaque string cursor = offset.
const ITEMS = [
  { id: "1", label: "one" },
  { id: "2", label: "two" },
  { id: "3", label: "three" },
  { id: "4", label: "four" },
  { id: "5", label: "five" },
] as const;

let pageRequests = 0;

const r = rpc.context<{ readonly items: readonly { id: string; label: string }[] }>();

const feed = r
  .procedure()
  .input(wire.object({ q: wire.string }))
  .output(Item.all("test fixture"))
  .paginate({ cursor: wire.string }, ({ input, context }) => {
    pageRequests += 1;
    const offset = input.cursor === null ? 0 : Number(input.cursor);
    const filtered = context.items.filter((item) =>
      input.list.q === "" || item.label.includes(input.list.q));
    const slice = filtered.slice(offset, offset + 2);
    const nextOffset = offset + 2;
    return ok({
      items: slice,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    });
  });

const rename = r
  .procedure()
  .input(wire.object({ id: wire.string, label: wire.string }))
  .output(Item.all("test fixture"))
  .mutation(({ input }) => ok(input));

const router = r.router({ feed, rename });

const makeRuntime = () => {
  let calls = 0;
  const handler = createFetchHandler({
    router,
    createContext: () => ({ items: ITEMS.map((item) => ({ ...item })) }),
  });
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    return handler(new Request(input, init));
  }) as typeof globalThis.fetch;
  const client = createClient({
    router,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch: localFetch }),
  });
  const runtime = createQueryRuntime({ client });
  return { runtime, client, requestCount: () => calls };
};

const waitFor = <TItem, TCursor, E extends AnyTaggedError>(
  observer: ResultPaginatedObserver<TItem, TCursor, E>,
  predicate: (state: PaginatedState<TItem, TCursor, E>) => boolean,
): Promise<PaginatedState<TItem, TCursor, E>> => new Promise((resolve, reject) => {
  let unsubscribe: () => void = () => undefined;
  const timeout = setTimeout(() => {
    unsubscribe();
    reject(new Error("Timed out waiting for paginated state"));
  }, 6_000);
  const check = () => {
    const state = observer.getCurrentState();
    if (!predicate(state)) return;
    clearTimeout(timeout);
    unsubscribe();
    resolve(state);
  };
  unsubscribe = observer.subscribe(check);
  check();
});

describe("paginated query runtime", () => {
  test("first page loads two rows and reports a next cursor", async () => {
    const { runtime, client } = makeRuntime();
    const observer = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" });
    await observer.refetch();
    const state = observer.getCurrentState();
    expect(state.state).toBe("success");
    if (state.state !== "success") throw new Error("unreachable");
    expect(state.rows.map((row) => (row as { id: string }).id)).toEqual(["1", "2"]);
    expect(state.hasNext).toBe(true);
    expect(state.pageCount).toBe(1);
    observer.destroy();
    runtime.clear();
  });

  test("fetchNext appends the next page under one cache entry", async () => {
    const { runtime, client, requestCount } = makeRuntime();
    const observer = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" });
    await observer.refetch();
    const afterFirst = requestCount();
    await observer.fetchNext();
    await observer.fetchNext();
    const state = observer.getCurrentState();
    if (state.state !== "success") throw new Error("expected success");
    // Five items across three pages of size 2.
    expect(state.rows.map((row) => (row as { id: string }).id)).toEqual([
      "1", "2", "3", "4", "5",
    ]);
    expect(state.hasNext).toBe(false);
    expect(state.pageCount).toBe(3);
    // One HTTP request per page loaded past the first.
    expect(requestCount() - afterFirst).toBe(2);
    // Exactly one cache entry for the whole list, keyed on list identity.
    const runtimeCache = runtime as unknown as {
      cache: { key: (p: unknown, i: unknown) => readonly [string, string] };
    };
    const key = runtimeCache.cache.key(client.feed as unknown as PaginatedProcedureClientLike, { q: "" } as never);
    expect(key[0]).toBe("feed");
    observer.destroy();
    runtime.clear();
  });

  test("fetchNext past the last page is a no-op with no request", async () => {
    const { runtime, client, requestCount } = makeRuntime();
    const observer = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" });
    await observer.refetch();
    await observer.fetchNext();
    await observer.fetchNext();
    const settled = requestCount();
    await observer.fetchNext();
    expect(requestCount()).toBe(settled);
    observer.destroy();
    runtime.clear();
  });

  test("a rename patches a row on a loaded page at exactly one request", async () => {
    const { runtime, client, requestCount } = makeRuntime();
    // A real infinite list sets a staleTime — otherwise an active list
    // re-verifies its loaded pages whenever the cache is written, which is
    // correct convergence but not what this claim isolates.
    const observer = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" }, {
      staleTime: 60_000,
    });
    const stop = observer.subscribe(() => undefined);
    await observer.refetch();
    await observer.fetchNext(); // rows 1..4 loaded across two pages
    const loaded = requestCount();

    const mutation = runtime.mutation(client.rename as unknown as MutationProcedureClientLike);
    const result = await mutation.mutate({ id: "3", label: "THREE" });
    expect(result.ok).toBe(true);

    const state = await waitFor(observer, (s) =>
      s.state === "success"
      && s.rows.some((row) => (row as { id: string; label: string }).label === "THREE"));
    if (state.state !== "success") throw new Error("expected success");
    const renamed = state.rows.find((row) => (row as { id: string }).id === "3");
    expect((renamed as { label: string } | undefined)?.label).toBe("THREE");
    // Only the mutation crossed the wire — the page row patched in place.
    expect(requestCount() - loaded).toBe(1);
    stop();
    mutation.destroy();
    observer.destroy();
    runtime.clear();
  });

  test("rows are deduplicated by entity identity across page boundaries", async () => {
    const { runtime, client } = makeRuntime();
    const observer = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" });
    await observer.refetch();
    await observer.fetchNext();
    await observer.fetchNext();
    const state = observer.getCurrentState();
    if (state.state !== "success") throw new Error("expected success");
    const ids = state.rows.map((row) => (row as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    observer.destroy();
    runtime.clear();
  });

  test("observe() rejects a paginated procedure with a directing message", () => {
    const { runtime, client } = makeRuntime();
    expect(() => runtime.observe(client.feed as unknown as PaginatedProcedureClientLike, { q: "" } as never))
      .toThrow("paginated");
    runtime.clear();
  });

  test("filtered list keys a distinct cache entry", async () => {
    const { runtime, client } = makeRuntime();
    const all = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "" });
    const filtered = runtime.observePaginated(client.feed as unknown as PaginatedProcedureClientLike, { q: "t" });
    await all.refetch();
    await filtered.refetch();
    const filteredState = filtered.getCurrentState();
    if (filteredState.state !== "success") throw new Error("expected success");
    // "two" and "three" contain "t".
    expect(filteredState.rows.map((row) => (row as { label: string }).label))
      .toEqual(["two", "three"]);
    expect(all.key[1]).not.toBe(filtered.key[1]);
    all.destroy();
    filtered.destroy();
    runtime.clear();
  });
});
