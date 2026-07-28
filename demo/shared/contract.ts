import { pickErrors, rpc, wire } from "result-rpc";
import type { AppContext } from "../server/rpc-server";
import { ticketErrors } from "./errors";
import { Ticket, TicketPriority, TicketStats, TicketStatus } from "./models";

export const app = rpc.context<AppContext>();

export const ticketListContract = app
  .procedure()
  .input(
    wire.object({
      status: wire.union([wire.literal("all"), TicketStatus] as const),
      search: wire.string,
    }),
  )
  .output(Ticket.all("the issue tracker renders the complete public ticket"))
  .paginate({ cursor: wire.string });

export const ticketByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(Ticket.all("the detail pane renders the complete public ticket"))
  .errors({ ...pickErrors(ticketErrors, "notFound") })
  .query();

export const ticketStatsContract = app
  .procedure()
  .input(wire.object({}))
  .output(TicketStats)
  .query();

export const createTicketContract = app
  .procedure()
  .input(
    wire.object({
      id: wire.string,
      title: wire.string,
      description: wire.string,
      priority: TicketPriority,
    }),
  )
  .output(Ticket.all("the created ticket enters entity-aware caches"))
  .affects(ticketListContract)
  .affects(ticketStatsContract)
  .mutation();

export const editTicketContract = app
  .procedure()
  .input(
    wire.object({
      id: wire.string,
      title: wire.string,
      description: wire.string,
      priority: TicketPriority,
      assignee: wire.union([wire.string, wire.null] as const),
    }),
  )
  .output(Ticket.all("one entity response patches every cached projection"))
  .errors({ ...pickErrors(ticketErrors, "notFound") })
  .mutation();

export const moveTicketContract = app
  .procedure()
  .input(wire.object({ id: wire.string, status: TicketStatus }))
  .output(Ticket.all("the moved entity patches list and detail views immediately"))
  .errors({ ...pickErrors(ticketErrors, "notFound") })
  .affects(ticketListContract)
  .affects(ticketStatsContract)
  .mutation();

export const resetWorkspaceContract = app
  .procedure()
  .input(wire.object({}))
  .output(wire.object({ restored: wire.integer({ min: 0 }) }))
  .affects(ticketListContract)
  .affects(ticketStatsContract)
  .mutation();

export const appContract = app.contract({
  tickets: {
    list: ticketListContract,
    byId: ticketByIdContract,
    stats: ticketStatsContract,
    create: createTicketContract,
    edit: editTicketContract,
    move: moveTicketContract,
    reset: resetWorkspaceContract,
  },
});
