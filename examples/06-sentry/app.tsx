/**
 * Rung 6: observability — all four taps wired to one Sentry-shaped sink.
 *
 *   1. client onEvent        → breadcrumbs (call/success/failure/retry/claimed)
 *   2. shell onError         → captureMessage (the ownership reaction)
 *   3. server onError        → severity-routed capture of declared errors
 *   4. server onInternalError → captureException with the incident id
 *
 * The client stream is redaction-safe by construction (paths, tags, timing —
 * never values), and the incident id in a captured exception matches the
 * `server/internal` value the client received: one failure, correlated across
 * the wire without any request-id plumbing.
 */
import { defectErrors, defineErrors, err, errorCatalog, ok, pickErrors, rpc, transportErrors, wire } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import { createClient, fetchTransport, type ClientEvent } from "../../src/client/index.js";
import { defineShell, ResultRpcProvider } from "../../src/react/index.js";
import type { SentryLike } from "./sentry.js";

// -- shared -------------------------------------------------------------------

export const billingErrors = defineErrors("billing", {
  cardDeclined: { data: wire.object({ code: wire.string }), httpStatus: "payment-required" },
  planExpired: { httpStatus: "forbidden", severity: "warning" },
});

// -- server -------------------------------------------------------------------

const app = rpc.context<{}>();

export const router = app.router({
  charge: app.procedure()
    .input(wire.object({ card: wire.string }))
    .output(wire.string)
    .errors(billingErrors)
    .mutation(({ input, errors }) => {
      if (input.card === "declined") return err(errors.cardDeclined({ code: "51" }));
      if (input.card === "expired-plan") return err(errors.planExpired());
      if (input.card === "boom") throw new Error("charge processor crashed");
      return ok(`charged ${input.card}`);
    }),
});

export const createHandler = (sentry: SentryLike) =>
  createFetchHandler({
    router,
    createContext: () => ({}),
    // 3. declared errors: policy included, severity routes the sink
    onError: ({ error, policy, procedurePath, httpStatus }) => {
      sentry.addBreadcrumb({
        category: "rpc.server",
        message: `${procedurePath ?? "?"} -> ${error._tag}`,
        level: policy?.severity === "error" ? "error" : "warning",
        data: { httpStatus },
      });
      if (policy?.severity === "warning") {
        sentry.captureMessage(`${procedurePath}: ${error._tag}`, "warning");
      }
    },
    // 4. defects: the only tap that sees causes; tagged with the incident id
    onInternalError: ({ incidentId, cause, procedurePath, phase }) => {
      sentry.captureException(cause, {
        tags: {
          incidentId,
          phase,
          ...(procedurePath === undefined ? {} : { procedurePath }),
        },
      });
    },
  });

// -- client -------------------------------------------------------------------

const levelFor = (event: ClientEvent): "info" | "warning" =>
  event.type === "failure" || event.type === "claimed" ? "warning" : "info";

export const makeObservedClient = (sentry: SentryLike, fetch: typeof globalThis.fetch) =>
  createClient({
    router,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch }),
    // 1. wire breadcrumbs — safe to forward verbatim: no values in the stream
    onEvent: (event) => sentry.addBreadcrumb({
      category: `rpc.${event.type}`,
      message: "path" in event ? event.path : "",
      level: levelFor(event),
      data: event as unknown as Record<string, unknown>,
    }),
  });
export type BillingClient = ReturnType<typeof makeObservedClient>;

// -- shells ---------------------------------------------------------------------

export const AppShell = defineShell({
  name: "sentry-app",
  handle: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "sentry-defect",
  from: AppShell,
  handle: defectErrors,
  effect: "pause", // paused here so the test can observe instead of unmounting
});

/** Plan expiry is an app-wide concern; a declined card belongs to the form. */
export const makeBillingShell = (sentry: SentryLike) =>
  defineShell({
    name: "sentry-billing",
    from: DefectShell,
    handle: pickErrors(billingErrors, "planExpired"),
    // 2. the ownership reaction is a reporting moment
    onError: (failure) => sentry.captureMessage(`billing claimed: ${failure._tag}`, "info"),
  });
export type BillingShell = ReturnType<typeof makeBillingShell>;

// -- ui ------------------------------------------------------------------------------

const declinedMessage = errorCatalog(pickErrors(billingErrors, "cardDeclined"), {
  "billing/card-declined": (failure) => `Card declined (code ${failure.data.code})`,
});

export function ChargeForm({ client, shell }: { client: BillingClient; shell: BillingShell }) {
  // failure union here: cardDeclined — planExpired is owned above,
  // transport/defect tags above that
  const charge = shell.useMutation(client.charge);
  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const field = event.currentTarget.elements.namedItem("card") as HTMLInputElement;
      void charge.mutate({ card: field.value }).catch(() => undefined);
    }}>
      <input name="card" />
      {charge.state === "success" && <p>{charge.result.value}</p>}
      {charge.state === "failure" && (
        <p role="alert">{declinedMessage(charge.result.error)}</p>
      )}
    </form>
  );
}

export { ResultRpcProvider };
