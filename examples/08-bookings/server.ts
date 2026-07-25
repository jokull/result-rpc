/**
 * Server half: contract implementations backed by a real Drizzle 1.0
 * database (bun:sqlite). The deep orders tree uses the relational query
 * builder (`db.query...findMany({ columns, with })` — v2 shape); the
 * availability aggregate uses `db.select().groupBy(min())`, because a
 * query-relative number is a projection of the INPUT, not of any table row.
 */
import { and, eq, gte, lte, min } from "drizzle-orm";
import { err, ok } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import {
  app,
  appContract,
  availabilitySearchContract,
  editTitleContract,
  featuredToursContract,
  hotelByIdContract,
  listOrdersContract,
  nextDepartureContract,
  rescheduleContract,
  retireTourContract,
  setNoteContract,
  tourByIdContract,
  updatePhoneContract,
} from "./contract.js";
import { hotels, lineItems, orders, tourAvailability, tourContent } from "./schema.js";
import { TourContent } from "./models.js";
import type { BookingsDb } from "./world.js";

export interface AppContext {
  db: BookingsDb;
  /** "Today" for the next-departure summary; fixed by the tests. */
  today: string;
  /** Optional gate the tests use to hold the edit-title mutation open. */
  gate?: () => Promise<void>;
}

// -- orders: the deep tree ---------------------------------------------------------

const listOrders = app.implement(listOrdersContract).handler(async ({ context }) => {
  // Column subsets at every level: `chargedAt` exists on the table and is
  // never selected; destinations carry no ids on the wire; occupants are
  // name pairs only.
  const rows = await context.db.query.orders.findMany({
    columns: { id: true, email: true, note: true },
    orderBy: { id: "asc" },
    with: {
      lineItems: {
        columns: { id: true, date: true, nights: true },
        orderBy: { date: "asc" },
        with: {
          destinations: {
            columns: { idx: true, nights: true },
            orderBy: { idx: "asc" },
            with: {
              hotel: { columns: { id: true, name: true, phone: true } },
              rooms: {
                columns: { description: true, board: true },
                orderBy: { id: "asc" },
                with: {
                  occupants: {
                    columns: { firstName: true, lastName: true },
                    orderBy: { id: "asc" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return ok(rows.map(({ lineItems: items, ...order }) => ({ order, lineItems: items })));
});

const setNote = app.implement(setNoteContract).handler(async ({ input, errors, context }) => {
  const updated = await context.db
    .update(orders)
    .set({ note: input.note })
    .where(eq(orders.id, input.id))
    .returning({ id: orders.id, note: orders.note });
  const row = updated[0];
  if (!row) return err(errors.notFound({ orderId: input.id }));
  return ok(row);
});

const reschedule = app
  .implement(rescheduleContract)
  .handler(async ({ input, errors, context }) => {
    const updated = await context.db
      .update(lineItems)
      .set({ date: input.date })
      .where(eq(lineItems.id, input.lineItemId))
      .returning({ orderId: lineItems.orderId, date: lineItems.date });
    const row = updated[0];
    if (!row) return err(errors.lineItemNotFound({ lineItemId: input.lineItemId }));
    return ok({ order: { id: row.orderId }, date: row.date });
  });

// -- hotels -------------------------------------------------------------------------

const hotelById = app.implement(hotelByIdContract).handler(async ({ input, errors, context }) => {
  const hotel = await context.db.query.hotels.findFirst({ where: { id: input.id } });
  if (!hotel) return err(errors.notFound({ hotelId: input.id }));
  return ok(hotel);
});

const updatePhone = app
  .implement(updatePhoneContract)
  .handler(async ({ input, errors, context }) => {
    const updated = await context.db
      .update(hotels)
      .set({ phone: input.phone })
      .where(eq(hotels.id, input.id))
      .returning();
    const row = updated[0];
    if (!row) return err(errors.notFound({ hotelId: input.id }));
    return ok(row);
  });

// -- tours: composite-key content ------------------------------------------------------

const tourById = app.implement(tourByIdContract).handler(async ({ input, errors, context }) => {
  const content = await context.db.query.tourContent.findFirst({
    where: { id: input.id, locale: input.locale },
  });
  if (!content) return err(errors.notFound({ tourId: input.id, locale: input.locale }));
  return ok({ ...content, locale: input.locale });
});

const featuredTours = app.implement(featuredToursContract).handler(async ({ input, context }) => {
  const contents = await context.db.query.tourContent.findMany({
    where: { locale: input.locale },
    orderBy: { id: "asc" },
  });
  return ok(contents.map((content) => ({ ...content, locale: input.locale })));
});

const editTitle = app.implement(editTitleContract).handler(async ({ input, errors, context }) => {
  if (context.gate) await context.gate();
  const updated = await context.db
    .update(tourContent)
    .set({ title: input.title })
    .where(and(eq(tourContent.id, input.id), eq(tourContent.locale, input.locale)))
    .returning();
  const row = updated[0];
  if (!row) return err(errors.notFound({ tourId: input.id, locale: input.locale }));
  return ok({ ...row, locale: input.locale });
});

const retireTour = app
  .implement(retireTourContract)
  .handler(async ({ input, context, touch }) => {
    const removed = await context.db
      .delete(tourContent)
      .where(eq(tourContent.id, input.id))
      .returning({ id: tourContent.id });
    // Deleted entities cannot be returned — and the composite key means both
    // locale variants must be touched BY RECORD KEY, one per entity.
    touch(TourContent, { id: input.id, locale: "en" });
    touch(TourContent, { id: input.id, locale: "ja" });
    return ok({ removed: removed.length });
  });

// -- availability: query-relative aggregate ---------------------------------------------

const availabilitySearch = app
  .implement(availabilitySearchContract)
  .handler(async ({ input, context }) => {
    const mins = await context.db
      .select({
        tourId: tourAvailability.tourId,
        minAvailable: min(tourAvailability.amount),
      })
      .from(tourAvailability)
      .where(and(gte(tourAvailability.date, input.from), lte(tourAvailability.date, input.to)))
      .groupBy(tourAvailability.tourId)
      .orderBy(tourAvailability.tourId);

    const contents = await context.db.query.tourContent.findMany({
      where: { locale: input.locale },
    });
    const titleByTourId = new Map(contents.map((content) => [content.id, content.title]));

    const rows: { tour: { id: string; locale: typeof input.locale; title: string }; minAvailable: number }[] = [];
    for (const entry of mins) {
      const title = titleByTourId.get(entry.tourId);
      if (title === undefined || entry.minAvailable === null) continue;
      rows.push({
        tour: { id: entry.tourId, locale: input.locale, title },
        minAvailable: entry.minAvailable,
      });
    }
    return ok(rows);
  });

// -- profile: derived summary --------------------------------------------------------------

const nextDeparture = app.implement(nextDepartureContract).handler(async ({ context }) => {
  const next = await context.db.query.lineItems.findFirst({
    where: { date: { gte: context.today } },
    orderBy: { date: "asc" },
    with: {
      destinations: {
        orderBy: { idx: "asc" },
        limit: 1,
        with: { hotel: { columns: { name: true } } },
      },
    },
  });
  if (!next) return ok({ kind: "none" as const });
  const first = next.destinations[0];
  return ok({
    kind: "upcoming" as const,
    date: next.date,
    hotelName: first ? first.hotel.name : "your first stop",
  });
});

// -- router and handler ------------------------------------------------------------------------

export const router = app.router({
  orders: { list: listOrders, setNote, reschedule },
  hotels: { byId: hotelById, updatePhone },
  tours: { byId: tourById, featured: featuredTours, editTitle, retire: retireTour },
  availability: { search: availabilitySearch },
  profile: { nextDeparture },
});

export const contract = appContract;

export const makeHandler = (context: AppContext) =>
  createFetchHandler({
    router,
    createContext: () => context,
    contractVersion: "08-bookings",
  });
