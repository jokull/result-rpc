/**
 * The shared contract: codecs, tags, layers, invalidation — a value both
 * sides close over. No handler code and no server context shapes live here;
 * `AppContext` is imported type-only from the server half.
 */
import { defineLayer, pickErrors, rpc, wire } from "../../src/index.js";
import { authErrors, directoryErrors, issueErrors, projectErrors } from "./errors.js";
import { ActivityEventCodec, Issue, Project, User } from "./models.js";
import { createIssueSchema } from "./schema.js";
import type { AppContext } from "./server.js";

export const app = rpc.context<AppContext>();

// -- session layer ------------------------------------------------------------

export const SessionLayer = defineLayer({
  name: "session",
  key: "viewer",
  provides: User.all("a tracker user is a public name and an id"),
  errors: authErrors,
});

export const sessionMeContract = SessionLayer.contract(app);

// -- issues -------------------------------------------------------------------

export const listIssuesContract = app
  .procedure()
  .input(wire.object({}))
  .output(wire.array(Issue.all("the tracker shows every issue field it stores")))
  .errors({ ...authErrors })
  .query();

export const issueByIdContract = app
  .procedure()
  .input(wire.object({ id: wire.string }))
  .output(Issue.all("the tracker shows every issue field it stores"))
  .errors({
    ...authErrors,
    ...pickErrors(issueErrors, "notFound"),
    ...projectErrors,
  })
  .query();

export const createIssueContract = app
  .procedure()
  .input(wire.standard(createIssueSchema))
  .output(Issue.all("the tracker shows every issue field it stores"))
  .errors({ ...authErrors, ...pickErrors(issueErrors, "titleTaken") })
  .affects(listIssuesContract)
  .mutation();

export const assignIssueContract = app
  .procedure()
  .input(wire.object({ issueId: wire.string, assigneeId: wire.string }))
  .output(Issue.all("the tracker shows every issue field it stores"))
  .errors({ ...authErrors, ...pickErrors(issueErrors, "notFound", "closed") })
  .mutation();

export const closeIssueContract = app
  .procedure()
  .input(wire.object({ issueId: wire.string }))
  .output(Issue.all("the tracker shows every issue field it stores"))
  .errors({ ...authErrors, ...pickErrors(issueErrors, "notFound") })
  .mutation();

export const issueActivityContract = app
  .procedure()
  .input(wire.object({ issueId: wire.string }))
  .output(ActivityEventCodec)
  .errors({ ...authErrors, ...pickErrors(issueErrors, "notFound") })
  .subscription();

// -- users and projects ---------------------------------------------------------

export const listUsersContract = app
  .procedure()
  .input(wire.object({}))
  .output(wire.array(User.all("a tracker user is a public name and an id")))
  .errors({ ...authErrors, ...directoryErrors })
  .query();

export const listProjectsContract = app
  .procedure()
  .input(wire.object({}))
  .output(wire.array(Project.all("every project field is rendered in the sidebar")))
  .errors({ ...authErrors })
  .query();

// -- the contract value ---------------------------------------------------------

export const appContract = app.contract({
  session: { me: sessionMeContract },
  issues: {
    list: listIssuesContract,
    byId: issueByIdContract,
    create: createIssueContract,
    assign: assignIssueContract,
    close: closeIssueContract,
    activity: issueActivityContract,
  },
  users: { list: listUsersContract },
  projects: { list: listProjectsContract },
});
