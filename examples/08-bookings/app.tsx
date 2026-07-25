/**
 * Rung 8: a travel-booking dashboard over a real database.
 *
 * The onion here is just the built-in boundary shells — no session layer,
 * because the point of this example is the entity system: the deep orders
 * tree, composite-key tour content, query-relative availability, and a
 * derived next-departure summary, all rendered at once so the tests can pin
 * cross-panel coherence with per-procedure request counters.
 */
import { useState } from "react";
import { matchError } from "../../src/index.js";
import { boundaryShells, ResultRpcProvider, useResultClient } from "../../src/react/index.js";
import type { AppClient } from "./client.js";
import { TourContent, type Locale, type OrderTree } from "./models.js";

export const { TransportShell, DefectShell, StaleShell, BoundaryProvider, useConnectivity } =
  boundaryShells({ name: "bookings" });

// -- the orders tree ---------------------------------------------------------------

type LineItemView = OrderTree["lineItems"][number];
type DestinationView = LineItemView["destinations"][number];
type RoomView = DestinationView["rooms"][number];

function RoomLine({ room }: { room: RoomView }) {
  const names = room.occupants
    .map((occupant) => `${occupant.firstName} ${occupant.lastName}`)
    .join(", ");
  return (
    <li>
      {room.description} · {room.board} — {names}
    </li>
  );
}

function DestinationCard({ destination }: { destination: DestinationView }) {
  return (
    <li>
      Stop {destination.idx + 1}: {destination.hotel.name} ({destination.hotel.phone}) ·{" "}
      {destination.nights} nights
      <ul>
        {destination.rooms.map((room, index) => (
          <RoomLine key={index} room={room} />
        ))}
      </ul>
    </li>
  );
}

function LineItemCard({ item }: { item: LineItemView }) {
  return (
    <li>
      Departs {item.date} · {item.nights} nights
      <ul>
        {item.destinations.map((destination) => (
          <DestinationCard key={destination.idx} destination={destination} />
        ))}
      </ul>
    </li>
  );
}

export function OrdersTree() {
  const client = useResultClient<AppClient>();
  const list = StaleShell.useQuery(client.orders.list, {});

  switch (list.state) {
    case "pending":
      return <p>Loading orders…</p>;
    case "success":
      return (
        <section>
          {list.value.map((row) => (
            <article key={row.order.id}>
              <h3>
                Order {row.order.id} · {row.order.email}
              </h3>
              <p>Note: {row.order.note}</p>
              <ul>
                {row.lineItems.map((item) => (
                  <LineItemCard key={item.id} item={item} />
                ))}
              </ul>
            </article>
          ))}
        </section>
      );
    case "failure":
      // transport, defect, and stale are claimed by the boundary above;
      // orders.list declares no domain errors — nothing remains.
      return list.error satisfies never;
  }
}

export function NoteEditor({ orderId }: { orderId: string }) {
  const client = useResultClient<AppClient>();
  const [note, setNote] = useState("");
  const setNoteMutation = StaleShell.useMutation(client.orders.setNote);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // claimed/cancelled rejections are control flow — the owning shell
        // already reacted; there is nothing to handle here.
        void setNoteMutation.mutate({ id: orderId, note }).catch(() => undefined);
      }}
    >
      <label>
        Order note
        <input
          placeholder="Order note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button type="submit">Save note</button>
      {setNoteMutation.state === "failure" && (
        <p role="alert">
          {matchError(setNoteMutation.error, {
            "order/not-found": () => "That order no longer exists.",
          })}
        </p>
      )}
    </form>
  );
}

// -- hotel front desk ------------------------------------------------------------------

export function HotelDesk({ hotelId }: { hotelId: string }) {
  const client = useResultClient<AppClient>();
  const hotel = StaleShell.useQuery(client.hotels.byId, { id: hotelId });
  const updatePhone = StaleShell.useMutation(client.hotels.updatePhone);

  switch (hotel.state) {
    case "pending":
      return <p>Loading hotel…</p>;
    case "success":
      return (
        <section>
          <p>
            Front desk: {hotel.value.name} · {hotel.value.phone} · {hotel.value.city}
          </p>
          <button
            onClick={() =>
              void updatePhone
                .mutate({ id: hotelId, phone: "+81-3-9999" })
                .catch(() => undefined)
            }
          >
            Update Okura phone
          </button>
        </section>
      );
    case "failure":
      return (
        <p role="alert">
          {matchError(hotel.error, {
            "hotel/not-found": (failure) => `Hotel ${failure.data.hotelId} was not found.`,
          })}
        </p>
      );
  }
}

// -- tour content (composite key: id + locale) ---------------------------------------------

export function TourDetail({ id, locale }: { id: string; locale: Locale }) {
  const client = useResultClient<AppClient>();
  const tour = StaleShell.useQuery(client.tours.byId, { id, locale });

  switch (tour.state) {
    case "pending":
      return <p>[{locale}] Loading tour…</p>;
    case "success":
      return (
        <p>
          [{locale}] {tour.value.title} — {tour.value.summary}
        </p>
      );
    case "failure":
      return (
        <p role="alert">
          [{locale}]{" "}
          {matchError(tour.error, {
            "tours/not-found": () => "This tour is no longer published.",
          })}
        </p>
      );
  }
}

export function FeaturedTours({ locale }: { locale: Locale }) {
  const client = useResultClient<AppClient>();
  const featured = StaleShell.useQuery(client.tours.featured, { locale });

  switch (featured.state) {
    case "pending":
      return <p>Loading featured tours…</p>;
    case "success":
      return (
        <ul>
          {featured.value.map((tour) => (
            <li key={`${tour.id}:${tour.locale}`}>★ {tour.title}</li>
          ))}
        </ul>
      );
    case "failure":
      return featured.error satisfies never;
  }
}

export function RenameTourForm({ id, locale }: { id: string; locale: Locale }) {
  const client = useResultClient<AppClient>();
  const [title, setTitle] = useState("");

  const rename = StaleShell.useMutation(client.tours.editTitle, {
    // The record-key entity API: the composite key addresses exactly ONE of
    // the two locale variants; the optimistic patch lands everywhere the
    // (id, locale) entity is cached and nowhere else.
    optimistic: (input, cache) => ({
      rollback: cache.updateEntity(
        TourContent,
        { id: input.id, locale: input.locale },
        (tour) => ({ ...tour, title: input.title }),
      ),
    }),
    onFailure: (_error, _input, context) => context?.rollback(),
    onCancel: (_input, context) => context?.rollback(),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void rename.mutate({ id, locale, title }).catch(() => undefined);
      }}
    >
      <label>
        New English title
        <input
          placeholder="New English title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <button type="submit">Rename tour</button>
      {rename.state === "failure" && (
        <p role="alert">
          {matchError(rename.error, {
            "tours/not-found": () => "This tour is no longer published.",
          })}
        </p>
      )}
    </form>
  );
}

export function RetireTourButton({ id }: { id: string }) {
  const client = useResultClient<AppClient>();
  const retire = StaleShell.useMutation(client.tours.retire);
  return (
    <button onClick={() => void retire.mutate({ id }).catch(() => undefined)}>
      Retire the Fuji tour
    </button>
  );
}

// -- availability search (query-relative aggregate) -------------------------------------------

export function AvailabilityPanel({
  label,
  from,
  to,
  locale,
}: {
  label: string;
  from: string;
  to: string;
  locale: Locale;
}) {
  const client = useResultClient<AppClient>();
  const search = StaleShell.useQuery(client.availability.search, { from, to, locale });

  switch (search.state) {
    case "pending":
      return <p>{label}: searching…</p>;
    case "success":
      return (
        <ul>
          {search.value.map((row) => (
            <li key={`${row.tour.id}:${row.tour.locale}`}>
              {label} · {row.tour.title} — {row.minAvailable} spots left
            </li>
          ))}
        </ul>
      );
    case "failure":
      return search.error satisfies never;
  }
}

// -- next departure (derived summary) ------------------------------------------------------------

export function NextDeparture() {
  const client = useResultClient<AppClient>();
  const summary = StaleShell.useQuery(client.profile.nextDeparture, {});
  const reschedule = StaleShell.useMutation(client.orders.reschedule);

  switch (summary.state) {
    case "pending":
      return <p>Checking departures…</p>;
    case "success":
      return (
        <section>
          {summary.value.kind === "upcoming" ? (
            <p>
              Next departure {summary.value.date} from {summary.value.hotelName}.
            </p>
          ) : (
            <p>No upcoming departures.</p>
          )}
          <button
            onClick={() =>
              void reschedule
                .mutate({ lineItemId: "li-2", date: "2026-07-30" })
                .catch(() => undefined)
            }
          >
            Move Clara's trip earlier
          </button>
          {reschedule.state === "failure" && (
            <p role="alert">
              {matchError(reschedule.error, {
                "booking/line-item-not-found": () => "That trip no longer exists.",
              })}
            </p>
          )}
        </section>
      );
    case "failure":
      return summary.error satisfies never;
  }
}

// -- the app ------------------------------------------------------------------------------------

export function Dashboard() {
  return (
    <main>
      <OrdersTree />
      <NoteEditor orderId="ord-1" />
      <HotelDesk hotelId="h-okura" />
      <TourDetail id="t-fuji" locale="en" />
      <TourDetail id="t-fuji" locale="ja" />
      <RenameTourForm id="t-fuji" locale="en" />
      <FeaturedTours locale="en" />
      <AvailabilityPanel label="Aug 1–2" from="2026-08-01" to="2026-08-02" locale="en" />
      <AvailabilityPanel label="Aug 2–3" from="2026-08-02" to="2026-08-03" locale="en" />
      <NextDeparture />
      <RetireTourButton id="t-fuji" />
    </main>
  );
}

export function App({ client }: { client: AppClient }) {
  return (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <Dashboard />
      </BoundaryProvider>
    </ResultRpcProvider>
  );
}
