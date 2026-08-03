/**
 * A `.resumable()` subscription survives an interrupted connection: the client
 * derives a resume token from the last event it decoded, and the handler
 * receives it as `lastEventId` on the next connect. Without the declaration,
 * a reconnect reopens the stream from the top — the pre-existing behaviour,
 * pinned here so the difference stays visible.
 */
import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { createQueryRuntime, type SubscriptionState } from "./runtime.js";

const Dropped = error({
  tag: "feed/dropped",
  data: wire.object({}),
  retry: "transient",
});

const Message = wire.object({ id: wire.string, body: wire.string });
const LOG = [
  { id: "e1", body: "one" },
  { id: "e2", body: "two" },
  { id: "e3", body: "three" },
  { id: "e4", body: "four" },
];

/**
 * `resumable` toggles the declaration; everything else is identical, so a
 * difference between the two runs is attributable to it alone.
 */
const boot = (resumable: boolean) => {
  const app = rpc.context<{}>();
  const seen: (string | undefined)[] = [];
  let connections = 0;

  const base = app
    .procedure()
    .input(wire.object({ room: wire.string }))
    .output(Message);
  const contract = (resumable ? base.resumable({ eventId: (m) => m.id }) : base)
    .errors({ Dropped })
    .subscription();

  const feed = app.implement(contract).stream(async function* ({ lastEventId, errors }) {
    seen.push(lastEventId);
    const attempt = ++connections;
    const after = lastEventId === undefined ? -1 : LOG.findIndex((m) => m.id === lastEventId);
    for (const message of LOG.slice(after + 1)) {
      // The first connection drops halfway; the second runs to completion.
      if (attempt === 1 && message.id === "e3") {
        yield err(errors.Dropped({}));
        return;
      }
      yield ok(message);
    }
  });

  const router = app.router({ feed });
  const handler = createFetchHandler({ router, createContext: () => ({}) });
  const client = createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://probe.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });
  return { client, seen, connections: () => connections };
};

const collect = async (resumable: boolean) => {
  const { client, seen } = boot(resumable);
  const runtime = createQueryRuntime({ client });
  const bodies: string[] = [];
  const live = runtime.subscription(client.feed, { room: "r1" }, { retryDelayMs: 0 });
  // The observer notifies on every state change, connection transitions
  // included; `eventCount` is what distinguishes a new event from a re-render.
  let counted = 0;
  const stop = live.subscribe(() => {
    const state = live.getCurrentState() as SubscriptionState<{ id: string; body: string }, never>;
    if (state.eventCount > counted && state.result?.isOk()) {
      counted = state.eventCount;
      bodies.push(state.result.value.id);
    }
  });
  await Bun.sleep(150);
  stop();
  live.close();
  return { bodies, seen };
};

describe("resumable subscriptions", () => {
  test("a reconnect resumes after the last observed event", async () => {
    const { bodies, seen } = await collect(true);
    // First connect has no resume point; the reconnect carries e2, the last
    // event that actually reached the client before the drop.
    expect(seen).toEqual([undefined, "e2"]);
    // Every event is delivered exactly once — no gap, no replay.
    expect(bodies).toEqual(["e1", "e2", "e3", "e4"]);
  });

  test("without the declaration a reconnect replays from the top", async () => {
    const { bodies, seen } = await collect(false);
    expect(seen).toEqual([undefined, undefined]);
    // e1 and e2 arrive twice: the gap the declaration exists to close.
    expect(bodies).toEqual(["e1", "e2", "e1", "e2", "e3", "e4"]);
  });
});
