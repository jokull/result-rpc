import { expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createDocHandler } from "./server.js";
import {
  DocsApp,
  makeDocClient,
  signInReactions,
  ViewerShell,
  type DocClient,
} from "./ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const boot = async (session?: string) => {
  const handler = await createDocHandler();
  const client = makeDocClient(((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (session) request.headers.set("x-session", session);
    return handler(request);
  }) as typeof globalThis.fetch);
  signInReactions.count = 0;
  return client;
};

const mount = async (client: DocClient, docId: string) => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<DocsApp client={client} docId={docId} />);
    await settle();
  });
  return renderer!;
};

test("03-docs: signed-in flow renders through every layer", async () => {
  const client = await boot("tok_1");
  const renderer = await mount(client, "doc_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Welcome back, Jokull");   // SessionShell value
  expect(html).toContain("Roadmap");                // page query
  expect(html).toContain("Planned by ");            // ViewerShell guarantee
  expect(html).toContain("Last activity: ");       // rendered subscription
  expect(html).toContain("renamed");
  await act(async () => renderer.unmount());
});

test("03-docs: renaming a locked doc surfaces exactly DocLocked", async () => {
  const client = await boot("tok_1");
  const renderer = await mount(client, "doc_2");
  const form = renderer.root.findByType("form");
  await act(async () => {
    form.props.onSubmit({
      preventDefault: () => undefined,
      currentTarget: { elements: { namedItem: () => ({ value: "Budget 2027" }) } },
    });
    await settle();
  });
  expect(JSON.stringify(renderer.toJSON())).toContain("Locked by u_2");
  await act(async () => renderer.unmount());
});

test("03-docs: signed-out visitors see the public shell and the sign-in reaction", async () => {
  const client = await boot(undefined);
  const renderer = await mount(client, "doc_1");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("Welcome, guest");     // SessionShell provides null
  expect(html).toContain("signing in…");        // ViewerShell fallback
  expect(html).not.toContain("Planned by");     // authed subtree never rendered
  expect(signInReactions.count).toBe(1);        // onError fired once
  await act(async () => renderer.unmount());
});

test("03-docs: a missing doc is the page's own failure branch", async () => {
  const client = await boot("tok_1");
  const renderer = await mount(client, "doc_404");
  const html = JSON.stringify(renderer.toJSON());
  expect(html).toContain("does not exist.");
  expect(html).toContain("doc_404");
  expect(html).not.toContain("Loading doc…"); // terminal failure, not a spinner
  await act(async () => renderer.unmount());
});

test("03-docs: the subscription streams under the same union", async () => {
  const client = await boot("tok_1");
  const events: unknown[] = [];
  for await (const event of client.doc.events({ id: "doc_1" })) {
    events.push(event);
  }
  expect(events).toEqual([
    { ok: true, value: { docId: "doc_1", kind: "renamed", at: new Date("2026-01-01") } },
  ]);
});

// -- compile-time: the narrowed unions are exactly what the prose claims -------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

declare const probeClient: DocClient;

// doc.byId declares DocNotFound + seven framework tags; the page sees one.
const probeDoc = () => ViewerShell.useQuery(probeClient.doc.byId, { id: "x" });
type DocQueryState = ReturnType<typeof probeDoc>;
type DocQueryError = Extract<DocQueryState, { state: "failure" }>["result"]["error"];
export type _DocQueryIsOnlyNotFound = Assert<Equal<DocQueryError["_tag"], "doc/not-found">>;

// doc.rename resolves eleven possible failures; the form sees its three domain outcomes.
const probeRename = () => ViewerShell.useMutation(probeClient.doc.rename);
type RenameState = ReturnType<typeof probeRename>;
type RenameError = Extract<RenameState, { state: "failure" }>["result"]["error"];
export type _RenameIsExactlyDomain = Assert<
  Equal<RenameError["_tag"], "doc/not-found" | "doc/locked" | "doc/forbidden">
>;
void probeRename;
void probeDoc;
