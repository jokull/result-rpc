/**
 * The shared contract for the booking backend. `AppContext` is imported
 * type-only from the server half; no handler code lives here.
 */
import { rpc, wire } from "../../src/index.js";
import {
  bookingErrors,
  hotelErrors,
  orderErrors,
  reviewErrors,
  tourErrors,
  userErrors,
} from "./errors.js";
import {
  AvailabilityRow,
  HotelDetail,
  LocaleCodec,
  NextDepartureCodec,
  Order,
  OrderTreeRow,
  ReviewRowView,
  ReviewsPageCodec,
  ReviewStatsCodec,
  TourContentView,
  UserCard,
} from "./models.js";
import type { AppContext } from "./server.js";

export const app = rpc.context<AppContext>();

// -- orders: the deep relational tree ---------------------------------------------

export const listOrdersContract = app
  .procedure()
  .input(wire.object({}))
  .output(wire.array(OrderTreeRow))
  .query();

export const setNoteContract = app
  .procedure()
  .input(wire.object({ id: wire.string, note: wire.string }))
  .output(Order.pick("id", "note"))
  .errors({ ...orderErrors })
  .mutation();

// -- hotels -------------------------------------------------------------------------

export const hotelByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(HotelDetail)
  .errors({ ...hotelErrors })
  .query();

export const updatePhoneContract = app
  .procedure()
  .input(wire.object({ id: wire.string, phone: wire.string }))
  .output(HotelDetail)
  .errors({ ...hotelErrors })
  .mutation();

/**
 * Offset pagination, the shape real APIs actually ship: a 1-based page
 * number in, `limit + 1` fetched, `hasMore` sentinel out. Each page is its
 * own cached query — which is exactly why entity freshness crosses pages.
 */
export const hotelReviewsContract = app
  .procedure()
  .input(wire.object({ hotelId: wire.string, page: wire.integer({ min: 1 }) }))
  .output(ReviewsPageCodec)
  .query();

/** Aggregate over the reviews table — query-relative, so never on a model. */
export const reviewStatsContract = app
  .procedure()
  .input(wire.object({ hotelId: wire.string }))
  .output(ReviewStatsCodec)
  .query();

// -- users ----------------------------------------------------------------------------

export const userByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(UserCard)
  .errors({ ...userErrors })
  .query();

export const renameUserContract = app
  .procedure()
  .input(wire.object({ id: wire.string, name: wire.string }))
  .output(UserCard)
  .errors({ ...userErrors })
  .mutation();

// -- reviews ----------------------------------------------------------------------------

/**
 * The mixed mutation: the output carries a User entity (identity patching),
 * while membership and the aggregate go through `.affects`. Map-less on the
 * paginated list on purpose — page inputs make a mapped target awkward, and
 * invalidating every cached page is the honest blast radius (only ACTIVE
 * pages refetch; collapsed pages refetch on their next mount).
 */
export const addReviewContract = app
  .procedure()
  .input(
    wire.object({
      hotelId: wire.string,
      rating: wire.integer({ min: 1, max: 5 }),
      body: wire.string,
    }),
  )
  .output(ReviewRowView)
  .errors({ ...hotelErrors, ...reviewErrors })
  .affects(hotelReviewsContract)
  .affects(reviewStatsContract)
  .mutation();

// -- tours: composite-key content -----------------------------------------------------

export const tourByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string, locale: LocaleCodec }))
  .output(TourContentView)
  .errors({ ...tourErrors })
  .query();

export const featuredToursContract = app
  .procedure()
  .input(wire.object({ locale: LocaleCodec }))
  .output(wire.array(TourContentView))
  .query();

export const editTitleContract = app
  .procedure()
  .input(wire.object({ id: wire.string, locale: LocaleCodec, title: wire.string }))
  .output(TourContentView)
  .errors({ ...tourErrors })
  .mutation();

export const retireTourContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(wire.object({ removed: wire.number }))
  .mutation();

// -- availability: query-relative aggregate -------------------------------------------

export const availabilitySearchContract = app
  .procedure()
  .input(wire.object({ from: wire.string, to: wire.string, locale: LocaleCodec }))
  .output(wire.array(AvailabilityRow))
  .query();

// -- profile: derived summary ----------------------------------------------------------

export const nextDepartureContract = app
  .procedure()
  .input(wire.object({}))
  .output(NextDepartureCodec)
  .query();

/**
 * Rescheduling moves a raw `date` field that lives in one-off shapes in two
 * places: the derived summary and the orders tree's line items. Neither is
 * an entity node, so neither can be patched by identity — freshness for
 * one-off fields is `.affects` territory, declared in the contract.
 */
export const rescheduleContract = app
  .procedure()
  .input(wire.object({ lineItemId: wire.string, date: wire.string }))
  .output(wire.object({ order: Order.pick("id"), date: wire.string }))
  .errors({ ...bookingErrors })
  .affects(nextDepartureContract)
  .affects(listOrdersContract)
  .mutation();

// -- the contract value ------------------------------------------------------------------

export const appContract = app.contract({
  orders: {
    list: listOrdersContract,
    setNote: setNoteContract,
    reschedule: rescheduleContract,
  },
  hotels: {
    byId: hotelByIdContract,
    updatePhone: updatePhoneContract,
    reviews: hotelReviewsContract,
    reviewStats: reviewStatsContract,
  },
  users: {
    byId: userByIdContract,
    rename: renameUserContract,
  },
  reviews: {
    add: addReviewContract,
  },
  tours: {
    byId: tourByIdContract,
    featured: featuredToursContract,
    editTitle: editTitleContract,
    retire: retireTourContract,
  },
  availability: {
    search: availabilitySearchContract,
  },
  profile: {
    nextDeparture: nextDepartureContract,
  },
});
