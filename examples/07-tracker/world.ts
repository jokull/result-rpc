/**
 * The seeded world shared by the test suite and the browser dev server —
 * one source of truth for the demo data.
 */
import type { ActivityEvent } from "./models.js";
import type { IssueRow, TrackerDb } from "./server.js";

export const CLOSED_AT = new Date("2026-07-01T12:00:00.000Z");

export function seedDb(): TrackerDb {
  const activity: ActivityEvent[] = [
    {
      id: "act-1",
      issueId: "issue-1",
      message: "created by alice",
      at: new Date("2026-07-10T09:00:00Z"),
    },
    {
      id: "act-2",
      issueId: "issue-1",
      message: "assigned to bob",
      at: new Date("2026-07-10T10:00:00Z"),
    },
  ];
  return {
    users: new Map([
      ["user-alice", { id: "user-alice", name: "Alice" }],
      ["user-bob", { id: "user-bob", name: "Bob" }],
    ]),
    projects: new Map([
      ["proj-main", { id: "proj-main", name: "Main App", openCount: 1 }],
      ["proj-secret", { id: "proj-secret", name: "Skunkworks", openCount: 1 }],
    ]),
    issues: new Map([
      [
        "issue-1",
        {
          id: "issue-1",
          projectId: "proj-main",
          title: "Fix login bug",
          status: "open",
          assigneeId: "user-bob",
          closedAt: null,
        } satisfies IssueRow,
      ],
      [
        "issue-2",
        {
          id: "issue-2",
          projectId: "proj-main",
          title: "Archive old docs",
          status: "closed",
          assigneeId: "user-alice",
          closedAt: CLOSED_AT,
        } satisfies IssueRow,
      ],
      [
        "issue-3",
        {
          id: "issue-3",
          projectId: "proj-secret",
          title: "Top secret",
          status: "open",
          assigneeId: null,
          closedAt: null,
        } satisfies IssueRow,
      ],
    ]),
    activity: new Map([["issue-1", activity]]),
  };
}
