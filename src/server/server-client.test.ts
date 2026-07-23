import { describe, expect, test } from "bun:test";
import { err, error, ok, wire } from "../index.js";
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
const procedure = r.implement(contract).handler(({ context, input, errors }) =>
  context.found
    ? ok({ at: input.at, sequence: 7n })
    : err(errors.Missing({ at: input.at })));
const router = r.router({ parity: { value: procedure } });

describe("server client parity", () => {
  test("uses the real protocol and rich serializer locally", async () => {
    const at = new Date("2026-07-22T12:00:00.000Z");
    const client = createServerClient(router, { mode: "parity", context: { found: true } });
    const result = await client.parity.value({ at });
    expect(result).toEqual(ok({ at, sequence: 7n }));
    if (result.ok) expect(result.value.at).not.toBe(at);
  });

  test("reconstructs declared errors rather than sharing object identity", async () => {
    const at = new Date("2026-07-22T12:00:00.000Z");
    const client = createServerClient(router, { mode: "parity", context: { found: false } });
    const result = await client.parity.value({ at });
    expect(result).toEqual(err(Missing({ at })));
    if (!result.ok && result.error._tag === "parity/missing") {
      expect(result.error.data.at).not.toBe(at);
    }
  });
});
