import { expect, test } from "bun:test";
import type { AnyTaggedError } from "../error.js";
import { createSuspenseClaimLease, type ClaimEntry, type ClaimLease } from "./claims.js";

test("a boundary lease forgets settled operations and ignores retention while inactive", () => {
  const released: string[] = [];
  const entry: ClaimEntry = {
    name: "test-shell",
    effect: "pause",
    registry: {
      definitions: new Map(),
      is: (_value: unknown): _value is AnyTaggedError => false,
    },
    acquire: () => ({ fresh: true, resumed: Promise.resolve() }),
    release: (operationId: string, _lease: ClaimLease) => {
      released.push(operationId);
    },
  };
  const lease = createSuspenseClaimLease();

  lease.retain(entry, "settled");
  lease.retain(entry, "held");
  lease.forget(entry, "settled");
  lease.release();
  expect(released).toEqual(["held"]);

  lease.retain(entry, "after-cleanup");
  lease.release();
  expect(released).toEqual(["held"]);

  lease.activate();
  lease.retain(entry, "strict-replay");
  lease.release();
  expect(released).toEqual(["held", "strict-replay"]);
});
