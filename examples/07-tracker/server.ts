/**
 * Server half: the request context shape, the session middleware derived
 * from the layer, contract implementations, the router, and a fetch-handler
 * factory the tests use.
 */
import { err, gen, mapError, ok, type InputOf } from "../../src/index.js";
import { createFetchHandler } from "../../src/server/index.js";
import {
  app,
  appContract,
  assignIssueContract,
  closeIssueContract,
  createIssueContract,
  issueActivityContract,
  issueByIdContract,
  listIssuesContract,
  listProjectsContract,
  listUsersContract,
  SessionLayer,
  sessionMeContract,
} from "./contract.js";
import { fetchMemberIds } from "./directory.js";
import { Issue, Project, User, type ActivityEvent } from "./models.js";

// -- request context ------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type UserRow = Mutable<InputOf<typeof User.codec>>;
export type ProjectRow = Mutable<InputOf<typeof Project.codec>>;
export type IssueRow = Mutable<InputOf<typeof Issue.codec>>;

export interface TrackerDb {
  users: Map<string, UserRow>;
  projects: Map<string, ProjectRow>;
  issues: Map<string, IssueRow>;
  activity: Map<string, ActivityEvent[]>;
}

export interface AppContext {
  db: TrackerDb;
  /** simulates the session cookie */
  userId: string | null;
  /** throwing upstream: the user directory service */
  fetchDirectory: () => Promise<unknown>;
  /** optional gate the tests use to hold the create mutation open */
  gate?: () => Promise<void>;
}

// -- session ------------------------------------------------------------------

const sessionMiddleware = SessionLayer.middleware(app, ({ context, errors }) => {
  const user = context.userId ? context.db.users.get(context.userId) : undefined;
  return user ? ok(user) : err(errors.unauthorized());
});

// -- issues -------------------------------------------------------------------

const listIssues = app
  .implement(listIssuesContract)
  .use(sessionMiddleware)
  .handler(({ context }) => ok([...context.db.issues.values()]));

const issueById = app
  .implement(issueByIdContract)
  .use(sessionMiddleware)
  .handler(({ input, errors, context }) => {
    const issue = context.db.issues.get(input.id);
    if (!issue) return err(errors.notFound({ issueId: input.id }));
    if (issue.projectId === "proj-secret") {
      return err(errors.forbidden({ projectId: issue.projectId }));
    }
    return ok(issue);
  });

const createIssue = app
  .implement(createIssueContract)
  .use(sessionMiddleware)
  .handler(async ({ input, errors, context, touch }) => {
    if (context.gate) await context.gate();
    for (const existing of context.db.issues.values()) {
      if (existing.title === input.title) {
        return err(errors.titleTaken({ title: input.title }));
      }
    }
    const issue = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      status: "open" as const,
      assigneeId: null,
      closedAt: null,
    };
    context.db.issues.set(issue.id, issue);
    const project = context.db.projects.get(issue.projectId);
    if (project) {
      project.openCount += 1;
      // The output is the Issue — the project's open count changed too, and
      // the output cannot mention it, so it rides the envelope as a touch.
      touch(Project, project.id);
    }
    return ok(issue);
  });

const assignIssue = app
  .implement(assignIssueContract)
  .use(sessionMiddleware)
  .handler(({ input, errors, context }) => {
    const issue = context.db.issues.get(input.issueId);
    if (!issue) return err(errors.notFound({ issueId: input.issueId }));
    if (issue.status === "closed") {
      return err(
        errors.closed({ issueId: issue.id, closedAt: issue.closedAt ?? new Date() }),
      );
    }
    issue.assigneeId = input.assigneeId;
    return ok(issue);
  });

const closeIssue = app
  .implement(closeIssueContract)
  .use(sessionMiddleware)
  .handler(({ input, errors, context, touch }) => {
    const issue = context.db.issues.get(input.issueId);
    if (!issue) return err(errors.notFound({ issueId: input.issueId }));
    if (issue.status === "open") {
      issue.status = "closed";
      issue.closedAt = new Date();
      const project = context.db.projects.get(issue.projectId);
      if (project) {
        project.openCount -= 1;
        touch(Project, project.id);
      }
    }
    return ok(issue);
  });

const issueActivity = app
  .implement(issueActivityContract)
  .use(sessionMiddleware)
  .stream(async function* ({ input, errors, context }) {
    const issue = context.db.issues.get(input.issueId);
    if (!issue) {
      yield err(errors.notFound({ issueId: input.issueId }));
      return;
    }
    for (const event of context.db.activity.get(input.issueId) ?? []) {
      yield ok(event);
    }
  });

// -- users and projects ---------------------------------------------------------

const listUsers = app
  .implement(listUsersContract)
  .use(sessionMiddleware)
  .handler(({ errors, context }) =>
    gen(async function* () {
      // Granular upstream union collapses to one declared tag here.
      const memberIds = yield* mapError(
        await fetchMemberIds(context.fetchDirectory),
        () => errors.unavailable(),
      );
      return memberIds.flatMap((id) => {
        const user = context.db.users.get(id);
        return user ? [user] : [];
      });
    }),
  );

const listProjects = app
  .implement(listProjectsContract)
  .use(sessionMiddleware)
  .handler(({ context }) => ok([...context.db.projects.values()]));

// -- router and handler ---------------------------------------------------------

export const router = app.router({
  session: { me: SessionLayer.procedure(app, sessionMeContract, sessionMiddleware) },
  issues: {
    list: listIssues,
    byId: issueById,
    create: createIssue,
    assign: assignIssue,
    close: closeIssue,
    activity: issueActivity,
  },
  users: { list: listUsers },
  projects: { list: listProjects },
});

export const contract = appContract;

export const makeHandler = (context: AppContext) =>
  createFetchHandler({
    router,
    createContext: () => context,
    contractVersion: "07-tracker",
  });
