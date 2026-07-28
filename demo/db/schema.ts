export const createTicketsTableSql = `
  CREATE TABLE IF NOT EXISTS tickets (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'in_progress', 'done')),
    priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    assignee TEXT,
    labels_json TEXT NOT NULL,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, id),
    UNIQUE (workspace_id, number)
  )
`;

export const createTicketsFeedIndexSql = `
  CREATE INDEX IF NOT EXISTS tickets_feed_idx
  ON tickets (workspace_id, status, updated_at DESC, id DESC)
`;

export const createTicketsSearchIndexSql = `
  CREATE INDEX IF NOT EXISTS tickets_search_idx
  ON tickets (workspace_id, title)
`;
