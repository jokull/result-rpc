import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createSentryStub } from "./sentry.js";
import {
  AppShell,
  ChargeForm,
  createHandler,
  DefectShell,
  makeBillingShell,
  makeObservedClient,
  ResultRpcProvider,
} from "./app.js";
import { createQueryRuntime } from "../../src/react/index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const boot = () => {
  const sentry = createSentryStub();
  const handler = createHandler(sentry);
  const client = makeObservedClient(sentry, ((input: string | URL | Request, init?: RequestInit) =>
    handler(new Request(input, init))) as typeof globalThis.fetch);
  return { sentry, client, shell: makeBillingShell(sentry) };
};

const mountForm = async (world: ReturnType<typeof boot>) => {
  const runtime = createQueryRuntime({ client: world.client });
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <ResultRpcProvider runtime={runtime}>
        <AppShell.Provider>
          <DefectShell.Provider>
            <world.shell.Provider>
              <ChargeForm client={world.client} shell={world.shell} />
            </world.shell.Provider>
          </DefectShell.Provider>
        </AppShell.Provider>
      </ResultRpcProvider>,
    );
    await settle();
  });
  const submit = async (card: string) => {
    await act(async () => {
      renderer!.root.findByType("form").props.onSubmit({
        preventDefault: () => undefined,
        currentTarget: { elements: { namedItem: () => ({ value: card }) } },
      });
      await settle();
    });
  };
  return { renderer: renderer!, submit, runtime };
};

describe("06-sentry", () => {
  test("a successful charge leaves an info trail and captures nothing", async () => {
    const world = boot();
    const { renderer, submit, runtime } = await mountForm(world);
    await submit("visa-1");
    expect(world.sentry.breadcrumbs.map((crumb) => crumb.category))
      .toEqual(["rpc.call", "rpc.success"]);
    expect(world.sentry.messages).toEqual([]);
    expect(world.sentry.exceptions).toEqual([]);
    expect(JSON.stringify(renderer.toJSON())).toContain("charged visa-1");
    await act(async () => renderer.unmount());
    runtime.clear();
  });

  test("a declined card stays with the form; the trail shows both sides of the wire", async () => {
    const world = boot();
    const { renderer, submit, runtime } = await mountForm(world);
    await submit("declined");
    expect(JSON.stringify(renderer.toJSON())).toContain("Card declined (code 51)");
    expect(world.sentry.breadcrumbs.map((crumb) => crumb.category))
      .toEqual(["rpc.call", "rpc.server", "rpc.failure"]);
    expect(world.sentry.messages).toEqual([]); // severity undefined: counted, not captured
    await act(async () => renderer.unmount());
    runtime.clear();
  });

  test("a claimed failure appears in the trail with its owner, and both reaction taps fire", async () => {
    const world = boot();
    const { renderer, submit, runtime } = await mountForm(world);
    await submit("expired-plan");
    const categories = world.sentry.breadcrumbs.map((crumb) => crumb.category);
    expect(categories).toEqual(["rpc.call", "rpc.server", "rpc.failure", "rpc.claimed"]);
    const claimed = world.sentry.breadcrumbs[3]!;
    expect(claimed.data).toMatchObject({
      tag: "billing/plan-expired",
      owner: "sentry-billing",
      effect: "pause",
    });
    expect(world.sentry.messages).toEqual([
      { message: "charge: billing/plan-expired", level: "warning" }, // server severity tap
      { message: "billing claimed: billing/plan-expired", level: "info" }, // shell ownership tap
    ]);
    await act(async () => renderer.unmount());
    runtime.clear();
  });

  test("a defect correlates across the wire by incident id, no request-id plumbing", async () => {
    const world = boot();
    const result = await world.client.charge({ card: "boom" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    if (result.error._tag !== "server/internal") throw new Error(result.error._tag);
    // the exception Sentry captured carries the same incident id the client received
    expect(world.sentry.exceptions).toHaveLength(1);
    expect(world.sentry.exceptions[0]!.tags.incidentId).toBe(result.error.data.incidentId);
    expect(String(world.sentry.exceptions[0]!.exception)).toContain("charge processor crashed");
    // and the client-side trail never saw the cause, only the sanitized tag
    const failure = world.sentry.breadcrumbs.find((crumb) => crumb.category === "rpc.failure");
    expect(failure?.data).toMatchObject({ tag: "server/internal" });
  });
});
