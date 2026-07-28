import type { Metadata } from "next";
import { TicketDemo } from "./TicketDemo";

export const metadata: Metadata = {
  title: "Ticket cache demo · result-rpc",
  description:
    "A live result-rpc showcase for optimistic updates, entity identity, cursor pagination, and invalidation.",
};

export default function Home() {
  return <TicketDemo />;
}
