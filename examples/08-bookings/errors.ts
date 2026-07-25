/**
 * Domain errors, declared once as namespaced maps. Keys become tags.
 */
import { defineErrors, wire } from "../../src/index.js";

export const hotelErrors = defineErrors("hotel", {
  notFound: { data: wire.object({ hotelId: wire.string }), httpStatus: 404 },
});

export const orderErrors = defineErrors("order", {
  notFound: { data: wire.object({ orderId: wire.string }), httpStatus: 404 },
});

export const bookingErrors = defineErrors("booking", {
  lineItemNotFound: {
    data: wire.object({ lineItemId: wire.string }),
    httpStatus: 404,
  },
});

export const reviewErrors = defineErrors("reviews", {
  alreadyReviewed: { data: wire.object({ hotelId: wire.string }), httpStatus: 409 },
});

export const userErrors = defineErrors("user", {
  notFound: { data: wire.object({ userId: wire.string }), httpStatus: 404 },
});

export const tourErrors = defineErrors("tours", {
  notFound: {
    data: wire.object({ tourId: wire.string, locale: wire.string }),
    httpStatus: 404,
  },
});
