/**
 * Rung 7: a team issue tracker.
 *
 * The onion: ResultRpcProvider > BoundaryProvider (transport/defect/stale) >
 * ViewerShell (session layer). Components under the viewer shell see only
 * their own domain errors, and the flagship behavior is entity identity: the
 * assign mutation returns the Issue, and every cached view of that issue is
 * patched in place with zero refetches.
 */
import { useState } from "react";
import { errorCatalog, matchError, type InputOf } from "../../src/index.js";
import {
  boundaryShells,
  layerShell,
  ResultRpcProvider,
  useResultClient,
} from "../../src/react/index.js";
import type { AppClient } from "./client.js";
import { SessionLayer } from "./contract.js";
import { issueErrors, projectErrors } from "./errors.js";
import { Issue } from "./models.js";
import { createIssueSchema, schemaFieldIssues } from "./schema.js";

type IssueView = InputOf<typeof Issue.codec>;

// -- shells ---------------------------------------------------------------------

export const { TransportShell, DefectShell, StaleShell, BoundaryProvider, useConnectivity } =
  boundaryShells({ name: "tracker" });

/** A real app redirects to /login here; tests observe the counter. */
export const signInReactions = { count: 0 };

export const ViewerShell = layerShell(SessionLayer, {
  from: StaleShell,
  procedure: (client: AppClient) => client.session.me,
  onError: () => {
    signInReactions.count += 1;
  },
});

// -- connectivity banner ----------------------------------------------------------

export function ConnectionBanner() {
  const net = useConnectivity();
  switch (net.status) {
    case "online":
      return null;
    case "offline":
      return <div role="alert">You're offline — paused work resumes automatically.</div>;
    case "degraded":
      return (
        <div role="alert">
          Connection trouble ({net.held} waiting)
          <button onClick={net.resume}>Retry now</button>
        </div>
      );
  }
}

// -- the viewer, no null checks ----------------------------------------------------

export function Header() {
  const viewer = ViewerShell.use();
  return <h1>Signed in as {viewer.name}</h1>;
}

/** Resolves an assignee id to a display name through the cached people query. */
function useUserName(id: string | null): string {
  const client = useResultClient<AppClient>();
  const people = ViewerShell.useQuery(client.users.list, {});
  if (id === null) return "unassigned";
  if (people.state !== "success") return id;
  return people.value.find((user) => user.id === id)?.name ?? id;
}

// -- issue list --------------------------------------------------------------------

export function IssueList() {
  const client = useResultClient<AppClient>();
  const issues = ViewerShell.useQuery(client.issues.list, {});

  switch (issues.state) {
    case "pending":
      return <p>Loading issues…</p>;
    case "success":
      return (
        <ul>
          {issues.value.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
      );
    case "failure":
      // transport, defect, stale, and auth tags are all claimed above;
      // nothing domain remains on `list`.
      return issues.error satisfies never;
  }
}

function IssueRow({ issue }: { issue: IssueView }) {
  const assignee = useUserName(issue.assigneeId);
  return (
    <li>
      {issue.title} · {issue.status} · {assignee}
    </li>
  );
}

// -- issue detail with a domain-error catalog ---------------------------------------

const issueFailureMessage = errorCatalog(
  { notFound: issueErrors.notFound, forbidden: projectErrors.forbidden },
  {
    "issue/not-found": (error) => `Issue ${error.data.issueId} was not found.`,
    "project/forbidden": (error) =>
      `You do not have access to project ${error.data.projectId}.`,
  },
);

export function IssueDetail({ id }: { id: string }) {
  const client = useResultClient<AppClient>();
  const issue = ViewerShell.useQuery(client.issues.byId, { id });
  const assignee = useUserName(issue.state === "success" ? issue.value.assigneeId : null);

  switch (issue.state) {
    case "pending":
      return issue.fetch === "paused" ? (
        <p>Waiting for a connection…</p>
      ) : (
        <p>Loading issue…</p>
      );
    case "success":
      return (
        <article>
          <h2>{issue.value.title}</h2>
          <p>
            Status: {issue.value.status}. Assignee: {assignee}.
          </p>
          <AssignControls issue={issue.value} />
          <CloseButton issueId={issue.value.id} />
        </article>
      );
    case "failure":
      return <p role="alert">{issueFailureMessage(issue.error)}</p>;
  }
}

const assignMessages = errorCatalog(
  { notFound: issueErrors.notFound, closed: issueErrors.closed },
  {
    "issue/not-found": () => "This issue no longer exists.",
    "issue/closed": (failure) =>
      `This issue was closed at ${failure.data.closedAt.toISOString()} — reopen it to change the assignee.`,
  },
);

export function AssignControls({ issue }: { issue: IssueView }) {
  const client = useResultClient<AppClient>();
  const people = ViewerShell.useQuery(client.users.list, {});
  const assign = ViewerShell.useMutation(client.issues.assign);

  switch (people.state) {
    case "pending":
      return <p>Loading people…</p>;
    case "failure":
      return (
        <p role="alert">
          {matchError(people.error, {
            "directory/unavailable": () =>
              "The people directory is unavailable right now.",
          })}
        </p>
      );
    case "success":
      return (
        <div>
          <label>
            Assignee
            <select
              value={issue.assigneeId ?? ""}
              onChange={(event) =>
                void assign
                  .mutate({ issueId: issue.id, assigneeId: event.target.value })
                  .catch(() => undefined)
              }
            >
              <option value="" disabled>
                Unassigned
              </option>
              {people.value.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          {assign.state === "failure" && (
            <p role="alert">{assignMessages(assign.error)}</p>
          )}
        </div>
      );
  }
}

export function CloseButton({ issueId }: { issueId: string }) {
  const client = useResultClient<AppClient>();
  const close = ViewerShell.useMutation(client.issues.close);
  return (
    <div>
      <button onClick={() => void close.mutate({ issueId }).catch(() => undefined)}>
        Close issue
      </button>
      {close.state === "failure" && (
        <p role="alert">
          {matchError(close.error, {
            "issue/not-found": () => "This issue no longer exists.",
          })}
        </p>
      )}
    </div>
  );
}

// -- projects panel (updated by the create/close cascades' touch) ---------------------

export function ProjectsPanel() {
  const client = useResultClient<AppClient>();
  const projects = ViewerShell.useQuery(client.projects.list, {});

  switch (projects.state) {
    case "pending":
      return <p>Loading projects…</p>;
    case "success":
      return (
        <ul>
          {projects.value.map((project) => (
            <li key={project.id}>
              {project.name} — {project.openCount} open
            </li>
          ))}
        </ul>
      );
    case "failure":
      return projects.error satisfies never;
  }
}

// -- activity feed (subscription) -----------------------------------------------------

export function ActivityFeed({ issueId }: { issueId: string }) {
  const client = useResultClient<AppClient>();
  const feed = ViewerShell.useSubscription(client.issues.activity, { issueId });

  return (
    <section>
      {feed.result === undefined ? (
        <p>No activity yet.</p>
      ) : feed.result.ok ? (
        <p>Latest activity: {feed.result.value.message}</p>
      ) : (
        <p role="alert">
          {matchError(feed.result.error, {
            "issue/not-found": () => "No activity: this issue does not exist.",
          })}
        </p>
      )}
      {feed.connection === "closed" ? <p>Activity feed ended.</p> : null}
    </section>
  );
}

// -- optimistic create form -----------------------------------------------------------
//
// The form validates the human with the SAME Standard Schema the wire uses —
// per-field feedback before the request exists. The mutation therefore only
// ever carries schema-valid input; a server/bad-request after that would be a
// genuinely broken request, and escalating it through the DefectShell above
// is the correct reaction. The optimistic issue is born under its final,
// client-minted identity, so success is a no-op patch — nothing re-keys.

let issueCounter = 0;
export const mintIssueId = () => `iss_${++issueCounter}`;

export function NewIssueForm() {
  const client = useResultClient<AppClient>();
  const [title, setTitle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, readonly string[]>>({});

  const create = ViewerShell.useMutation(client.issues.create, {
    optimistic: (input, cache) => ({
      rollback: cache.update(client.issues.list, {}, (issues) =>
        issues && [
          ...issues,
          {
            id: input.id,
            projectId: "proj-main",
            title: input.title,
            status: "open" as const,
            assigneeId: null,
            closedAt: null,
          },
        ],
      ),
    }),
    onFailure: (_error, _input, context) => context?.rollback(),
    onCancel: (_input, context) => context?.rollback(),
  });

  async function submit() {
    const validated = createIssueSchema["~standard"].validate({
      id: mintIssueId(),
      title,
    });
    if (validated instanceof Promise) throw new TypeError("schema must be synchronous");
    if (validated.issues) {
      setFieldErrors(schemaFieldIssues(validated.issues));
      return;
    }
    setFieldErrors({});
    try {
      const result = await create.mutate(validated.value);
      if (result.ok) setTitle("");
    } catch {
      // claimed/cancelled are control flow: the owning shell already reacted
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        Title
        <input
          value={title}
          onChange={(event: { target: { value: string } }) => setTitle(event.target.value)}
        />
      </label>
      <button type="submit">Create issue</button>
      {create.state === "pending" ? <p>Creating…</p> : null}
      {fieldErrors["title"] ? <p role="alert">{fieldErrors["title"].join("; ")}</p> : null}
      {create.state === "failure" && (
        <p role="alert">
          {matchError(create.error, {
            "issue/title-taken": (failure) => `"${failure.data.title}" already exists.`,
          })}
        </p>
      )}
    </form>
  );
}

// -- the app --------------------------------------------------------------------------

export function Tracker({ detailId }: { detailId: string }) {
  return (
    <main>
      <Header />
      <ProjectsPanel />
      <IssueList />
      <IssueDetail id={detailId} />
      <ActivityFeed issueId={detailId} />
      <NewIssueForm />
    </main>
  );
}

export function App({ client, detailId = "issue-1" }: { client: AppClient; detailId?: string }) {
  return (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <ConnectionBanner />
        <ViewerShell.Provider fallback={<p>Signing you in…</p>}>
          <Tracker detailId={detailId} />
        </ViewerShell.Provider>
      </BoundaryProvider>
    </ResultRpcProvider>
  );
}
