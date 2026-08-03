/**
 * A small upstream service in the gen + tryPromise style: the throwing
 * directory fetch is adopted at the border, kept granular internally, and
 * collapsed to one declared domain tag at the procedure boundary (server.ts).
 *
 * `tryPromise({ try, catch })` folds a foreign cause into a declared tagged
 * error; gen bodies return a Result (`return ok(...)`), matching
 * better-result's `Result.gen`.
 */
import { defineErrors, err, gen, ok, tryPromise, wire } from "../../src/index.js";

export const upstreamErrors = defineErrors("upstream", {
  unreachable: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
  malformed: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
});

export const fetchMemberIds = (fetchDirectory: () => Promise<unknown>) =>
  gen(async function* () {
    const payload = yield* await tryPromise({
      try: fetchDirectory,
      catch: (cause) => upstreamErrors.unreachable({ reason: String(cause) }),
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
