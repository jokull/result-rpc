import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
import { createParityClient } from "../testing/index.js";
import { createServerClient } from "./index.js";
import { rpc } from "./contract.js";

const Missing = error({
  tag: "parity/missing",
  data: wire.object({ at: wire.date }),
  httpStatus: 404,
  retry: "never",
  visibility: "public",
});

const r = rpc.context<{ readonly found: boolean }>();
const contract = r
  .procedure()
  .input(wire.object({ at: wire.date }))
  .output(wire.object({ at: wire.date, sequence: wire.bigint }))
  .errors({ Missing })
  .query();
const procedure = r
  .implement(contract)
  .handler(({ context, input, errors }) =>
    context.found ? ok({ at: input.at, sequence: 7n }) : err(errors.Missing({ at: input.at })),
  );
const router = r.router({ parity: { value: procedure } });

describe("parity client", () => {
  test("uses the real protocol and rich serializer locally", async () => {
    const at = new Date("2026-07-22T12:00:00.000Z");
    const client = createParityClient(router, { context: { found: true } });
    const result = await client.parity.value({ at });
    expect(result).toEqual(ok({ at, sequence: 7n }));
    if (result.isOk()) expect(result.value.at).not.toBe(at);
  });

  test("reconstructs declared errors rather than sharing object identity", async () => {
    const at = new Date("2026-07-22T12:00:00.000Z");
    const client = createParityClient(router, { context: { found: false } });
    const result = await client.parity.value({ at });
    expect(result).toEqual(err(Missing({ at })));
    if (!result.isOk() && result.error._tag === "parity/missing") {
      expect(result.error).toBeInstanceOf(Error);
      expect(Missing.is(result.error)).toBe(true);
      expect(result.error.data.at).not.toBe(at);
    }
  });
});

// --- server client -----------------------------------------------------------

const Private = error({
  tag: "direct/private",
  data: wire.object({ secret: wire.string }),
  retry: "never",
  visibility: "private",
});

const d = rpc.context<{ readonly userId: string | null }>();

const requireUser = d
  .middleware<{ readonly userId: string }>()
  .errors({ Missing })
  .use(({ context, errors, next }) =>
    context.userId === null
      ? err(errors.Missing({ at: new Date(0) }))
      : next({ context: { userId: context.userId } }),
  );

const whoami = d
  .procedure()
  .use(requireUser)
  .output(wire.object({ userId: wire.string, at: wire.date }))
  .errors({ Missing })
  .query(({ context }) => ok({ userId: context.userId, at: new Date("2026-01-01T00:00:00.000Z") }));

// Private errors cannot be declared in `.errors()` — the type system now
// enforces that. The leak this guards is a handler returning one anyway.
const leaks = d
  .procedure()
  .output(wire.string)
  .query(() => err(Private({ secret: "DIRECT_SECRET_do_not_ship" })) as never);

const badOutput = d
  .procedure()
  .output(wire.object({ n: wire.number }))
  .query(() => ok({ n: "not a number" } as never));

const acceptNull = d
  .procedure()
  .input(wire.null)
  .output(wire.null)
  .query(({ input }) => ok(input));

const throwingInput = {
  ...wire.string,
  encode: (_value: string) => {
    throw new Error("INPUT_SECRET");
  },
};
const streamContract = d.procedure().input(throwingInput).output(wire.string).subscription();
const brokenStream = d.implement(streamContract).stream(async function* () {
  yield ok("unreachable");
});
const malformedStreamContract = d.procedure().input(wire.string).output(wire.string).subscription();
const malformedStream = d.implement(malformedStreamContract).stream(() => ({}) as never);
const malformedStreamItem = d.implement(malformedStreamContract).stream(async function* () {
  yield { ok: "not-a-result" } as never;
});

const directRouter = d.router({
  whoami,
  leaks,
  badOutput,
  acceptNull,
  brokenStream,
  malformedStream,
  malformedStreamItem,
});

describe("server client", () => {
  test("runs the middleware chain and returns a decoded Result", async () => {
    const caller = createServerClient(directRouter, {
      context: { userId: "u_1" },
    });
    const result = await caller.whoami({});
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error("unreachable");
    expect(result.value.userId).toBe("u_1");
    // The output codec still ran, so rich values arrive as real instances.
    expect(result.value.at).toBeInstanceOf(Date);
  });

  test("middleware failures are returned, not bypassed — auth still applies", async () => {
    const caller = createServerClient(directRouter, {
      context: { userId: null },
    });
    const result = await caller.whoami({});
    expect(result.isOk()).toBe(false);
    if (result.isOk()) throw new Error("unreachable");
    expect(result.error._tag).toBe("parity/missing");
  });

  test("private errors are still sanitized — skipping the wire is not a hole", async () => {
    const caller = createServerClient(directRouter, {
      context: { userId: "u_1" },
    });
    const result = await caller.leaks({});
    expect(result.isOk()).toBe(false);
    if (result.isOk()) throw new Error("unreachable");
    expect(result.error._tag).toBe("server/internal");
    expect(JSON.stringify(result)).not.toContain("DIRECT_SECRET_do_not_ship");
  });

  test("a handler returning the wrong shape becomes server/internal, not a crash", async () => {
    const caller = createServerClient(directRouter, {
      context: { userId: "u_1" },
    });
    const result = await caller.badOutput({});
    expect(result.isOk()).toBe(false);
    if (result.isOk()) throw new Error("unreachable");
    expect(result.error._tag).toBe("server/internal");
  });

  test("procedure kind is preserved so the query runtime accepts the caller", () => {
    const caller = createServerClient(directRouter, {
      context: { userId: "u_1" },
    });
    expect(caller.whoami.$kind).toBe("query");
  });

  test("preserves an explicit null input instead of treating it as omitted", async () => {
    const client = createServerClient(directRouter, { context: { userId: "u_1" } });
    expect(await client.acceptNull(null)).toEqual(ok(null));
  });

  test("contains subscription input defects inside server/internal", async () => {
    const internalErrors: unknown[] = [];
    const client = createServerClient(directRouter, {
      context: { userId: "u_1" },
      onInternalError: (event) => internalErrors.push(event),
    });
    const results = [];
    for await (const result of client.brokenStream("input")) results.push(result);
    expect(results).toHaveLength(1);
    expect(results[0]?.isOk()).toBe(false);
    if (results[0] && !results[0].isOk()) expect(results[0].error._tag).toBe("server/internal");
    expect(internalErrors).toHaveLength(1);
  });

  test("contains malformed subscription producers inside server/internal", async () => {
    const client = createServerClient(directRouter, { context: { userId: "u_1" } });
    const results = [];
    for await (const result of client.malformedStream("input")) results.push(result);
    expect(results).toHaveLength(1);
    expect(results[0]?.isOk()).toBe(false);
    if (results[0] && !results[0].isOk()) expect(results[0].error._tag).toBe("server/internal");
  });

  test("contains malformed subscription items before consumers observe them", async () => {
    const client = createServerClient(directRouter, { context: { userId: "u_1" } });
    const results = [];
    for await (const result of client.malformedStreamItem("input")) results.push(result);
    expect(results).toHaveLength(1);
    expect(results[0]?.isOk()).toBe(false);
    if (results[0] && !results[0].isOk()) expect(results[0].error._tag).toBe("server/internal");
  });

  test("exposes only declared and server-boundary errors in its registry", () => {
    const client = createServerClient(directRouter, { context: { userId: "u_1" } });
    expect(client.$errors.definitions.has("parity/missing")).toBe(true);
    expect(client.$errors.definitions.has("server/internal")).toBe(true);
    expect(client.$errors.definitions.has("client/offline")).toBe(false);
  });
});
