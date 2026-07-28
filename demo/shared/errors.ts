import { defineErrors, wire } from "result-rpc";

export const ticketErrors = defineErrors("ticket", {
  notFound: {
    data: wire.object({ ticketId: wire.string }),
    httpStatus: 404,
  },
});
