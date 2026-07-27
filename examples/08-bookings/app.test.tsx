import "./test-setup.js";
import { expect, test } from "bun:test";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { err, ok } from "../../src/index.js";
import { makeClient, type AppClient } from "./client.js";
import { seedDb, TODAY } from "./world.js";
import { makeHandler, type AppContext } from "./server.js";
import { ResultRpcProvider } from "../../src/react/index.js";
import { App, BoundaryProvider, Dashboard, ReviewsPanel, StaleShell } from "./app.tsx";

// -- world ----------------------------------------------------------------------

/** Every procedure path, matched against the request envelope in the fetch wrapper. */
const PATHS = [
  "orders.list",
  "orders.setNote",
  "orders.reschedule",
  "hotels.byId",
  "hotels.updatePhone",
  "hotels.reviews",
  "hotels.reviewStats",
  "users.byId",
  "users.rename",
  "reviews.add",
  "tours.byId",
  "tours.featured",
  "tours.editTitle",
  "tours.retire",
  "availability.search",
  "profile.nextDeparture",
] as const;

interface WorldOptions {
  gate?: () => Promise<void>;
}

async function createWorld(options: WorldOptions = {}) {
  const context: AppContext = {
    db: await seedDb(),
    today: TODAY,
    currentUserId: "u-sara",
    ...(options.gate ? { gate: options.gate } : {}),
  };
  const handler = makeHandler(context);
  // The request envelope carries the procedure path, so the tests count
  // requests per path from outside the server — the contract stays clean.
  const counts: Record<string, number> = {};
  const localFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = await request.clone().text();
    for (const path of PATHS) {
      if (body.includes(`"${path}"`)) counts[path] = (counts[path] ?? 0) + 1;
    }
    return handler(request);
  }) as typeof globalThis.fetch;
  const client = makeClient(localFetch);
  return { context, counts, client };
}

// -- render helpers ---------------------------------------------------------------

function instanceText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(instanceText).join("");
}

function flattenText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "children" in (node as object)) {
    return `${flattenText((node as { children: unknown }).children)}\n`;
  }
  return "";
}

const textOf = (renderer: ReactTestRenderer) => flattenText(renderer.toJSON());

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

async function waitForText(
  renderer: ReactTestRenderer,
  predicate: (text: string) => boolean,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate(textOf(renderer))) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`timed out waiting for ${label}\n--- rendered ---\n${textOf(renderer)}`);
}

async function clickButton(renderer: ReactTestRenderer, label: string): Promise<void> {
  const button = renderer.root
    .findAllByType("button")
    .find((candidate) => instanceText(candidate) === label);
  if (!button) throw new Error(`no button labelled "${label}"`);
  await act(async () => {
    button.props.onClick();
  });
}

async function typeInto(
  renderer: ReactTestRenderer,
  placeholder: string,
  value: string,
): Promise<void> {
  const input = renderer.root
    .findAllByType("input")
    .find((candidate) => candidate.props.placeholder === placeholder);
  if (!input) throw new Error(`no input with placeholder "${placeholder}"`);
  await act(async () => {
    input.props.onChange({ target: { value } });
  });
}

async function chooseRating(renderer: ReactTestRenderer, value: string): Promise<void> {
  await act(async () => {
    renderer.root.findByType("select").props.onChange({ target: { value } });
  });
}

async function submitForm(renderer: ReactTestRenderer, buttonLabel: string): Promise<void> {
  const button = renderer.root
    .findAllByType("button")
    .find((candidate) => instanceText(candidate) === buttonLabel);
  if (!button) throw new Error(`no button labelled "${buttonLabel}"`);
  let form: ReactTestInstance | null = button.parent ?? null;
  while (form && form.type !== "form") form = form.parent ?? null;
  if (!form) throw new Error(`button "${buttonLabel}" is not inside a form`);
  const target = form;
  await act(async () => {
    target.props.onSubmit({ preventDefault: () => undefined });
  });
}

/** Renders the full dashboard and waits for every panel's initial data. */
async function renderSettledApp(client: AppClient): Promise<ReactTestRenderer> {
  const renderer = await render(<App client={client} />);
  await waitForText(
    renderer,
    (text) =>
      text.includes("Order ord-1 — booked by Kenji Mori") &&
      text.includes("Front desk: Hotel Okura") &&
      text.includes("Guest rating 4.2 · 5 reviews") &&
      text.includes("“Quiet floors, would return” — Noah Brandt (4/5)") &&
      text.includes("“Concierge went above and beyond” — Mei Ito (5/5)") &&
      text.includes("Top reviewer: Kenji Mori") &&
      text.includes("[en] Mount Fuji Day Trip") &&
      text.includes("[ja] 富士山日帰りツアー") &&
      text.includes("★ Mount Fuji Day Trip") &&
      text.includes("Aug 1–2 · Mount Fuji Day Trip — 2 spots left") &&
      text.includes("Aug 2–3 · Mount Fuji Day Trip — 4 spots left") &&
      text.includes("Next departure 2026-08-10 from Hotel Okura."),
    "every dashboard panel settled",
  );
  await act(settle);
  return renderer;
}

// -- 1. the wire is real: deep tree round-trips through drizzle + sqlite ------------------

test("direct client round-trips the deep tree with column subsets at every level", async () => {
  const { client } = await createWorld();

  const list = await client.orders.list({});
  expect(list).toEqual(
    ok([
      {
        order: { id: "ord-1", note: "Honeymoon trip" },
        bookedBy: { id: "u-kenji", name: "Kenji Mori" },
        lineItems: [
          {
            id: "li-1",
            date: "2026-08-10",
            nights: 7,
            destinations: [
              {
                idx: 0,
                nights: 3,
                hotel: { id: "h-okura", name: "Hotel Okura", phone: "+81-3-0001" },
                rooms: [
                  {
                    description: "Double room",
                    board: "breakfast",
                    occupants: [
                      { firstName: "Aiko", lastName: "Tanaka" },
                      { firstName: "Ben", lastName: "Tanaka" },
                    ],
                  },
                ],
              },
              {
                idx: 1,
                nights: 4,
                hotel: { id: "h-granvia", name: "Hotel Granvia", phone: "+81-75-0002" },
                rooms: [
                  {
                    description: "Twin room",
                    board: "room-only",
                    occupants: [
                      { firstName: "Aiko", lastName: "Tanaka" },
                      { firstName: "Ben", lastName: "Tanaka" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        order: { id: "ord-2", note: "Anniversary" },
        bookedBy: { id: "u-sara", name: "Sara Lind" },
        lineItems: [
          {
            id: "li-2",
            date: "2026-09-05",
            nights: 5,
            destinations: [
              {
                idx: 0,
                nights: 2,
                hotel: { id: "h-miyajima", name: "Ryokan Miyajima", phone: "+81-829-0003" },
                rooms: [
                  {
                    description: "Single room",
                    board: "half-board",
                    occupants: [{ firstName: "Clara", lastName: "Nilsson" }],
                  },
                ],
              },
              {
                idx: 1,
                nights: 3,
                hotel: { id: "h-okura", name: "Hotel Okura", phone: "+81-3-0001" },
                rooms: [
                  {
                    description: "Deluxe double",
                    board: "breakfast",
                    occupants: [{ firstName: "Clara", lastName: "Nilsson" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]),
  );

  // Composite-key lookups: (t-fuji, en) and (t-fuji, ja) are separate rows.
  expect(await client.tours.byId({ id: "t-fuji", locale: "ja" })).toEqual(
    ok({
      id: "t-fuji",
      locale: "ja",
      title: "富士山日帰りツアー",
      summary: "湖畔を巡る日帰りの旅。",
    }),
  );
  expect(await client.tours.byId({ id: "t-nope", locale: "en" })).toEqual(
    err({ _tag: "tours/not-found", data: { tourId: "t-nope", locale: "en" } }),
  );
});

// -- 2. flagship: one mutation patches a depth-4 entity node and a sibling query,
//       with zero refetches anywhere ------------------------------------------------------

test("updatePhone patches the hotel at depth 4 in the tree AND the desk query — zero refetches", async () => {
  const { client, counts } = await createWorld();
  const renderer = await renderSettledApp(client);

  // The Okura phone renders three times: two Stop lines (one per order, at
  // depth 4 of the tree) and the front-desk panel (a separate query).
  expect(occurrences(textOf(renderer), "+81-3-0001")).toBe(3);

  const baseline = { ...counts };

  await clickButton(renderer, "Update Okura phone");
  await waitForText(
    renderer,
    (text) => occurrences(text, "+81-3-9999") === 3 && !text.includes("+81-3-0001"),
    "new phone in both tree occurrences and the desk",
  );
  await act(settle);

  // One request in the whole world: the mutation. The Hotel entity in its
  // output patched every cached occurrence in place.
  expect(counts).toEqual({ ...baseline, "hotels.updatePhone": 1 });

  // And a projection patches too: setNote returns Order.pick("id", "note"),
  // which lands on the order node inside the tree row.
  await typeInto(renderer, "Order note", "Champagne on arrival");
  await submitForm(renderer, "Save note");
  await waitForText(
    renderer,
    (text) => text.includes("Note: Champagne on arrival") && !text.includes("Note: Honeymoon trip"),
    "note patched on the order node",
  );
  await act(settle);
  expect(counts).toEqual({ ...baseline, "hotels.updatePhone": 1, "orders.setNote": 1 });
});

// -- 3. the locale trap, closed: composite keys keep (t1, en) and (t1, ja) apart ------------

test("editing the en title patches en detail + en featured row, leaves ja untouched — one request", async () => {
  let release!: () => void;
  const gatePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client, counts } = await createWorld({ gate: () => gatePromise });
  const renderer = await renderSettledApp(client);
  const baseline = { ...counts };

  await typeInto(renderer, "New English title", "Sunrise Over Fuji");
  await submitForm(renderer, "Rename tour");

  // The server is gated: what renders now is the OPTIMISTIC patch, addressed
  // by record key — cache.updateEntity(TourContent, { id, locale: "en" }).
  // It lands on the en detail and the en featured row; the ja detail, a
  // different entity under the same id, is untouched.
  await waitForText(
    renderer,
    (text) =>
      text.includes("[en] Sunrise Over Fuji") &&
      text.includes("★ Sunrise Over Fuji") &&
      text.includes("[ja] 富士山日帰りツアー"),
    "optimistic en patch while the mutation is held open",
  );
  expect(counts).toEqual({ ...baseline, "tours.editTitle": 1 });

  await act(async () => {
    release();
  });
  await act(settle);

  // Confirmation is a no-op patch: same values, still exactly one request.
  const text = textOf(renderer);
  expect(text).toContain("[en] Sunrise Over Fuji");
  expect(text).toContain("★ Sunrise Over Fuji");
  expect(text).toContain("[ja] 富士山日帰りツアー");
  expect(text).not.toContain("[en] Mount Fuji Day Trip");
  expect(counts).toEqual({ ...baseline, "tours.editTitle": 1 });
});

// -- 4. query-relative aggregates stay out of models --------------------------------------

test("renaming the tour patches tour.title in both searches; each keeps its OWN minAvailable", async () => {
  const { client, counts } = await createWorld();
  const renderer = await renderSettledApp(client);
  const baseline = { ...counts };

  // Same entity, two different aggregates — minAvailable is a fact about the
  // input date range, so it lives in the one-off row, not on the model.
  await typeInto(renderer, "New English title", "Fuji Sunrise Special");
  await submitForm(renderer, "Rename tour");

  await waitForText(
    renderer,
    (text) =>
      text.includes("Aug 1–2 · Fuji Sunrise Special — 2 spots left") &&
      text.includes("Aug 2–3 · Fuji Sunrise Special — 4 spots left") &&
      text.includes("Aug 1–2 · Kyoto Temples Walk — 6 spots left") &&
      text.includes("Aug 2–3 · Kyoto Temples Walk — 3 spots left"),
    "title patched in both search panels, per-range aggregates intact",
  );
  await act(settle);

  // The title flowed into every cached row by identity; the aggregates could
  // not be touched by construction — and nothing refetched.
  expect(counts).toEqual({ ...baseline, "tours.editTitle": 1 });
});

// -- 5. derived summaries are .affects territory --------------------------------------------

test("reschedule refetches the derived summary (and the tree) exactly once, recomputed", async () => {
  const { client, counts } = await createWorld();
  const renderer = await renderSettledApp(client);
  expect(textOf(renderer)).toContain("Departs 2026-09-05");
  const baseline = { ...counts };

  await clickButton(renderer, "Move Clara's trip earlier");

  // No entity in nextDeparture's output could carry this change — the
  // summary is derived. The mutation's .affects() declarations refetch the
  // summary and the orders tree (whose one-off `date` field also moved).
  await waitForText(
    renderer,
    (text) =>
      text.includes("Next departure 2026-07-30 from Ryokan Miyajima.") &&
      text.includes("Departs 2026-07-30") &&
      !text.includes("Departs 2026-09-05"),
    "recomputed summary and refreshed tree",
  );
  await act(settle);

  expect(counts).toEqual({
    ...baseline,
    "orders.reschedule": 1,
    "profile.nextDeparture": (baseline["profile.nextDeparture"] ?? 0) + 1,
    "orders.list": (baseline["orders.list"] ?? 0) + 1,
  });
});

// -- 6. touch with a record key: retiring both locales sends each query to its
//       honest not-found arc -------------------------------------------------------------------

test("retire deletes both locales and touch(TourContent, {id, locale}) refetches every mention", async () => {
  const { client, counts } = await createWorld();
  const renderer = await renderSettledApp(client);
  const baseline = { ...counts };

  await clickButton(renderer, "Retire the Fuji tour");

  await waitForText(
    renderer,
    (text) =>
      text.includes("[en] This tour is no longer published.") &&
      text.includes("[ja] This tour is no longer published.") &&
      !text.includes("★ Mount Fuji Day Trip") &&
      !text.includes("Aug 1–2 · Mount Fuji Day Trip") &&
      text.includes("Aug 1–2 · Kyoto Temples Walk — 6 spots left"),
    "both locale details in the not-found arc; fuji gone from featured and search",
  );
  await act(settle);

  // The touch keys are per-entity: (t-fuji, en) invalidates the en detail,
  // the en featured list, and both search panels (their rows embed the en
  // projection); (t-fuji, ja) invalidates the ja detail. One refetch each.
  expect(counts).toEqual({
    ...baseline,
    "tours.retire": 1,
    "tours.byId": (baseline["tours.byId"] ?? 0) + 2,
    "tours.featured": (baseline["tours.featured"] ?? 0) + 1,
    "availability.search": (baseline["availability.search"] ?? 0) + 2,
  });
});

// -- 7. the cross-page pagination proof: identity freshness ignores page boundaries ----------

test("users.rename patches the author across cached review pages, the profile card, and the tree — zero refetches", async () => {
  const { client, counts } = await createWorld();

  // One review per (hotel, author) — the round-three UNIQUE constraint —
  // means one author can never hold two rows in one hotel's feed. So the
  // cross-page world is two paginated feeds: the dashboard's Okura panel
  // (Kenji on page 2) plus a Granvia panel (Kenji on page 1).
  const renderer = await render(
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <Dashboard />
        <ReviewsPanel hotelId="h-granvia" />
      </BoundaryProvider>
    </ResultRpcProvider>,
  );
  await waitForText(
    renderer,
    (text) =>
      text.includes("Top reviewer: Kenji Mori") &&
      text.includes("Order ord-1 — booked by Kenji Mori") &&
      text.includes("“Perfect Kyoto base” — Kenji Mori (4/5)"),
    "dashboard and the Granvia feed settled",
  );

  // Mount Okura page 2 alongside page 1 ("load more": both stay live queries).
  await clickButton(renderer, "Show older reviews");
  await waitForText(
    renderer,
    (text) =>
      text.includes("“Best onsen in Tokyo” — Kenji Mori (5/5)") &&
      text.includes("“Great breakfast spread” — Liv Sørensen (4/5)"),
    "Okura page 2 mounted (Kenji's Okura row visible)",
  );
  await act(settle);
  const baseline = { ...counts };

  await clickButton(renderer, "Shorten Kenji's name");

  // Four surfaces, one entity: a row on Okura page 2, a row on Granvia
  // page 1, the top-reviewer card, and the orders tree's booked-by line.
  // Pages — of either feed — are just more cached queries containing the
  // same entity.
  await waitForText(
    renderer,
    (text) => occurrences(text, "Kenji M.") === 4 && !text.includes("Kenji Mori"),
    "renamed author on both paginated feeds, the card, and the tree",
  );
  await act(settle);

  expect(counts).toEqual({ ...baseline, "users.rename": 1 });
});

// -- 8. mixed mutation: identity patching + declared membership/aggregate blast radius --------

test("reviews.add refetches the ACTIVE page and the stats aggregate — exactly the declared blast radius", async () => {
  const { client, counts } = await createWorld();
  const renderer = await renderSettledApp(client);

  // Cache page 2, then collapse it: it stays cached but INACTIVE.
  await clickButton(renderer, "Show older reviews");
  await waitForText(
    renderer,
    (text) => text.includes("“Best onsen in Tokyo” — Kenji Mori (5/5)"),
    "page 2 cached",
  );
  await clickButton(renderer, "Collapse older reviews");
  await waitForText(
    renderer,
    (text) => !text.includes("“Best onsen in Tokyo” — Kenji Mori (5/5)"),
    "page 2 unmounted",
  );
  await act(settle);
  const baseline = { ...counts };

  await chooseRating(renderer, "2");
  await typeInto(renderer, "Share your stay", "Room was noisy");
  await submitForm(renderer, "Post review");

  // The new review lands at the top of page 1 (newest-first), pushing rv-3
  // off the page, and the aggregate recomputes: 23/6 = 3.8.
  await waitForText(
    renderer,
    (text) =>
      text.includes("“Room was noisy” — Sara Lind (2/5)") &&
      text.includes("Guest rating 3.8 · 6 reviews") &&
      !text.includes("“Rooms are small but spotless” — Tomas Keller (3/5)"),
    "new review on page 1, membership shifted, stats recomputed",
  );
  await act(settle);

  // Exactly the declared blast radius: the mutation, ONE refetch of the
  // active page 1, ONE refetch of the stats aggregate. The cached-but-
  // collapsed page 2 was invalidated without being fetched.
  expect(counts).toEqual({
    ...baseline,
    "reviews.add": 1,
    "hotels.reviews": (baseline["hotels.reviews"] ?? 0) + 1,
    "hotels.reviewStats": (baseline["hotels.reviewStats"] ?? 0) + 1,
  });

  // Re-expanding fetches page 2 fresh membership exactly once: rv-3 slid
  // onto it.
  await clickButton(renderer, "Show older reviews");
  await waitForText(
    renderer,
    (text) =>
      text.includes("“Rooms are small but spotless” — Tomas Keller (3/5)") &&
      text.includes("“Best onsen in Tokyo” — Kenji Mori (5/5)"),
    "page 2 remounted with shifted membership",
  );
  await act(settle);
  expect(counts["hotels.reviews"]).toBe((baseline["hotels.reviews"] ?? 0) + 2);

  // -- the duplicate attempt: the INSERT is the uniqueness check ------------------
  //
  // Sara already reviewed this hotel (she just did, above). Posting again
  // hits the UNIQUE(hotel_id, author_id) constraint; the handler collapses
  // db/unique-violation to the declared reviews/already-reviewed — with no
  // pre-check SELECT round trip anywhere, and correct under concurrency
  // where a SELECT-first check would race.
  const afterFirst = { ...counts };

  await chooseRating(renderer, "4");
  await typeInto(renderer, "Share your stay", "Trying again");
  await submitForm(renderer, "Post review");

  await waitForText(
    renderer,
    (text) => text.includes("You've already reviewed this hotel."),
    "already-reviewed message from the collapsed constraint outcome",
  );
  await act(settle);

  // Exactly ONE request for the failed attempt — the mutation itself — and
  // NO invalidation side effects: .affects only fires on success, so the
  // page and the stats aggregate were not refetched.
  expect(counts).toEqual({
    ...afterFirst,
    "reviews.add": (afterFirst["reviews.add"] ?? 0) + 1,
  });
  // The failed attempt changed nothing: the feed still shows Sara's first
  // review once, and the stats still count six.
  expect(occurrences(textOf(renderer), "— Sara Lind")).toBe(1);
  expect(textOf(renderer)).toContain("Guest rating 3.8 · 6 reviews");

  // And the FK constraint covers the other client-supplied reference the
  // same way: a dangling hotel id collapses to the declared not-found.
  expect(await client.reviews.add({ hotelId: "h-nope", rating: 5, body: "ghost" })).toEqual(
    err({ _tag: "hotel/not-found", data: { hotelId: "h-nope" } }),
  );
});

// -- 9. compile-time probes: what each call site can be asked to render ----------------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

declare const probeClient: AppClient;

// Under the boundary onion, the tour detail sees exactly its domain error.
const probeTour = () =>
  StaleShell.useQuery(probeClient.tours.byId, { id: "t-fuji", locale: "en" });
type TourError = Extract<ReturnType<typeof probeTour>, { state: "failure" }>["error"];
export type _TourDetailSeesOnlyNotFound = Assert<Equal<TourError["_tag"], "tours/not-found">>;
void probeTour;

// orders.list declares no domain errors — under the onion it cannot fail in
// component space at all. This compiles only while the boundary claims hold.
const probeOrders = () => StaleShell.useQuery(probeClient.orders.list, {});
type OrdersError = Extract<ReturnType<typeof probeOrders>, { state: "failure" }>["error"];
export type _OrdersTreeCannotFailInComponentSpace = Assert<Equal<OrdersError, never>>;
void probeOrders;
