/**
 * Server half: contract implementations backed by a real Drizzle 1.0
 * database (bun:sqlite). The deep orders tree uses the relational query
 * builder (`db.query...findMany({ columns, with })` — v2 shape); the
 * availability aggregate uses `db.select().groupBy(min())`, because a
 * query-relative number is a projection of the INPUT, not of any table row.
 */
import { and, avg, count, eq, gte, lte, min } from "drizzle-orm";
import { err, matchError, ok } from "../../src/index.js";
import { tryDb, type DbError } from "../../src/drizzle.js";
import { createFetchHandler } from "../../src/server/index.js";
import {
  addReviewContract,
  app,
  appContract,
  availabilitySearchContract,
  editTitleContract,
  featuredToursContract,
  hotelByIdContract,
  hotelReviewsContract,
  listOrdersContract,
  nextDepartureContract,
  renameUserContract,
  rescheduleContract,
  retireTourContract,
  reviewStatsContract,
  setNoteContract,
  tourByIdContract,
  updatePhoneContract,
  userByIdContract,
} from "./contract.js";
import {
  hotels,
  lineItems,
  orders,
  reviews,
  tourAvailability,
  tourContent,
  users,
} from "./schema.js";
import { TourContent } from "./models.js";
import type { BookingsDb } from "./world.js";

export interface AppContext {
  db: BookingsDb;
  /** "Today" for the next-departure summary; fixed by the tests. */
  today: string;
  /** Simulates the session cookie: who posts reviews. */
  currentUserId: string;
  /** Optional gate the tests use to hold the edit-title mutation open. */
  gate?: () => Promise<void>;
}

/** Reviews per page — `limit + 1` is fetched, the extra row becomes hasMore. */
const REVIEWS_PAGE_SIZE = 3;

// -- orders: the deep tree ---------------------------------------------------------

const listOrders = app.implement(listOrdersContract).handler(async ({ context }) => {
  // Column subsets at every level: `chargedAt` exists on the table and is
  // never selected; destinations carry no ids on the wire; occupants are
  // name pairs only.
  const rows = await context.db.query.orders.findMany({
    columns: { id: true, email: true, note: true },
    orderBy: { id: "asc" },
    with: {
      user: { columns: { id: true, name: true } },
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
  return ok(
    rows.map(({ lineItems: items, user, ...order }) => ({
      order,
      bookedBy: user,
      lineItems: items,
    })),
  );
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

const hotelReviews = app.implement(hotelReviewsContract).handler(async ({ input, context }) => {
  // Offset pagination with the limit+1 sentinel: fetch one row past the
  // page; its presence is `hasMore`, and it never ships.
  const fetched = await context.db.query.reviews.findMany({
    columns: { id: true, rating: true, body: true },
    where: { hotelId: input.hotelId },
    orderBy: { id: "desc" },
    limit: REVIEWS_PAGE_SIZE + 1,
    offset: (input.page - 1) * REVIEWS_PAGE_SIZE,
    with: { author: { columns: { id: true, name: true, avatarUrl: true } } },
  });
  const pageRows = fetched.slice(0, REVIEWS_PAGE_SIZE);
  return ok({
    rows: pageRows.map(({ author, ...review }) => ({ review, author })),
    hasMore: fetched.length > REVIEWS_PAGE_SIZE,
  });
});

const reviewStats = app.implement(reviewStatsContract).handler(async ({ input, context }) => {
  const aggregated = await context.db
    .select({ count: count(), average: avg(reviews.rating) })
    .from(reviews)
    .where(eq(reviews.hotelId, input.hotelId))
    .groupBy(reviews.hotelId);
  const row = aggregated[0];
  // Drizzle types avg() as `string | null` (decimal-as-string), so the
  // number the codec wants is parsed and rounded here.
  if (!row || row.average === null) return ok({ count: 0, averageRating: 0 });
  return ok({
    count: row.count,
    averageRating: Math.round(Number.parseFloat(row.average) * 10) / 10,
  });
});

// -- users ---------------------------------------------------------------------------

const userById = app.implement(userByIdContract).handler(async ({ input, errors, context }) => {
  const user = await context.db.query.users.findFirst({ where: { id: input.id } });
  if (!user) return err(errors.notFound({ userId: input.id }));
  return ok(user);
});

const renameUser = app.implement(renameUserContract).handler(async ({ input, errors, context }) => {
  const updated = await context.db
    .update(users)
    .set({ name: input.name })
    .where(eq(users.id, input.id))
    .returning();
  const row = updated[0];
  if (!row) return err(errors.notFound({ userId: input.id }));
  return ok(row);
});

// -- reviews ---------------------------------------------------------------------------

/** db/* tags this handler does not own are genuine defects: rethrow, and the
 * incident pipeline logs the cause and ships a sanitized server/internal. */
const unexpectedDb = (failure: DbError): never => {
  throw new Error(`unexpected database failure: ${failure._tag}`);
};

const addReview = app.implement(addReviewContract).handler(async ({ input, errors, context }) => {
  // No pre-check SELECTs. The author fetch is output composition (the row's
  // name/avatar), not a check; the constraints do the checking.
  const author = await context.db.query.users.findFirst({
    where: { id: context.currentUserId },
  });
  if (!author) return err(errors.notFound({ hotelId: input.hotelId }));
  const existing = await context.db.select({ count: count() }).from(reviews);
  const review = {
    id: `rv-${(existing[0]?.count ?? 0) + 1}`,
    hotelId: input.hotelId,
    authorId: author.id,
    rating: input.rating,
    body: input.body,
  };
  // Attempting the insert IS the uniqueness check — correct under
  // concurrency, where a SELECT-first pre-check races with a concurrent
  // insert between the check and the write. The db/* tags are private
  // composition currency; each is collapsed to a declared domain tag here
  // or rethrown as a defect, and none ever appears in `.errors()`.
  const inserted = await tryDb(context.db.insert(reviews).values(review));
  if (!inserted.ok) {
    return matchError(inserted.error, {
      "db/unique-violation": () => err(errors.alreadyReviewed({ hotelId: input.hotelId })),
      // The hotel id is the only client-supplied reference (the author comes
      // from the session), so a foreign-key failure means the hotel is gone.
      "db/foreign-key-violation": () => err(errors.notFound({ hotelId: input.hotelId })),
      "db/not-null-violation": unexpectedDb,
      "db/check-violation": unexpectedDb,
      "db/query-failure": unexpectedDb,
    });
  }
  return ok({
    review: { id: review.id, rating: review.rating, body: review.body },
    author: { id: author.id, name: author.name, avatarUrl: author.avatarUrl },
  });
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
  hotels: { byId: hotelById, updatePhone, reviews: hotelReviews, reviewStats },
  users: { byId: userById, rename: renameUser },
  reviews: { add: addReview },
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
