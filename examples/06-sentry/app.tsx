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
import {
  defectErrors,
  errorCatalog,
  pickErrors,
  staleErrors,
  transportErrors,
} from "../../src/index.js";
import { defineShell, ResultRpcProvider } from "../../src/react/index.js";
import { billingErrors } from "./contract.js";
import type { BillingClient } from "./client.js";
import type { SentryLike } from "./sentry.js";

// -- shells ---------------------------------------------------------------------

export const AppShell = defineShell({
  name: "sentry-app",
  claims: transportErrors,
  effect: "pause",
});

export const DefectShell = defineShell({
  name: "sentry-defect",
  from: AppShell,
  claims: { ...defectErrors, ...staleErrors },
  effect: "pause", // paused here so the test can observe instead of unmounting
});

/** Plan expiry is an app-wide concern; a declined card belongs to the form. */
export const makeBillingShell = (sentry: SentryLike) =>
  defineShell({
    name: "sentry-billing",
    from: DefectShell,
    claims: pickErrors(billingErrors, "planExpired"),
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
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("card") as HTMLInputElement;
        void charge.mutateAsync({ card: field.value }).catch(() => undefined);
      }}
    >
      <input name="card" />
      {charge.state === "success" && <p>{charge.value}</p>}
      {charge.state === "failure" && <p role="alert">{declinedMessage(charge.error)}</p>}
    </form>
  );
}

export { ResultRpcProvider };
