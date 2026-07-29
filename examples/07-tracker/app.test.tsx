import { goOffline, goOnline } from "./test-setup.js";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { err, fieldIssues, ok, pickErrors, rpc, wire } from "../../src/index.js";
import { createBrowserClient, fetchTransport } from "../../src/client/index.js";
import { createResultRpcReact, useResultMutation, useResultQuery } from "../../src/react/index.js";
import { makeClient, type AppClient } from "./client.js";
import { CLOSED_AT, seedDb } from "./world.js";
import { makeHandler, type AppContext } from "./server.js";
import {
  App,
  BoundaryProvider,
  ConnectionBanner,
  ResultRpcProvider,
  signInReactions,
  useResultClient,
  ViewerShell,
} from "./app.tsx";
import { authErrors, directoryErrors, issueErrors } from "./errors.js";
import { Issue } from "./models.js";

// -- world ----------------------------------------------------------------------

/** Every procedure path, matched against the request envelope in the fetch wrapper. */
const PATHS = [
  "session.me",
  "issues.list",
  "issues.byId",
  "issues.create",
  "issues.assign",
  "issues.close",
  "issues.activity",
  "users.list",
  "projects.list",
] as const;

interface WorldOptions {
  userId?: string | null;
  fetchDirectory?: () => Promise<unknown>;
  gate?: () => Promise<void>;
}

function createWorld(options: WorldOptions = {}) {
  const context: AppContext = {
    db: seedDb(),
    userId: options.userId === undefined ? "user-alice" : options.userId,
    fetchDirectory:
      options.fetchDirectory ?? (async () => ({ memberIds: ["user-alice", "user-bob"] })),
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
  signInReactions.count = 0;
  return { context, counts, client, db: context.db };
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

async function typeTitle(renderer: ReactTestRenderer, value: string): Promise<void> {
  await act(async () => {
    renderer.root.findByType("input").props.onChange({ target: { value } });
  });
}

async function submitForm(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
  });
}

async function chooseAssignee(renderer: ReactTestRenderer, userId: string): Promise<void> {
  await act(async () => {
    renderer.root.findByType("select").props.onChange({ target: { value: userId } });
  });
}

afterEach(() => {
  goOnline();
});

// -- 1. wire round-trips and rich error data ---------------------------------------

test("direct client round-trips success, domain failure, and a Date inside error data", async () => {
  const { client } = createWorld();

  const found = await client.issues.byId({ id: "issue-1" });
  expect(found).toEqual(
    ok({
      id: "issue-1",
      projectId: "proj-main",
      title: "Fix login bug",
      status: "open",
      assigneeId: "user-bob",
      closedAt: null,
    }),
  );

  expect(await client.issues.byId({ id: "nope" })).toEqual(
    err(issueErrors.notFound({ issueId: "nope" })),
  );

  // Assigning a closed issue fails with a real Date on the other side of the wire.
  const closed = await client.issues.assign({ issueId: "issue-2", assigneeId: "user-bob" });
  expect(closed).toEqual(err(issueErrors.closed({ issueId: "issue-2", closedAt: CLOSED_AT })));
  if (!closed.ok && closed.error._tag === "issue/closed") {
    expect(closed.error.data.closedAt).toBeInstanceOf(Date);
  }
});

// -- 2. upstream granularity collapses at the procedure boundary --------------------

test("users.list collapses upstream unreachable/malformed to directory/unavailable", async () => {
  const unreachable = createWorld({
    fetchDirectory: async () => {
      throw new TypeError("connect ECONNREFUSED");
    },
  });
  expect(await unreachable.client.users.list({})).toEqual(err(directoryErrors.unavailable()));

  const malformed = createWorld({ fetchDirectory: async () => ({ nonsense: true }) });
  expect(await malformed.client.users.list({})).toEqual(err(directoryErrors.unavailable()));

  const healthy = createWorld();
  expect(await healthy.client.users.list({})).toEqual(
    ok([
      { id: "user-alice", name: "Alice" },
      { id: "user-bob", name: "Bob" },
    ]),
  );
});

// -- 3. flagship: assign patches list row + detail with zero refetches ---------------

test("assign updates the list row and detail by entity identity with zero refetches", async () => {
  const { client, counts } = createWorld();
  const renderer = await render(<App client={client} />);

  await waitForText(
    renderer,
    (text) =>
      text.includes("Fix login bug · open · Bob") &&
      text.includes("Assignee: Bob.") &&
      text.includes("Signed in as Alice"),
    "initial list, detail, and viewer header",
  );

  expect(counts["issues.list"]).toBe(1);
  expect(counts["issues.byId"]).toBe(1);

  // Snapshot every count once the initial render has fully settled — the
  // assertion below is that the mutation causes zero additional fetches.
  await act(settle);
  const baseline = { ...counts };

  await chooseAssignee(renderer, "user-alice");
  await waitForText(
    renderer,
    (text) => text.includes("Fix login bug · open · Alice") && text.includes("Assignee: Alice."),
    "assignee patched in both list and detail",
  );

  // Let any misguided invalidation land before pinning the counts.
  await act(settle);

  // The entity in the mutation output patched both cached queries in place:
  // exactly one new request (the mutation itself), zero refetches anywhere.
  expect(counts["issues.assign"]).toBe(1);
  expect(counts).toEqual({ ...baseline, "issues.assign": 1 });
});

// -- 4. close cascade: touch(Project) invalidates what the output cannot mention -----

test("close patches the issue by identity and touch(Project) refetches the projects panel", async () => {
  const { client, counts } = createWorld();
  const renderer = await render(<App client={client} />);

  await waitForText(
    renderer,
    (text) => text.includes("Main App — 1 open") && text.includes("Status: open."),
    "initial projects panel and detail",
  );
  expect(counts["projects.list"]).toBe(1);

  await clickButton(renderer, "Close issue");
  await waitForText(
    renderer,
    (text) =>
      text.includes("Status: closed.") &&
      text.includes("Fix login bug · closed · Bob") &&
      text.includes("Main App — 0 open"),
    "closed status everywhere and decremented project count",
  );
  await act(settle);

  // Issue queries were patched (no refetch); the project cascade refetched once.
  expect(counts["issues.byId"]).toBe(1);
  expect(counts["issues.list"]).toBe(1);
  expect(counts["projects.list"]).toBe(2);
  expect(counts["issues.close"]).toBe(1);
});

// -- 5. offline: paused, not failed; online event auto-resumes ------------------------

/** Unnarrowed probe rendered outside the viewer shell (test-only). */
function ListProbe() {
  const client = useResultClient();
  const list = useResultQuery(client.issues.list, {});
  if (list.state === "pending") {
    return <p>{list.fetch === "paused" ? "Waiting for a connection" : "Loading issues"}</p>;
  }
  return <p>{list.state === "success" ? "Issues loaded" : "Issues failed"}</p>;
}

test("offline mount pauses (never fails), banner shows, online event auto-resumes", async () => {
  const { client, counts } = createWorld();

  const tree = (withProbe: boolean) => (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <ConnectionBanner />
        {withProbe ? <ListProbe /> : null}
      </BoundaryProvider>
    </ResultRpcProvider>
  );
  const renderer = await render(tree(false));
  await act(async () => {
    goOffline();
  });
  await waitForText(renderer, (text) => text.includes("You're offline"), "offline banner");

  // Mount the query while offline: it must pause, not fail.
  await act(async () => {
    renderer.update(tree(true));
  });
  await waitForText(
    renderer,
    (text) => text.includes("Waiting for a connection"),
    "paused probe while offline",
  );
  expect(textOf(renderer)).not.toContain("Issues failed");
  expect(counts["issues.list"] ?? 0).toBe(0);

  await act(async () => {
    goOnline();
  });
  await waitForText(renderer, (text) => text.includes("Issues loaded"), "auto-resumed to success");
  expect(textOf(renderer)).not.toContain("You're offline");
  expect(counts["issues.list"]).toBe(1);
});

// -- 6. declared invalidation: create's .affects(list) refetches the list, and the
//       handler's touch(Project) refetches the panel the output cannot mention --------

test("create invalidates the issues list via .affects and touches the project", async () => {
  const { client, counts } = createWorld();
  const renderer = await render(<App client={client} />);

  await waitForText(renderer, (text) => text.includes("Fix login bug"), "initial list");
  expect(counts["issues.list"]).toBe(1);
  expect(counts["projects.list"]).toBe(1);

  await typeTitle(renderer, "Ship dark mode");
  await submitForm(renderer);

  await waitForText(
    renderer,
    (text) =>
      text.includes("Ship dark mode · open · unassigned") && text.includes("Main App — 2 open"),
    "created row in the list and bumped project count",
  );
  await act(settle);

  expect(counts["issues.create"]).toBe(1);
  expect(counts["issues.list"]).toBe(2); // exactly one .affects refetch
  expect(counts["projects.list"]).toBe(2); // exactly one touch refetch
});

// -- 7. optimistic create with client-minted id, rolled back on failure ---------------

test("optimistic create shows the row immediately and rolls back on domain failure", async () => {
  let release!: () => void;
  const gatePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client, counts } = createWorld({ gate: () => gatePromise });
  const renderer = await render(<App client={client} />);
  await waitForText(
    renderer,
    (text) => text.includes("Fix login bug · open · Bob"),
    "initial list",
  );

  // "Fix login bug" already exists — the server will reject with issue/title-taken,
  // but the optimistic row (born under its final, client-minted id) appears at once.
  await typeTitle(renderer, "Fix login bug");
  await submitForm(renderer);

  await waitForText(
    renderer,
    (text) => (text.match(/Fix login bug · open/g) ?? []).length === 2,
    "optimistic duplicate row while the mutation is held open",
  );

  await act(async () => {
    release();
  });
  await waitForText(
    renderer,
    (text) =>
      (text.match(/Fix login bug · open/g) ?? []).length === 1 &&
      text.includes('"Fix login bug" already exists.'),
    "rollback removed the optimistic row and the form shows the domain error",
  );
  await act(settle);
  // Failure triggers neither the declared invalidation nor the touch.
  expect(counts["issues.list"]).toBe(1);
  expect(counts["projects.list"]).toBe(1);
});

// -- 8. the two halves of input validation --------------------------------------------

test("the form catches schema-invalid input before the wire; nothing is sent", async () => {
  const { client, counts } = createWorld();
  const renderer = await render(<App client={client} />);
  await waitForText(renderer, (text) => text.includes("Create issue"), "form rendered");

  await typeTitle(renderer, "no");
  await submitForm(renderer);

  await waitForText(
    renderer,
    (text) => text.includes("Title must be at least 3 characters"),
    "schema field error rendered without a request",
  );
  expect(counts["issues.create"] ?? 0).toBe(0);
});

test("codec-rejected input on the same-version client is a caller bug: mutate rejects, state resets to idle", async () => {
  const { client } = createWorld();

  // The contract: the client-side codec preflight treats schema-invalid input
  // as a programmer error and throws — it never becomes an operation Result.
  await expect(
    client.issues.create({ id: "x", projectId: "proj-main", title: "no" }),
  ).rejects.toThrow(/Title must be at least 3 characters/);

  // Through the hook, the same rejection travels out of mutate() cleanly and
  // the mutation returns to idle (library behavior pinned after the fix).
  const rejections: unknown[] = [];
  function RawCreateProbe() {
    const probeClient = useResultClient();
    const create = useResultMutation(probeClient.issues.create);
    return (
      <div>
        <button
          onClick={() =>
            void create.mutate({ id: "x", projectId: "proj-main", title: "no" }).catch((reason) => {
              rejections.push(reason);
            })
          }
        >
          Force invalid
        </button>
        <p>Create state: {create.state}</p>
      </div>
    );
  }
  const renderer = await render(
    <ResultRpcProvider client={client}>
      <RawCreateProbe />
    </ResultRpcProvider>,
  );
  await clickButton(renderer, "Force invalid");
  await act(settle);
  expect(rejections).toHaveLength(1);
  expect(rejections[0]).toBeInstanceOf(TypeError);
  expect(textOf(renderer)).toContain("Create state: idle");
});

test("a stale-shaped client gets server/bad-request projected onto fields", async () => {
  // server/bad-request is for the wire: it reaches a client whose input codec
  // is more permissive than the server's — an old deploy inside the
  // compatibility window, or a hand-rolled caller. contractVersion is pinned
  // identically on both sides, so the failure is a bad request, not
  // client/stale. The form below models the old deploy: no schema preflight.
  const { context } = createWorld();
  const handler = makeHandler(context);
  let wireCalls = 0;
  const countingFetch = ((input: string | URL | Request, init?: RequestInit) => {
    wireCalls += 1;
    return handler(new Request(input, init));
  }) as typeof globalThis.fetch;

  const looseApp = rpc.context<Record<string, never>>();
  const looseContract = looseApp.contract({
    issues: {
      create: looseApp
        .procedure()
        .input(wire.object({ id: wire.string, title: wire.string }))
        .output(Issue.all("the tracker shows every issue field it stores"))
        .errors({ ...authErrors, ...pickErrors(issueErrors, "titleTaken") })
        .mutation(),
    },
  });
  const looseClient = createBrowserClient({
    contract: looseContract,
    transport: fetchTransport({ url: "https://tracker.test/rpc", fetch: countingFetch }),
    contractVersion: "07-tracker",
  });
  const { ResultRpcProvider: LooseResultRpcProvider } = createResultRpcReact<typeof looseClient>();

  function StaleDeployForm() {
    const [fields, setFields] = useState<Record<string, readonly string[]>>({});
    const create = useResultMutation(looseClient.issues.create);
    async function submit() {
      const result = await create.mutate({ id: "iss_stale", title: "no" });
      if (!result.ok && result.error._tag === "server/bad-request") {
        setFields(fieldIssues(result.error));
      }
    }
    return (
      <div>
        <button onClick={() => void submit()}>Create issue</button>
        {fields["title"] ? <p role="alert">{fields["title"].join("; ")}</p> : null}
      </div>
    );
  }

  const renderer = await render(
    <LooseResultRpcProvider client={looseClient}>
      <StaleDeployForm />
    </LooseResultRpcProvider>,
  );
  await clickButton(renderer, "Create issue");
  await waitForText(
    renderer,
    (text) => text.includes("Title must be at least 3 characters"),
    "field error projected from server/bad-request",
  );
  // The request crossed the wire, was rejected at the server's input decode,
  // and the handler never ran.
  expect(wireCalls).toBe(1);
});

// -- 9. exhaustive issue page: catalog messages for the domain union -------------------

test("issue page renders catalog messages for not-found and forbidden", async () => {
  const { client } = createWorld();

  const missing = await render(<App client={client} detailId="issue-404" />);
  await waitForText(
    missing,
    (text) => text.includes("Issue issue-404 was not found."),
    "not-found catalog message",
  );

  const forbidden = await render(<App client={client} detailId="issue-3" />);
  await waitForText(
    forbidden,
    (text) => text.includes("You do not have access to project proj-secret."),
    "forbidden catalog message",
  );
});

// -- 10. mutation failure carries the rich value into the UI ---------------------------

test("assigning a closed issue renders the closed-at instant from the error data", async () => {
  const { client } = createWorld();
  const renderer = await render(<App client={client} detailId="issue-2" />);

  await waitForText(renderer, (text) => text.includes("Archive old docs"), "closed issue detail");
  await chooseAssignee(renderer, "user-bob");
  await waitForText(
    renderer,
    (text) =>
      text.includes(
        `This issue was closed at ${CLOSED_AT.toISOString()} — reopen it to change the assignee.`,
      ),
    "closed error with Date data rendered",
  );
});

// -- 11. subscription: the activity feed streams over the wire -------------------------

test("activity feed renders streamed events and settles closed", async () => {
  const { client } = createWorld();
  const renderer = await render(<App client={client} />);

  await waitForText(
    renderer,
    (text) => text.includes("Latest activity: assigned to bob"),
    "latest streamed activity event",
  );
  await waitForText(renderer, (text) => text.includes("Activity feed ended."), "stream completed");
});

// -- 12. the auth arc: a signed-out world reaches the shell, not the components --------

test("a signed-out visitor sees the fallback and the sign-in reaction fires once", async () => {
  const { client, counts } = createWorld({ userId: null });
  const renderer = await render(<App client={client} />);

  await waitForText(renderer, (text) => text.includes("Signing you in…"), "viewer shell fallback");
  await act(settle);

  expect(signInReactions.count).toBe(1); // onError fired once
  expect(textOf(renderer)).not.toContain("Signed in as"); // authed subtree never rendered
  expect(counts["issues.list"] ?? 0).toBe(0); // no query under the shell ever ran
});

// -- 13. compile-time probes: what each call site can be asked to render ----------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

declare const probeClient: AppClient;

// issues.byId resolves a dozen possible failures; the page sees exactly two.
const probeDetail = () => ViewerShell.useQuery(probeClient.issues.byId, { id: "x" });
type DetailError = Extract<ReturnType<typeof probeDetail>, { state: "failure" }>["error"];
export type _DetailSeesOnlyItsDomain = Assert<
  Equal<DetailError["_tag"], "issue/not-found" | "project/forbidden">
>;
void probeDetail;

// issues.list declares only the auth union — under the onion it cannot fail
// in component space at all.
const probeList = () => ViewerShell.useQuery(probeClient.issues.list, {});
type ListError = Extract<ReturnType<typeof probeList>, { state: "failure" }>["error"];
export type _ListCannotFailInComponentSpace = Assert<Equal<ListError, never>>;
void probeList;
