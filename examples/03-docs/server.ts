/**
 * Rung 3, server: services supply the process graph, layers supply the request
 * chain, and handlers read like the business rules they implement.
 */
import { defineService, err, ok, resolveServices, rpc, wire } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import {
  SessionLayer,
  DocCodec,
  DocEventCodec,
  DocLocked,
  DocNotFound,
  ViewerLayer,
  type Doc,
  type User,
} from "./domain.js";

// -- services: the process-lifetime graph -----------------------------------------

export interface DocDb {
  userBySession(token: string): Promise<User | undefined>;
  doc(id: string): Promise<Doc | undefined>;
  saveDoc(doc: Doc): Promise<void>;
  lockOwner(id: string): Promise<string | undefined>;
  events(id: string): readonly { kind: "renamed" | "locked"; at: Date }[];
}

export const Db = defineService("db", {
  create: (): DocDb => {
    const users = new Map<string, User>([["tok_1", { id: "u_1", name: "Jokull" }]]);
    const docs = new Map<string, Doc>([
      ["doc_1", { id: "doc_1", title: "Roadmap", ownerId: "u_1", savedAt: new Date("2026-10-01") }],
      ["doc_2", { id: "doc_2", title: "Budget", ownerId: "u_2", savedAt: new Date("2026-11-01") }],
    ]);
    const locks = new Map<string, string>([["doc_2", "u_2"]]);
    return {
      userBySession: async (token) => users.get(token),
      doc: async (id) => docs.get(id),
      saveDoc: async (doc) => void docs.set(doc.id, doc),
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
  readonly db: DocDb;
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

const docById = protectedProcedure
  .input(wire.object({ id: wire.string }))
  .output(DocCodec)
  .errors({ DocNotFound })
  .query(async ({ input, context, errors }) => {
    const doc = await context.db.doc(input.id);
    if (!doc) return err(errors.DocNotFound({ docId: input.id }));
    return ok(doc);
  });

const renameDoc = protectedProcedure
  .input(wire.object({ id: wire.string, title: wire.string }))
  .output(DocCodec)
  .errors({ DocNotFound, DocLocked })
  .mutation(async ({ input, context, errors }) => {
    const doc = await context.db.doc(input.id);
    if (!doc) return err(errors.DocNotFound({ docId: input.id }));

    const lockedBy = await context.db.lockOwner(input.id);
    if (lockedBy && lockedBy !== context.viewer.id) {
      return err(errors.DocLocked({ lockedBy }));
    }
    if (doc.ownerId !== context.viewer.id) return err(errors.Unauthorized());

    const renamed = { ...doc, title: input.title };
    await context.db.saveDoc(renamed);
    context.audit.log(`${context.viewer.id} renamed ${doc.id}`);
    return ok(renamed);
  });

const docEvents = protectedProcedure
  .input(wire.object({ id: wire.string }))
  .output(DocEventCodec)
  .errors({ DocNotFound })
  .subscription();

export const docRouter = app.router({
  auth: { whoami, me },
  doc: {
    byId: docById,
    rename: renameDoc,
    events: app.implement(docEvents).stream(async function* ({ input, context, errors }) {
      const doc = await context.db.doc(input.id);
      if (!doc) {
        yield err(errors.DocNotFound({ docId: input.id }));
        return;
      }
      for (const event of context.db.events(input.id)) {
        yield ok({ docId: input.id, ...event });
      }
    }),
  },
});

// -- wiring: resolve services once, close over them per request ----------------------

export const createDocHandler = async () => {
  const services = await resolveServices({ db: Db, audit: Audit });
  return createFetchHandler({
    router: docRouter,
    createContext: ({ request }) => ({
      ...services,
      sessionToken: request.headers.get("x-session") ?? undefined,
    }),
  });
};
