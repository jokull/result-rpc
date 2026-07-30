/**
 * Rung 3, server: services supply the process graph, layers supply the request
 * chain, and handlers read like the business rules they implement.
 */
import { defineService, err, ok, resolveServices } from "../../src/index.js";
import { createFetchHandler, serverRpc } from "../../src/server/index.js";
import { SessionLayer, ViewerLayer, type Doc, type User } from "./domain.js";
import {
  docByIdContract,
  docEventsContract,
  meContract,
  renameDocContract,
  setAvatarContract,
  whoamiContract,
} from "./contract.js";

// -- services: the process-lifetime graph -----------------------------------------

export interface DocDb {
  userBySession(token: string): Promise<User | undefined>;
  setAvatar(userId: string, avatarUrl: string): Promise<User>;
  doc(id: string): Promise<Doc | undefined>;
  saveDoc(doc: Doc): Promise<void>;
  lockOwner(id: string): Promise<string | undefined>;
  events(id: string): readonly { kind: "renamed" | "locked"; at: Date }[];
}

export const Db = defineService("db", {
  create: (): DocDb => {
    const users = new Map<string, User>([
      ["tok_1", { id: "u_1", name: "Jokull", avatarUrl: "v1.png" }],
    ]);
    const docs = new Map<string, Doc>([
      ["doc_1", { id: "doc_1", title: "Roadmap", ownerId: "u_1", savedAt: new Date("2026-10-01") }],
      ["doc_2", { id: "doc_2", title: "Budget", ownerId: "u_2", savedAt: new Date("2026-11-01") }],
    ]);
    const locks = new Map<string, string>([["doc_2", "u_2"]]);
    return {
      userBySession: async (token) => users.get(token),
      setAvatar: async (userId, avatarUrl) => {
        for (const [token, user] of users) {
          if (user.id === userId) {
            const next = { ...user, avatarUrl };
            users.set(token, next);
            return next;
          }
        }
        throw new Error("unknown user");
      },
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
      /** Resolves the doc title through its db dependency for readable lines. */
      log: async (actorId: string, verb: string, docId: string) => {
        const doc = await db.doc(docId);
        lines.push(`${actorId} ${verb} "${doc?.title ?? docId}"`);
      },
      lines,
    };
  },
});

// -- request context ----------------------------------------------------------------

export interface RequestContext {
  readonly sessionToken: string | undefined;
  readonly db: DocDb;
  readonly audit: { log: (actorId: string, verb: string, docId: string) => Promise<void> };
}

const server = serverRpc.context<RequestContext>();

// session: reads the cookie, may find nobody — cannot fail
const session = SessionLayer.middleware(server, async ({ context }) =>
  ok(
    context.sessionToken ? ((await context.db.userBySession(context.sessionToken)) ?? null) : null,
  ),
);

// viewer: narrows to a real user, bundles session so one .use() is the whole chain
const authenticated = ViewerLayer.middleware(server, session);

// -- procedures -----------------------------------------------------------------------

const whoami = SessionLayer.implement(server, whoamiContract, session);
const me = ViewerLayer.implement(server, meContract, authenticated);

/** Returns WHO changed: every cached query containing this user patches in place. */
const setAvatar = server
  .implement(setAvatarContract)
  .use(authenticated)
  .handler(async ({ input, context }) =>
    ok(await context.db.setAvatar(context.viewer.id, input.avatarUrl)),
  );

const docById = server
  .implement(docByIdContract)
  .use(authenticated)
  .handler(async ({ input, context, errors }) => {
    const doc = await context.db.doc(input.id);
    if (!doc) return err(errors.DocNotFound({ docId: input.id }));
    return ok(doc);
  });

const renameDoc = server
  .implement(renameDocContract)
  .use(authenticated)
  .handler(async ({ input, context, errors }) => {
    const doc = await context.db.doc(input.id);
    if (!doc) return err(errors.DocNotFound({ docId: input.id }));

    const lockedBy = await context.db.lockOwner(input.id);
    if (lockedBy && lockedBy !== context.viewer.id) {
      return err(errors.DocLocked({ lockedBy }));
    }
    // Not-the-owner is 403, a domain outcome for the form — never
    // errors.Unauthorized(), which the viewer shell would answer with a
    // sign-in redirect.
    if (doc.ownerId !== context.viewer.id) return err(errors.DocForbidden());

    const renamed = { ...doc, title: input.title };
    await context.db.saveDoc(renamed);
    await context.audit.log(context.viewer.id, "renamed", doc.id);
    return ok(renamed);
  });

export const docRouter = server.router({
  auth: { whoami, me, setAvatar },
  doc: {
    byId: docById,
    rename: renameDoc,
    events: server
      .implement(docEventsContract)
      .use(authenticated)
      .stream(async function* ({ input, context, errors }) {
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
