/**
 * A subscription handler's `finally` must run however the stream ends. It is
 * where real handlers close a database cursor, unsubscribe from a broker, or
 * release a lock, so a path that skips it leaks once per connection.
 *
 * The natural-termination case is the control: it passed before the
 * declared-error case was fixed, which is what makes the failure attributable.
 */
import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { serverRpc } from "./index.js";
import { createFetchHandler } from "./http.js";
import { PROTOCOL_CONTENT_TYPE } from "../protocol.js";
import { serialize } from "../serializer.js";

const Denied = error({ tag: "feed/denied", httpStatus: 401 });

const app = serverRpc.context<{}>();
const contract = app.procedure().output(wire.string).errors({ Denied }).subscription();

interface Run {
  readonly cleanups: number;
  readonly abortedAtCleanup: boolean | undefined;
}

const drain = async (endWith: "return" | "error"): Promise<Run> => {
  let cleanups = 0;
  let abortedAtCleanup: boolean | undefined;

  const feed = app.implement(contract).stream(async function* ({ errors, signal }) {
    try {
      yield ok("first");
      if (endWith === "error") yield err(errors.Denied());
    } finally {
      cleanups += 1;
      abortedAtCleanup = signal.aborted;
    }
  });

  const handler = createFetchHandler({
    router: app.router({ feed }),
    createContext: () => ({}),
  });
  const body = serialize({ v: 1, path: "feed", input: {} });
  if (!body.ok) throw new Error("failed to encode the request envelope");
  const response = await handler(
    new Request("https://example.test/rpc", {
      method: "POST",
      headers: { "content-type": PROTOCOL_CONTENT_TYPE },
      body: body.value,
    }),
  );
  await response.text();
  // Cleanup runs as the producer settles, which is a turn or two behind the
  // last frame reaching the reader.
  await Bun.sleep(30);
  return { cleanups, abortedAtCleanup };
};

describe("subscription handler cleanup", () => {
  test("runs when the stream ends naturally", async () => {
    const run = await drain("return");
    expect(run.cleanups).toBe(1);
  });

  test("runs when the stream ends in a declared error", async () => {
    const run = await drain("error");
    expect(run.cleanups).toBe(1);
  });

  test("the handler's signal is aborted by the time cleanup runs", async () => {
    // Cleanup that awaits IO needs to see a cancelled lifetime, not a live one.
    const run = await drain("error");
    expect(run.abortedAtCleanup).toBe(true);
  });
});
