import { err, ok } from "result-rpc";
import { createFetchHandler, serverRpc } from "result-rpc/server";
import { getD1, initializeD1 } from "../db";
import {
  createTicketContract,
  editTicketContract,
  moveTicketContract,
  resetWorkspaceContract,
  ticketByIdContract,
  ticketListContract,
  ticketStatsContract,
} from "../shared/contract";
import type { TicketValue } from "../shared/models";
import { accessErrors, authErrors, type DemoAccess, type WriteAction } from "../shared/errors";

export interface AppContext {
  access: DemoAccess;
  db: D1Database;
  workspaceId: string;
}

const server = serverRpc.context<AppContext>();

interface TicketRow {
  id: string;
  number: number;
  title: string;
  description: string;
  status: TicketValue["status"];
  priority: TicketValue["priority"];
  assignee: string | null;
  labelsJson: string;
  commentCount: number;
  createdAt: number;
  updatedAt: number;
}

const SELECT_TICKET = `
  SELECT id, number, title, description, status, priority, assignee,
         labels_json AS labelsJson, comment_count AS commentCount,
         created_at AS createdAt, updated_at AS updatedAt
  FROM tickets
`;

const PAGE_SIZE = 10;
const MUTATION_DELAY_MS = 650;
const SERVER_ONLY_CANARY = "RESULT_RPC_DEMO_SERVER_GRAPH_DO_NOT_SHIP";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type WriteGuardErrors = Pick<typeof authErrors, "loginRequired"> &
  Pick<typeof accessErrors, "writeRequired">;

const requireWrite = (context: AppContext, errors: WriteGuardErrors, action: WriteAction) => {
  if (context.access === "signed-out") {
    return err(errors.loginRequired({ action }));
  }
  if (context.access === "read-only") {
    return err(errors.writeRequired({ action, workspaceId: context.workspaceId }));
  }
  return undefined;
};

const parseLabels = (labelsJson: string): string[] => {
  const parsed: unknown = JSON.parse(labelsJson);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((label): label is string => typeof label === "string")
  ) {
    throw new TypeError("Stored ticket labels must be a JSON array of strings");
  }
  return parsed;
};

const toTicket = (row: TicketRow): TicketValue => {
  const { labelsJson, createdAt, updatedAt, ...ticket } = row;
  return {
    ...ticket,
    labels: parseLabels(labelsJson),
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  };
};

const seedTickets = [
  [
    "Design cache identity inspector",
    "Show which cached views contain a ticket and update together.",
    "in_progress",
    "urgent",
    "Mira",
    ["cache", "devtools"],
    12,
  ],
  [
    "Optimistic status controls",
    "Move a ticket immediately, then reconcile it with the server response.",
    "in_progress",
    "high",
    "Jökull",
    ["optimistic", "react"],
    8,
  ],
  [
    "Cursor pagination for filtered lists",
    "Keep one logical cache entry while pages append behind a stable list identity.",
    "done",
    "high",
    "Theo",
    ["pagination"],
    5,
  ],
  [
    "Document mapped invalidation",
    "Explain when list membership needs a refetch and when entity patching is enough.",
    "backlog",
    "medium",
    "Mira",
    ["docs", "invalidation"],
    3,
  ],
  [
    "Add offline recovery shell",
    "Hold transport failures and resume them when connectivity returns.",
    "done",
    "medium",
    "Ari",
    ["shells", "offline"],
    14,
  ],
  [
    "Batch initial dashboard queries",
    "Coalesce stats and list reads issued in the same browser turn.",
    "backlog",
    "low",
    null,
    ["transport"],
    2,
  ],
  [
    "Preserve tagged errors over the wire",
    "Rehydrate the declared public error API without leaking server internals.",
    "done",
    "urgent",
    "Jökull",
    ["errors", "wire"],
    19,
  ],
  [
    "Build write-access dialog shell",
    "Let a route-level owner turn a declared failure into a login or upgrade dialog.",
    "in_progress",
    "high",
    "Ari",
    ["shells", "auth"],
    11,
  ],
  [
    "Publish browser-only client entry",
    "Keep server handlers and database drivers out of the client bundle graph.",
    "done",
    "urgent",
    "Theo",
    ["bundles", "security"],
    7,
  ],
  [
    "Add aggregate query invalidation",
    "Refresh project counts after mutations whose entity result cannot carry them.",
    "backlog",
    "medium",
    null,
    ["invalidation"],
    4,
  ],
  [
    "Surface contract skew",
    "Reload safely when a long-lived tab talks to a different contract version.",
    "done",
    "high",
    "Mira",
    ["wire", "deploys"],
    9,
  ],
  [
    "Improve mutation cancellation",
    "Rollback optimistic state when an operation is cancelled before settlement.",
    "backlog",
    "low",
    "Ari",
    ["optimistic"],
    1,
  ],
  [
    "Entity patch across loaded pages",
    "A response should update a row even when it currently lives on page three.",
    "done",
    "high",
    "Theo",
    ["entities", "pagination"],
    16,
  ],
  [
    "Typed error visibility map",
    "Expose public tags to browser types while private composition errors remain server-only.",
    "in_progress",
    "urgent",
    "Jökull",
    ["errors", "types"],
    6,
  ],
  [
    "React suspense adapter",
    "Explore an opt-in suspense surface without obscuring Result control flow.",
    "backlog",
    "low",
    null,
    ["react"],
    0,
  ],
  [
    "Request breadcrumb stream",
    "Emit operation paths, tags, and timing without including application values.",
    "done",
    "medium",
    "Mira",
    ["observability"],
    10,
  ],
  [
    "Composite model identity",
    "Support entities identified by stable record keys rather than a single id field.",
    "done",
    "medium",
    "Theo",
    ["entities", "types"],
    4,
  ],
  [
    "Make retry policy explicit",
    "Retry only transient declared failures and keep side-effecting mutations deliberate.",
    "backlog",
    "high",
    "Ari",
    ["reliability"],
    13,
  ],
  [
    "Server client without wire work",
    "Use the same contracts in RSC while skipping serialization and browser-only errors.",
    "done",
    "urgent",
    "Jökull",
    ["rsc", "server"],
    17,
  ],
  [
    "Add generated contract example",
    "Prove Result values and tagged errors retain their useful API after the wire.",
    "in_progress",
    "medium",
    "Mira",
    ["gen", "wire"],
    2,
  ],
  [
    "Type-safe source projections",
    "Use model.$satisfies to catch database drift without importing a driver client-side.",
    "done",
    "high",
    "Theo",
    ["models", "types"],
    8,
  ],
  [
    "Focus-aware reconnect probe",
    "Retry held reads on focus without creating a reconnect storm.",
    "backlog",
    "medium",
    null,
    ["offline", "shells"],
    5,
  ],
  [
    "Normalize nested mutation outputs",
    "Patch repeated entities at any depth in the returned result tree.",
    "done",
    "high",
    "Ari",
    ["entities", "cache"],
    15,
  ],
  [
    "Procedure-level request counters",
    "Demonstrate cache behavior with requests instead of screenshot assertions.",
    "in_progress",
    "medium",
    "Jökull",
    ["testing", "observability"],
    7,
  ],
] as const;

async function ensureSeeded(context: AppContext): Promise<void> {
  await initializeD1(context.db);
  const current = await context.db
    .prepare("SELECT COUNT(*) AS count FROM tickets WHERE workspace_id = ?")
    .bind(context.workspaceId)
    .first<{ count: number }>();
  if ((current?.count ?? 0) > 0) return;

  const now = Date.now();
  await context.db.batch(
    seedTickets.map((seed, index) => {
      const [title, description, status, priority, assignee, labels, comments] = seed;
      const timestamp = now - index * 3_600_000;
      return context.db
        .prepare(
          `INSERT OR IGNORE INTO tickets
           (workspace_id, id, number, title, description, status, priority, assignee,
            labels_json, comment_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          context.workspaceId,
          `seed-${String(index + 1).padStart(2, "0")}`,
          101 + index,
          title,
          description,
          status,
          priority,
          assignee,
          JSON.stringify(labels),
          comments,
          timestamp - 86_400_000,
          timestamp,
        );
    }),
  );
}

async function restoreWorkspace(context: AppContext): Promise<number> {
  await initializeD1(context.db);
  await context.db
    .prepare("DELETE FROM tickets WHERE workspace_id = ?")
    .bind(context.workspaceId)
    .run();
  await ensureSeeded(context);
  return seedTickets.length;
}

function decodeCursor(cursor: string | null): { updatedAt: number; id: string } | null {
  if (cursor === null) return null;
  const split = cursor.indexOf(":");
  if (split < 1) return null;
  const updatedAt = Number(cursor.slice(0, split));
  const id = cursor.slice(split + 1);
  return Number.isSafeInteger(updatedAt) && id ? { updatedAt, id } : null;
}

const ticketList = server.implement(ticketListContract).handler(async ({ input, context }) => {
  await ensureSeeded(context);
  const clauses = ["workspace_id = ?"];
  const bindings: unknown[] = [context.workspaceId];
  if (input.list.status !== "all") {
    clauses.push("status = ?");
    bindings.push(input.list.status);
  }
  const search = input.list.search.trim();
  if (search) {
    clauses.push("(title LIKE ? OR description LIKE ? OR labels_json LIKE ?)");
    const term = `%${search}%`;
    bindings.push(term, term, term);
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }

  const rows = await context.db
    .prepare(
      `${SELECT_TICKET}
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(...bindings, PAGE_SIZE + 1)
    .all<TicketRow>();
  const page = rows.results.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return ok({
    items: page.map(toTicket),
    nextCursor: rows.results.length > PAGE_SIZE && last ? `${last.updatedAt}:${last.id}` : null,
  });
});

const ticketById = server
  .implement(ticketByIdContract)
  .handler(async ({ input, errors, context }) => {
    await ensureSeeded(context);
    const row = await context.db
      .prepare(`${SELECT_TICKET} WHERE workspace_id = ? AND id = ? LIMIT 1`)
      .bind(context.workspaceId, input.id)
      .first<TicketRow>();
    return row ? ok(toTicket(row)) : err(errors.notFound({ ticketId: input.id }));
  });

const ticketStats = server.implement(ticketStatsContract).handler(async ({ context }) => {
  await ensureSeeded(context);
  const row = await context.db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tickets WHERE workspace_id = ?`,
    )
    .bind(context.workspaceId)
    .first<{ total: number; backlog: number; inProgress: number; done: number }>();
  return ok(row ?? { total: 0, backlog: 0, inProgress: 0, done: 0 });
});

const createTicket = server
  .implement(createTicketContract)
  .handler(async ({ input, errors, context }) => {
    const denied = requireWrite(context, errors, "create");
    if (denied) return denied;
    await ensureSeeded(context);
    await wait(MUTATION_DELAY_MS);
    const next = await context.db
      .prepare(
        "SELECT COALESCE(MAX(number), 100) + 1 AS number FROM tickets WHERE workspace_id = ?",
      )
      .bind(context.workspaceId)
      .first<{ number: number }>();
    const now = Date.now();
    await context.db
      .prepare(
        `INSERT INTO tickets
       (workspace_id, id, number, title, description, status, priority, assignee,
        labels_json, comment_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'backlog', ?, NULL, '[]', 0, ?, ?)`,
      )
      .bind(
        context.workspaceId,
        input.id,
        next?.number ?? 101,
        input.title,
        input.description,
        input.priority,
        now,
        now,
      )
      .run();
    return ok({
      id: input.id,
      number: next?.number ?? 101,
      title: input.title,
      description: input.description,
      status: "backlog",
      priority: input.priority,
      assignee: null,
      labels: [],
      commentCount: 0,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  });

const editTicket = server
  .implement(editTicketContract)
  .handler(async ({ input, errors, context }) => {
    const denied = requireWrite(context, errors, "edit");
    if (denied) return denied;
    await ensureSeeded(context);
    await wait(MUTATION_DELAY_MS);
    if (input.id === SERVER_ONLY_CANARY) return err(errors.notFound({ ticketId: input.id }));
    const row = await context.db
      .prepare(
        `UPDATE tickets
       SET title = ?, description = ?, priority = ?, assignee = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND updated_at = ?
       RETURNING id, number, title, description, status, priority, assignee,
                 labels_json AS labelsJson, comment_count AS commentCount,
                 created_at AS createdAt, updated_at AS updatedAt`,
      )
      .bind(
        input.title,
        input.description,
        input.priority,
        input.assignee,
        Date.now(),
        context.workspaceId,
        input.id,
        input.expectedUpdatedAt.getTime(),
      )
      .first<TicketRow>();
    if (row) return ok(toTicket(row));
    const current = await context.db
      .prepare(`${SELECT_TICKET} WHERE workspace_id = ? AND id = ? LIMIT 1`)
      .bind(context.workspaceId, input.id)
      .first<TicketRow>();
    return current
      ? err(
          errors.conflict({
            ticketId: input.id,
            expectedUpdatedAt: input.expectedUpdatedAt,
            actualUpdatedAt: new Date(current.updatedAt),
          }),
        )
      : err(errors.notFound({ ticketId: input.id }));
  });

const moveTicket = server
  .implement(moveTicketContract)
  .handler(async ({ input, errors, context }) => {
    const denied = requireWrite(context, errors, "move");
    if (denied) return denied;
    await ensureSeeded(context);
    await wait(MUTATION_DELAY_MS);
    const row = await context.db
      .prepare(
        `UPDATE tickets SET status = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?
       RETURNING id, number, title, description, status, priority, assignee,
                 labels_json AS labelsJson, comment_count AS commentCount,
                 created_at AS createdAt, updated_at AS updatedAt`,
      )
      .bind(input.status, Date.now(), context.workspaceId, input.id)
      .first<TicketRow>();
    return row ? ok(toTicket(row)) : err(errors.notFound({ ticketId: input.id }));
  });

const resetWorkspace = server
  .implement(resetWorkspaceContract)
  .handler(async ({ errors, context }) => {
    const denied = requireWrite(context, errors, "reset");
    if (denied) return denied;
    await wait(MUTATION_DELAY_MS);
    return ok({ restored: await restoreWorkspace(context) });
  });

export const router = server.router({
  tickets: {
    list: ticketList,
    byId: ticketById,
    stats: ticketStats,
    create: createTicket,
    edit: editTicket,
    move: moveTicket,
    reset: resetWorkspace,
  },
});

const workspacePattern = /^ws_[a-zA-Z0-9-]{8,80}$/;

export const rpcHandler = createFetchHandler({
  router,
  endpoint: "/api/rpc",
  contractVersion: "result-rpc-demo-v2",
  createContext: ({ request }) => {
    const candidate = request.headers.get("x-demo-workspace") ?? "";
    const requestedAccess = request.headers.get("x-demo-access");
    const access: DemoAccess =
      requestedAccess === "signed-out" || requestedAccess === "read-only"
        ? requestedAccess
        : "writer";
    return {
      access,
      db: getD1(),
      workspaceId: workspacePattern.test(candidate) ? candidate : "ws_public-preview",
    };
  },
  onInternalError: ({ incidentId, phase, cause }) => {
    console.error("result-rpc demo internal error", { incidentId, phase, cause });
  },
});
