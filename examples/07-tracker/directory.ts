/**
 * A small upstream service in the gen + tryPromise style: the throwing
 * directory fetch is adopted at the border, kept granular internally, and
 * collapsed to one declared domain tag at the procedure boundary (server.ts).
 *
 * Gen bodies return a Result (better-result semantics): throwable work is
 * folded with `Result.tryPromise`'s `{ try, catch }` form — the catch handler
 * returns a Result, so a foreign cause becomes a declared tagged error there.
 */
import { Result as BetterResult } from "better-result";
import { defineErrors, err, gen, ok, wire } from "../../src/index.js";

export const upstreamErrors = defineErrors("upstream", {
  unreachable: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
  malformed: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
});

export const fetchMemberIds = (fetchDirectory: () => Promise<unknown>) =>
  gen(async function* () {
    const payload = yield* await BetterResult.tryPromise({
      try: fetchDirectory,
      catch: (cause) => err(upstreamErrors.unreachable({ reason: String(cause) })),
    });
    if (typeof payload !== "object" || payload === null) {
      return err(upstreamErrors.malformed({ reason: "memberIds missing" }));
    }
    const memberIds = "memberIds" in payload ? payload.memberIds : undefined;
    if (!Array.isArray(memberIds)) {
      return err(upstreamErrors.malformed({ reason: "memberIds missing" }));
    }
    return ok(memberIds.filter((id): id is string => typeof id === "string"));
  });
