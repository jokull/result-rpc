import { describe, expect, test } from "bun:test";
import { defineService, resolveServices, type AnyServiceDefinition } from "./service.js";

describe("services", () => {
  test("a shared dependency is constructed once (diamond)", async () => {
    let dbBuilds = 0;
    const Db = defineService("db", {
      create: () => {
        dbBuilds += 1;
        return { query: (sql: string) => `db:${sql}` };
      },
    });
    const Users = defineService("users", {
      needs: { db: Db },
      create: ({ db }) => ({ find: (id: string) => db.query(`user ${id}`) }),
    });
    const Orders = defineService("orders", {
      needs: { db: Db },
      create: async ({ db }) => ({ find: (id: string) => db.query(`order ${id}`) }),
    });

    const services = await resolveServices({ db: Db, users: Users, orders: Orders });
    expect(dbBuilds).toBe(1);
    expect(services.users.find("u1")).toBe("db:user u1");
    expect(services.orders.find("o1")).toBe("db:order o1");
    // the top-level db and the dependency are the same instance
    expect(services.users.find("x")).toBe(services.db.query("user x"));
  });

  test("two definitions with identical options are two services", async () => {
    let builds = 0;
    const make = () => defineService("db", { create: () => ++builds });
    await resolveServices({ a: make(), b: make() });
    expect(builds).toBe(2);
  });

  test("dependency cycles are rejected with the path", async () => {
    // eslint-disable-next-line prefer-const
    let B: AnyServiceDefinition;
    const A = defineService("a", {
      needs: {
        get b() {
          return B;
        },
      },
      create: () => "a",
    });
    B = defineService("b", { needs: { a: A }, create: () => "b" });
    await expect(resolveServices({ a: A })).rejects.toThrow(/cycle: a -> b -> a/);
  });
});
