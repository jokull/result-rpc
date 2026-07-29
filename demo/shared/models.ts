import { defineModel, wire, type ModelValue } from "result-rpc";

export const TicketStatus = wire.union([
  wire.literal("backlog"),
  wire.literal("in_progress"),
  wire.literal("done"),
]);

export const TicketPriority = wire.union([
  wire.literal("urgent"),
  wire.literal("high"),
  wire.literal("medium"),
  wire.literal("low"),
]);

export const Ticket = defineModel("ticket", {
  key: "id",
  shape: {
    id: wire.string,
    number: wire.integer({ min: 1 }),
    title: wire.string,
    description: wire.string,
    status: TicketStatus,
    priority: TicketPriority,
    assignee: wire.union([wire.string, wire.null]),
    labels: wire.array(wire.string),
    commentCount: wire.integer({ min: 0 }),
    createdAt: wire.date,
    updatedAt: wire.date,
  },
});

export type TicketValue = ModelValue<typeof Ticket>;

export const TicketStats = wire.object({
  total: wire.integer({ min: 0 }),
  backlog: wire.integer({ min: 0 }),
  inProgress: wire.integer({ min: 0 }),
  done: wire.integer({ min: 0 }),
});
