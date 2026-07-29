import { createBrowserClient, fetchTransport, type ClientEvent } from "../../src/client/index.js";
import { billingContract } from "./contract.js";
import type { SentryLike } from "./sentry.js";

const levelFor = (event: ClientEvent): "info" | "warning" =>
  event.type === "failure" || event.type === "claimed" ? "warning" : "info";

export const makeObservedClient = (sentry: SentryLike, fetch: typeof globalThis.fetch) =>
  createBrowserClient({
    contract: billingContract,
    transport: fetchTransport({ url: "https://example.test/rpc", fetch }),
    // 1. wire breadcrumbs — safe to forward verbatim: no values in the stream
    onEvent: (event) =>
      sentry.addBreadcrumb({
        category: `rpc.${event.type}`,
        message: "path" in event ? event.path : "",
        level: levelFor(event),
        data: { ...event },
      }),
  });

export type BillingClient = ReturnType<typeof makeObservedClient>;
