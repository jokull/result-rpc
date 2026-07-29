import { err, ok } from "../../src/index.js";
import { createFetchHandler, serverRpc } from "../../src/server/index.js";
import { chargeContract } from "./contract.js";
import type { SentryLike } from "./sentry.js";

const server = serverRpc.context<{}>();

export const router = server.router({
  charge: server.implement(chargeContract).handler(({ input, errors }) => {
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
