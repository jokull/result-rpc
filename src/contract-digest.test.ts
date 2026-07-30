import { describe, expect, test } from "bun:test";
import { contractDigest, effectiveContractVersion } from "./contract-digest.js";
import { error } from "./error.js";
import { err, ok } from "./result.js";
import { rpc } from "./server/contract.js";
import { wire, type AnyWireCodec } from "./wire.js";

const Missing = error({
  tag: "digest/missing",
  data: wire.object({ id: wire.string }),
  httpStatus: 404,
});

const app = rpc.context<{}>();

const build = () =>
  app.router({
    thing: {
      byId: app
        .procedure()
        .input(wire.object({ id: wire.string }))
        .output(wire.string)
        .errors({ Missing })
        .query(({ input, errors }) =>
          input.id === "x" ? err(errors.Missing({ id: input.id })) : ok(input.id),
        ),
    },
  });

describe("contractDigest", () => {
  test("is stable across identical builds", () => {
    expect(contractDigest(build())).toBe(contractDigest(build()));
    expect(contractDigest(build())).toBe("e57c214fcca71446");
  });

  test("a router and the contract it implements digest identically", () => {
    const contractEntry = app
      .procedure()
      .input(wire.object({ id: wire.string }))
      .output(wire.string)
      .errors({ Missing })
      .query();
    const contract = app.contract({ thing: { byId: contractEntry } });
    const router = app.router({
      thing: {
        byId: app.implement(contractEntry).handler(({ input }) => ok(input.id)),
      },
    });
    expect(contractDigest(router)).toBe(contractDigest(contract));
  });

  test("equal empty-data schemas have equal strict validation semantics", () => {
    const Implicit = error({ tag: "digest/empty" });
    const Explicit = error({ tag: "digest/empty", data: wire.object({}) });
    const withError = (definition: typeof Implicit | typeof Explicit) =>
      app.contract({
        probe: app.procedure().output(wire.string).errors({ Empty: definition }).query(),
      });
    expect(Implicit.codec.schema).toBe(Explicit.codec.schema);
    expect(contractDigest(withError(Implicit))).toBe(contractDigest(withError(Explicit)));
    expect(Implicit.codec.decode({ unexpected: true }).ok).toBe(false);
    expect(Explicit.codec.decode({ unexpected: true }).ok).toBe(false);
  });

  test("changes when the error union, a path, or a codec schema changes", () => {
    const base = contractDigest(build());
    const Extra = error({ tag: "digest/extra", httpStatus: 409 });

    const moreErrors = app.router({
      thing: {
        byId: app
          .procedure()
          .input(wire.object({ id: wire.string }))
          .output(wire.string)
          .errors({ Missing, Extra })
          .query(({ input }) => ok(input.id)),
      },
    });
    expect(contractDigest(moreErrors)).not.toBe(base);

    const renamed = app.router({
      thing: {
        byName: app
          .procedure()
          .input(wire.object({ id: wire.string }))
          .output(wire.string)
          .errors({ Missing })
          .query(({ input }) => ok(input.id)),
      },
    });
    expect(contractDigest(renamed)).not.toBe(base);

    const differentOutput = app.router({
      thing: {
        byId: app
          .procedure()
          .input(wire.object({ id: wire.string }))
          .output(wire.date)
          .errors({ Missing })
          .query(() => ok(new Date())),
      },
    });
    expect(contractDigest(differentOutput)).not.toBe(base);
  });

  test("fingerprints nested schema structure, constraints, literals, and error data", () => {
    const digestOf = (input: AnyWireCodec, output: AnyWireCodec) =>
      contractDigest({
        procedures: new Map([
          ["value", { _def: { kind: "query", input, output, definitions: {} } }],
        ]),
      });

    const nested = digestOf(
      wire.object({ filter: wire.object({ id: wire.string }) }),
      wire.object({ state: wire.literal("open") }),
    );
    expect(
      digestOf(
        wire.object({ filter: wire.object({ slug: wire.string }) }),
        wire.object({ state: wire.literal("open") }),
      ),
    ).not.toBe(nested);
    expect(
      digestOf(
        wire.object({ filter: wire.object({ id: wire.string }) }),
        wire.object({ state: wire.literal("closed") }),
      ),
    ).not.toBe(nested);
    expect(
      digestOf(
        wire.object({ filter: wire.object({ id: wire.string }) }),
        wire.object({ state: wire.literal("open"), count: wire.integer({ min: 1 }) }),
      ),
    ).not.toBe(nested);

    const MissingV2 = error({
      tag: "digest/missing",
      data: wire.object({ slug: wire.string }),
      httpStatus: 404,
    });
    const changedErrorData = app.router({
      thing: {
        byId: app
          .procedure()
          .input(wire.object({ id: wire.string }))
          .output(wire.string)
          .errors({ MissingV2 })
          .query(({ input }) => ok(input.id)),
      },
    });
    expect(contractDigest(changedErrorData)).not.toBe(contractDigest(build()));
  });

  test("object declaration order does not change the structural fingerprint", () => {
    const left = app.router({
      value: app
        .procedure()
        .input(wire.object({ a: wire.string, b: wire.number }))
        .output(wire.string)
        .query(() => ok("ok")),
    });
    const right = app.router({
      value: app
        .procedure()
        .input(wire.object({ b: wire.number, a: wire.string }))
        .output(wire.string)
        .query(() => ok("ok")),
    });
    expect(contractDigest(left)).toBe(contractDigest(right));
  });
  test("a .headers() declaration changes the digest", () => {
    // Skew on this flag is exactly the failure the declaration exists to
    // prevent: a client batching a header-writing call as if it were not one.
    const without = app.router({
      login: app
        .procedure()
        .output(wire.string)
        .mutation(() => ok("ok")),
    });
    const with_ = app.router({
      login: app
        .procedure()
        .headers()
        .output(wire.string)
        .mutation(({ context }) => {
          context.headers.append("set-cookie", "s=1");
          return ok("ok");
        }),
    });
    expect(contractDigest(with_)).not.toBe(contractDigest(without));
  });

  test("pagination cursor structure and every error policy field affect the digest", () => {
    const stringCursor = app.contract({
      list: app.procedure().output(wire.string).paginate({ cursor: wire.string }),
    });
    const integerCursor = app.contract({
      list: app
        .procedure()
        .output(wire.string)
        .paginate({ cursor: wire.integer({ min: 1 }) }),
    });
    expect(contractDigest(stringCursor)).not.toBe(contractDigest(integerCursor));

    const digestWithPolicy = (options: {
      readonly httpStatus?: number;
      readonly retry?: "never" | "transient";
      readonly severity?: "info" | "error";
    }) => {
      const Failure = error({ tag: "digest/policy", ...options });
      return contractDigest(
        app.contract({
          value: app.procedure().output(wire.string).errors({ Failure }).query(),
        }),
      );
    };
    const baseline = digestWithPolicy({});
    expect(digestWithPolicy({ httpStatus: 409 })).not.toBe(baseline);
    expect(digestWithPolicy({ retry: "transient" })).not.toBe(baseline);
    expect(digestWithPolicy({ severity: "error" })).not.toBe(baseline);
  });

  test("an explicit effective version deliberately replaces the structural digest", () => {
    expect(effectiveContractVersion(build(), "release-42")).toBe("release-42");
    expect(effectiveContractVersion(build())).toBe(contractDigest(build()));
    expect(() => effectiveContractVersion(build(), "")).toThrow(/must not be empty/);
  });
});
