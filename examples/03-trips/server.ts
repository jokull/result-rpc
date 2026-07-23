/**
 * Rung 3, server: services supply the process graph, layers supply the request
 * chain, and handlers read like the business rules they implement.
 */
import { err, ok, wire } from "../../src/index.js";
import { defineService, resolveServices, createFetchHandler } from "../../src/server/index.js";
import { rpc } from "../../src/contract/index.js";
import {
  SessionLayer,
  TripCodec,
  TripEventCodec,
  TripLocked,
  TripNotFound,
  Unauthorized,
  ViewerLayer,
  type Trip,
  type User,
} from "./domain.js";

// -- services: the process-lifetime graph -----------------------------------------

export interface TripDb {
  userBySession(token: string): Promise<User | undefined>;
  trip(id: string): Promise<Trip | undefined>;
  saveTrip(trip: Trip): Promise<void>;
  lockOwner(id: string): Promise<string | undefined>;
  events(id: string): readonly { kind: "renamed" | "locked"; at: Date }[];
}

export const Db = defineService("db", {
  create: (): TripDb => {
    const users = new Map<string, User>([["tok_1", { id: "u_1", name: "Jokull" }]]);
    const trips = new Map<string, Trip>([
      ["trip_1", { id: "trip_1", title: "Japan", ownerId: "u_1", startsAt: new Date("2026-10-01") }],
      ["trip_2", { id: "trip_2", title: "Iceland", ownerId: "u_2", startsAt: new Date("2026-11-01") }],
    ]);
    const locks = new Map<string, string>([["trip_2", "u_2"]]);
    return {
      userBySession: async (token) => users.get(token),
      trip: async (id) => trips.get(id),
      saveTrip: async (trip) => void trips.set(trip.id, trip),
      lockOwner: async (id) => locks.get(id),
      events: () => [{ kind: "renamed", at: new Date("2026-01-01") }],
    };
  },
});

export const Audit = defineService("audit", {
  needs: { db: Db },
  create: ({ db }) => {
    const lines: string[] = [];
    return {
      log: (line: string) => void (lines.push(line), db),
      lines,
    };
  },
});

// -- request context ----------------------------------------------------------------

interface RequestContext {
  readonly sessionToken: string | undefined;
  readonly db: TripDb;
  readonly audit: { log: (line: string) => void };
}

export const app = rpc.context<RequestContext>();

// session: reads the cookie, may find nobody — cannot fail
const session = SessionLayer.middleware(app, async ({ context }) =>
  ok(context.sessionToken ? (await context.db.userBySession(context.sessionToken)) ?? null : null));

// viewer: narrows to a real user, bundles session so one .use() is the whole chain
const authenticated = ViewerLayer.middleware(app, session);

// -- procedures -----------------------------------------------------------------------

const whoami = SessionLayer.procedure(app, session);
const me = ViewerLayer.procedure(app, authenticated);

/** The tRPC protectedProcedure pattern: builders are immutable, bases fork freely. */
const protectedProcedure = app.procedure().use(authenticated);

const tripById = protectedProcedure
  .input(wire.object({ id: wire.string }))
  .output(TripCodec)
  .errors({ TripNotFound })
  .query(async ({ input, context, errors }) => {
    const trip = await context.db.trip(input.id);
    if (!trip) return err(errors.TripNotFound({ tripId: input.id }));
    return ok(trip);
  });

const renameTrip = protectedProcedure
  .input(wire.object({ id: wire.string, title: wire.string }))
  .output(TripCodec)
  .errors({ TripNotFound, TripLocked })
  .mutation(async ({ input, context, errors }) => {
    const trip = await context.db.trip(input.id);
    if (!trip) return err(errors.TripNotFound({ tripId: input.id }));

    const lockedBy = await context.db.lockOwner(input.id);
    if (lockedBy && lockedBy !== context.viewer.id) {
      return err(errors.TripLocked({ lockedBy }));
    }
    if (trip.ownerId !== context.viewer.id) return err(errors.Unauthorized());

    const renamed = { ...trip, title: input.title };
    await context.db.saveTrip(renamed);
    context.audit.log(`${context.viewer.id} renamed ${trip.id}`);
    return ok(renamed);
  });

const tripEvents = protectedProcedure
  .input(wire.object({ id: wire.string }))
  .output(TripEventCodec)
  .errors({ TripNotFound })
  .subscription();

export const tripRouter = app.router({
  auth: { whoami, me },
  trip: {
    byId: tripById,
    rename: renameTrip,
    events: app.implement(tripEvents).stream(async function* ({ input, context, errors }) {
      const trip = await context.db.trip(input.id);
      if (!trip) {
        yield err(errors.TripNotFound({ tripId: input.id }));
        return;
      }
      for (const event of context.db.events(input.id)) {
        yield ok({ tripId: input.id, ...event });
      }
    }),
  },
});

// -- wiring: resolve services once, close over them per request ----------------------

export const createTripHandler = async () => {
  const services = await resolveServices({ db: Db, audit: Audit });
  return createFetchHandler({
    router: tripRouter,
    createContext: ({ request }) => ({
      ...services,
      sessionToken: request.headers.get("x-session") ?? undefined,
    }),
  });
};
