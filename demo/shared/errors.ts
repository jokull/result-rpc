import { defineErrors, wire } from "result-rpc";

export type DemoAccess = "signed-out" | "read-only" | "writer";
export type WriteAction = "create" | "edit" | "move" | "reset";

const writeAction = wire.union([
  wire.literal("create"),
  wire.literal("edit"),
  wire.literal("move"),
  wire.literal("reset"),
]);

export const authErrors = defineErrors("auth", {
  loginRequired: {
    data: wire.object({ action: writeAction }),
    httpStatus: 401,
  },
});

export const accessErrors = defineErrors("access", {
  writeRequired: {
    data: wire.object({ action: writeAction, workspaceId: wire.string }),
    httpStatus: 403,
  },
});

export const ticketErrors = defineErrors("ticket", {
  notFound: {
    data: wire.object({ ticketId: wire.string }),
    httpStatus: 404,
  },
  conflict: {
    data: wire.object({
      ticketId: wire.string,
      expectedUpdatedAt: wire.date,
      actualUpdatedAt: wire.date,
    }),
    httpStatus: 409,
  },
});
