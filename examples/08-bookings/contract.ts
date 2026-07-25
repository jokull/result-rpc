/**
 * The shared contract for the booking backend. `AppContext` is imported
 * type-only from the server half; no handler code lives here.
 */
import { rpc, wire } from "../../src/index.js";
import { bookingErrors, hotelErrors, orderErrors, tourErrors } from "./errors.js";
import {
  AvailabilityRow,
  Hotel,
  LocaleCodec,
  NextDepartureCodec,
  Order,
  OrderTreeRow,
  TourContent,
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
  .output(Hotel.codec)
  .errors({ ...hotelErrors })
  .query();

export const updatePhoneContract = app
  .procedure()
  .input(wire.object({ id: wire.string, phone: wire.string }))
  .output(Hotel.codec)
  .errors({ ...hotelErrors })
  .mutation();

// -- tours: composite-key content -----------------------------------------------------

export const tourByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string, locale: LocaleCodec }))
  .output(TourContent.codec)
  .errors({ ...tourErrors })
  .query();

export const featuredToursContract = app
  .procedure()
  .input(wire.object({ locale: LocaleCodec }))
  .output(wire.array(TourContent.codec))
  .query();

export const editTitleContract = app
  .procedure()
  .input(wire.object({ id: wire.string, locale: LocaleCodec, title: wire.string }))
  .output(TourContent.codec)
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
