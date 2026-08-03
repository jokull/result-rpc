/**
 * Private errors are composition currency, never wire currency. The server
 * sanitizes one to `server/internal` before it can leave, and that check is
 * verified elsewhere — but it is the server's check. A client that decodes a
 * private tag purely because the contract mentions it is trusting whoever
 * answered to have followed the rule.
 *
 * That trust is misplaced when the responder is not your server: a rogue or
 * compromised origin, or a proxy rewriting bodies. The private shape would
 * then flow into shells and error boundaries as a legitimate domain error.
 */
import { describe, expect, test } from "bun:test";
import { error, ok, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { rpc } from "../server/contract.js";
import { contractDigest } from "../contract-digest.js";
import { serialize } from "../serializer.js";
import { PROTOCOL_CONTENT_TYPE, PROTOCOL_VERSION } from "../protocol.js";
import type { ClientTransport } from "./transport.js";
import type { ErrorDefinitionMap } from "../server/contract.js";

const Hidden = error({
  tag: "vault/hidden",
  data: wire.object({ leak: wire.string }),
  visibility: "private",
});
const Public = error({
  tag: "vault/denied",
  data: wire.object({ reason: wire.string }),
  httpStatus: 403,
});

const app = rpc.context<{}>();
const ping = app
  .procedure()
  .output(wire.string)
  // `.errors()` accepts only public definitions — ErrorDefinitionMap is keyed
  // on AnyPublicErrorDefinition — so the ordinary path cannot put a private tag
  // in a procedure union at all. The cast reaches the state a middleware's
  // declared private error, or a hostile responder, can still produce, which is
  // what the client-side guard exists for.
  .errors({ Hidden, Public } as unknown as ErrorDefinitionMap)
  .query(() => ok("pong") as never);
const router = app.router({ ping });

/** Answers every call with one hand-built envelope, as a hostile origin would. */
const respondingWith = (tag: string, data: unknown, status: number): ClientTransport => {
  const body = serialize({ v: PROTOCOL_VERSION, status: "error", error: { _tag: tag, data } });
  if (!body.ok) throw new Error("failed to encode the response envelope");
  return {
    request: async () => ({
      ok: true,
      response: {
        status,
        contentType: PROTOCOL_CONTENT_TYPE,
        body: body.value,
        contract: contractDigest(router),
      },
    }),
  };
};

describe("a private error arriving on the wire", () => {
  test("is refused rather than decoded as a domain error", async () => {
    const client = createFixtureClient({
      router,
      // Status 200 deliberately: a private definition has no httpStatus, so a
      // non-200 would be refused by the status check and this would pass
      // without ever consulting visibility.
      transport: respondingWith("vault/hidden", { leak: "SERVER_INTERNAL_LEAK" }, 200),
    });
    const outcome = await client.ping({});
    expect(outcome.isOk()).toBe(false);
    if (outcome.isOk()) return;
    expect(String(outcome.error._tag)).toBe("client/protocol-violation");
    // The payload must not reach application code in any form.
    expect(JSON.stringify(outcome.error.data)).not.toContain("SERVER_INTERNAL_LEAK");
  });

  test("still admits a declared public error from the same contract", async () => {
    // The control: visibility is the discriminator, not "declared at all".
    const client = createFixtureClient({
      router,
      transport: respondingWith("vault/denied", { reason: "locked" }, 403),
    });
    const outcome = await client.ping({});
    expect(outcome.isOk()).toBe(false);
    if (outcome.isOk()) return;
    expect(String(outcome.error._tag)).toBe("vault/denied");
    expect(JSON.stringify(outcome.error.data)).toBe(JSON.stringify({ reason: "locked" }));
  });
});
