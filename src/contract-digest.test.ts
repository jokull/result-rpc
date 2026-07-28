import { describe, expect, test } from "bun:test";
import { contractDigest } from "./contract-digest.js";
import { error } from "./error.js";
import { err, ok } from "./result.js";
import { rpc } from "./server/contract.js";
import { wire } from "./wire.js";

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

  test("changes when the error union, a path, or a codec kind changes", () => {
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
  test("a .headers() declaration changes the digest", () => {
    // Skew on this flag is exactly the failure the declaration exists to
    // prevent: a client batching a header-writing call as if it were not one.
    const without = app.router({
      login: app.procedure().output(wire.string).mutation(() => ok("ok")),
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
});
