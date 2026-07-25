/**
 * A small upstream service in the gen + tryPromise style: the throwing
 * directory fetch is adopted at the border, kept granular internally, and
 * collapsed to one declared domain tag at the procedure boundary (server.ts).
 */
import { defineErrors, err, gen, tryPromise, wire } from "../../src/index.js";

export const upstreamErrors = defineErrors("upstream", {
  unreachable: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
  malformed: { data: wire.object({ reason: wire.string }), httpStatus: 502 },
});

export const fetchMemberIds = (fetchDirectory: () => Promise<unknown>) =>
  gen(async function* () {
    const payload = yield* await tryPromise(
      fetchDirectory,
      (cause) => upstreamErrors.unreachable({ reason: String(cause) }),
    );
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { memberIds?: unknown }).memberIds)
    ) {
      return yield* err(upstreamErrors.malformed({ reason: "memberIds missing" }));
    }
    return (payload as { memberIds: unknown[] }).memberIds.filter(
      (id): id is string => typeof id === "string",
    );
  });
