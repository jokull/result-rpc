/**
 * `mutate()` is fire-and-forget and must never reject.
 *
 * Reported by the first external adopter as the sharpest edge, and our own docs
 * demonstrated it: `onChange={(e) => void assign.mutate({ … })}` is an unhandled
 * rejection the moment any mounted shell claims the failure, because `void` on a
 * rejecting promise has nowhere to put it. Those examples were correct only in
 * an app where nothing claimed.
 *
 * The intent — an awaiting caller's continuation must not run on an outcome a
 * shell owns — is preserved on `mutateAsync`, where there is a caller to hand
 * the signal to.
 */
import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { err, error, wire } from "../index.js";
import { createFixtureClient } from "../testing/index.js";
import { fetchTransport } from "../client/transport.js";
import { createFetchHandler } from "../server/index.js";
import { rpc } from "../server/contract.js";
import { defineShell, ResultRpcProvider, useResultMutation } from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Denied = error({
  tag: "mutate-rejection/denied",
  data: wire.object({}),
  httpStatus: 403,
  retry: "never",
});

const app = rpc.context<{}>();
const save = app
  .procedure()
  .input(wire.object({}))
  .output(wire.string)
  .errors({ Denied })
  .mutation(({ errors }) => err(errors.Denied({})));
const router = app.router({ save });
const handler = createFetchHandler({ router, createContext: () => ({}) });

const makeClient = () =>
  createFixtureClient({
    router,
    transport: fetchTransport({
      url: "https://example.test/rpc",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof globalThis.fetch,
    }),
  });

const DeniedShell = defineShell({ name: "denied", claims: { Denied } });

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

/** Counts unhandled rejections raised while `run` is in flight. */
const countingUnhandled = async (run: () => Promise<void>) => {
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await settle();
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return unhandled;
};

describe("a mutation whose failure a mounted shell claims", () => {
  test("mutate() raises no unhandled rejection", async () => {
    const client = makeClient();
    let fire: (() => void) | undefined;

    function Probe() {
      const mutation = useResultMutation(client.save);
      // Exactly the shape the docs use for a fire-and-forget call.
      fire = () => mutation.mutate({});
      return null;
    }

    const unhandled = await countingUnhandled(async () => {
      await act(async () => {
        create(
          <ResultRpcProvider client={client}>
            <DeniedShell.Provider>
              <Probe />
            </DeniedShell.Provider>
          </ResultRpcProvider>,
        );
      });
      await act(async () => {
        fire!();
        await settle();
      });
    });

    expect(unhandled).toBe(0);
  });

  test("mutateAsync() still rejects, so an awaiting caller can stop", async () => {
    // The control: the claimed signal is not lost, it is delivered to the only
    // caller in a position to act on it.
    const client = makeClient();
    let attempt: (() => Promise<"resolved" | "rejected">) | undefined;

    function Probe() {
      const mutation = useResultMutation(client.save);
      attempt = async () => {
        try {
          await mutation.mutateAsync({});
          return "resolved" as const;
        } catch {
          return "rejected" as const;
        }
      };
      return null;
    }

    await act(async () => {
      create(
        <ResultRpcProvider client={client}>
          <DeniedShell.Provider>
            <Probe />
          </DeniedShell.Provider>
        </ResultRpcProvider>,
      );
    });

    let outcome: "resolved" | "rejected" | undefined;
    await act(async () => {
      outcome = await attempt!();
    });
    expect(outcome).toBe("rejected");
  });
});
