"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type { ClientEvent } from "result-rpc/client";
import {
  boundaryShells,
  ResultRpcProvider,
  useResultClient,
  useResultMutation,
  useResultPaginatedQuery,
  useResultQuery,
} from "result-rpc/react";
import { makeClient, type AppClient } from "../client/rpc-client";
import { Ticket, type TicketValue } from "../shared/models";

type Status = TicketValue["status"];
type Priority = TicketValue["priority"];
type Filter = "all" | Status;

const statusLabels: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

const priorityLabels: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const people = ["Jökull", "Mira", "Theo", "Ari"] as const;
const { BoundaryProvider, useConnectivity } = boundaryShells({ name: "demo" });

interface TimelineEvent {
  id: number;
  event: ClientEvent;
  at: Date;
}

interface Proof {
  kind: "idle" | "entity" | "invalidation" | "pagination" | "reset";
  title: string;
  detail: string;
}

const initialProof: Proof = {
  kind: "idle",
  title: "The cache is live",
  detail:
    "Open a ticket and change its priority. The row and detail patch before the request settles.",
};

function workspaceToken(): string {
  const existing = localStorage.getItem("result-rpc-demo-workspace");
  if (existing) return existing;
  const token = `ws_${crypto.randomUUID()}`;
  localStorage.setItem("result-rpc-demo-workspace", token);
  return token;
}

export function TicketDemo() {
  const workspace = useSyncExternalStore(
    () => () => undefined,
    workspaceToken,
    () => undefined,
  );
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [proof, setProof] = useState<Proof>(initialProof);

  const onEvent = useCallback((event: ClientEvent) => {
    setTimeline((current) =>
      [{ id: Date.now() + Math.random(), event, at: new Date() }, ...current].slice(0, 14),
    );
  }, []);

  const client = useMemo(
    () => (workspace ? makeClient(workspace, onEvent) : undefined),
    [onEvent, workspace],
  );

  if (!client || !workspace) return <AppSkeleton />;

  return (
    <ResultRpcProvider client={client}>
      <BoundaryProvider>
        <Workspace timeline={timeline} proof={proof} setProof={setProof} workspace={workspace} />
      </BoundaryProvider>
    </ResultRpcProvider>
  );
}

function Workspace({
  timeline,
  proof,
  setProof,
  workspace,
}: {
  timeline: TimelineEvent[];
  proof: Proof;
  setProof: (proof: Proof) => void;
  workspace: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(true);
  const deferredSearch = useDeferredValue(search);
  const client = useResultClient<AppClient>();
  const stats = useResultQuery(client.tickets.stats, {}, { staleTime: 60_000 });
  const tickets = useResultPaginatedQuery(
    client.tickets.list,
    { status: filter, search: deferredSearch },
    { staleTime: 60_000 },
  );

  const visibleSelectedId =
    tickets.state === "success" && tickets.rows.length > 0
      ? tickets.rows.some((ticket) => ticket.id === selectedId)
        ? selectedId
        : tickets.rows[0]?.id
      : selectedId;

  const counts =
    stats.state === "success" ? stats.value : { total: 0, backlog: 0, inProgress: 0, done: 0 };

  return (
    <main className="app-shell">
      <ConnectionBanner />
      <header className="topbar">
        <a className="brand" href="https://result-rpc.com" aria-label="result-rpc documentation">
          <span className="brand-mark">R</span>
          <span className="brand-name">result-rpc</span>
          <span className="demo-pill">DEMO</span>
        </a>
        <div className="topbar-actions">
          <span className="live-state">
            <i /> D1 workspace live
          </span>
          <a href="https://result-rpc.com/getting-started" className="text-link">
            Docs
          </a>
          <a href="https://github.com/jokull/result-rpc/tree/main/demo" className="text-link">
            Source ↗
          </a>
          <button className="primary-button" onClick={() => setCreateOpen(true)}>
            <span>＋</span> New ticket
          </button>
        </div>
      </header>

      <div className={`workspace-grid ${proofOpen ? "proof-visible" : ""}`}>
        <Sidebar
          counts={counts}
          filter={filter}
          onFilter={(next) => startTransition(() => setFilter(next))}
          onProof={() => setProofOpen((open) => !open)}
          proofOpen={proofOpen}
        />

        <section className="ticket-column" aria-label="Ticket list">
          <div className="list-toolbar">
            <div>
              <p className="eyebrow">PRODUCT / ALL ISSUES</p>
              <h1>{filter === "all" ? "All tickets" : statusLabels[filter]}</h1>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search tickets"
                placeholder="Search tickets…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>/</kbd>
            </label>
          </div>

          <div className="list-meta">
            <span>
              {tickets.state === "success" ? `${tickets.rows.length} loaded` : "Loading workspace"}
            </span>
            <span className="list-mode">cursor paginated · newest first</span>
          </div>

          <TicketList
            state={tickets}
            selectedId={visibleSelectedId}
            onSelect={setSelectedId}
            onPagination={() =>
              setProof({
                kind: "pagination",
                title: "One list, another page",
                detail:
                  "The cursor is transport state, not list identity. New rows append to the same cache entry.",
              })
            }
          />
        </section>

        <section className="detail-column" aria-label="Ticket detail">
          {visibleSelectedId ? (
            <TicketDetail id={visibleSelectedId} setProof={setProof} />
          ) : (
            <EmptyDetail />
          )}
        </section>

        {proofOpen && (
          <ProofPanel
            proof={proof}
            timeline={timeline}
            workspace={workspace}
            onClose={() => setProofOpen(false)}
            onReset={() =>
              setProof({
                kind: "reset",
                title: "Workspace restored",
                detail:
                  "The mutation invalidated the list and aggregate; active queries converged from D1.",
              })
            }
          />
        )}
      </div>

      {createOpen && (
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setProof({
              kind: "invalidation",
              title: "Membership invalidated",
              detail:
                "A new entity may belong on any cached page, so the contract honestly invalidates the list and stats.",
            });
          }}
        />
      )}
    </main>
  );
}

function Sidebar({
  counts,
  filter,
  onFilter,
  onProof,
  proofOpen,
}: {
  counts: { total: number; backlog: number; inProgress: number; done: number };
  filter: Filter;
  onFilter: (filter: Filter) => void;
  onProof: () => void;
  proofOpen: boolean;
}) {
  const items: { value: Filter; label: string; count: number; symbol: string }[] = [
    { value: "all", label: "All tickets", count: counts.total, symbol: "◇" },
    { value: "backlog", label: "Backlog", count: counts.backlog, symbol: "○" },
    { value: "in_progress", label: "In progress", count: counts.inProgress, symbol: "◐" },
    { value: "done", label: "Done", count: counts.done, symbol: "●" },
  ];
  return (
    <aside className="sidebar">
      <div className="team-switcher">
        <span className="team-avatar">RR</span>
        <span>
          <strong>result-rpc</strong>
          <small>Product</small>
        </span>
        <span className="chevron">⌄</span>
      </div>
      <nav aria-label="Ticket views">
        <p className="nav-label">WORKSPACE</p>
        {items.map((item) => (
          <button
            key={item.value}
            className={`nav-item ${filter === item.value ? "active" : ""}`}
            onClick={() => onFilter(item.value)}
          >
            <span className={`status-symbol status-${item.value}`}>{item.symbol}</span>
            <span>{item.label}</span>
            <small>{item.count}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-section">
        <p className="nav-label">TECHNOLOGY</p>
        <div className="tech-item">
          <span>↯</span> Optimistic cache
        </div>
        <div className="tech-item">
          <span>◎</span> Entity identity
        </div>
        <div className="tech-item">
          <span>⇄</span> Typed wire
        </div>
      </div>
      <button className={`proof-toggle ${proofOpen ? "active" : ""}`} onClick={onProof}>
        <span>⌁</span>
        <span>
          <strong>Proof panel</strong>
          <small>See the cache work</small>
        </span>
      </button>
      <p className="sidebar-note">Your edits are isolated in a durable anonymous workspace.</p>
    </aside>
  );
}

type TicketListState = ReturnType<typeof useResultPaginatedQuery<AppClient["tickets"]["list"]>>;

function TicketList({
  state,
  selectedId,
  onSelect,
  onPagination,
}: {
  state: TicketListState;
  selectedId?: string;
  onSelect: (id: string) => void;
  onPagination: () => void;
}) {
  if (state.state === "pending") return <TicketListSkeleton />;
  if (state.state === "failure") return <div className="list-empty">Could not load tickets.</div>;
  if (state.rows.length === 0) return <div className="list-empty">No tickets match this view.</div>;
  return (
    <div className="ticket-scroll">
      <ul className="ticket-list">
        {state.rows.map((ticket) => (
          <li key={ticket.id}>
            <button
              className={`ticket-row ${selectedId === ticket.id ? "selected" : ""}`}
              onClick={() => onSelect(ticket.id)}
            >
              <span
                className={`row-status ${ticket.status}`}
                aria-label={statusLabels[ticket.status]}
              />
              <span className="row-main">
                <span className="row-title">{ticket.title}</span>
                <span className="row-labels">
                  {ticket.labels.slice(0, 2).map((label) => (
                    <em key={label}>{label}</em>
                  ))}
                </span>
              </span>
              <span className="row-assignee">{ticket.assignee?.slice(0, 1) ?? "–"}</span>
              <span className={`priority priority-${ticket.priority}`}>
                {priorityGlyph(ticket.priority)}
              </span>
              <span className="row-comments">◌ {ticket.commentCount}</span>
              <span className="row-id">RR-{ticket.number}</span>
            </button>
          </li>
        ))}
      </ul>
      {state.hasNext && (
        <button
          className="load-more"
          disabled={state.fetchingNext}
          onClick={() => {
            onPagination();
            void state.fetchNext();
          }}
        >
          {state.fetchingNext ? "Loading next page…" : "Load next page"}
          <span>
            {state.pageCount} page{state.pageCount === 1 ? "" : "s"} cached
          </span>
        </button>
      )}
    </div>
  );
}

function TicketDetail({ id, setProof }: { id: string; setProof: (proof: Proof) => void }) {
  const client = useResultClient<AppClient>();
  const query = useResultQuery(client.tickets.byId, { id }, { staleTime: 60_000 });
  if (query.state === "pending") return <DetailSkeleton />;
  if (query.state === "failure")
    return <div className="detail-empty">This ticket no longer exists.</div>;
  return <TicketEditor key={query.value.id} ticket={query.value} setProof={setProof} />;
}

function TicketEditor({
  ticket,
  setProof,
}: {
  ticket: TicketValue;
  setProof: (proof: Proof) => void;
}) {
  const client = useResultClient<AppClient>();
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);

  const edit = useResultMutation(client.tickets.edit, {
    optimistic: (input, cache) => ({
      rollback: cache.updateEntity(Ticket, input.id, (current) => ({
        ...current,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assignee: input.assignee,
        updatedAt: new Date(),
      })),
    }),
    onFailure: (_error, _input, context) => context?.rollback(),
    onCancel: (_input, context) => context?.rollback(),
  });

  const move = useResultMutation(client.tickets.move, {
    optimistic: (input, cache) => ({
      rollback: cache.updateEntity(Ticket, input.id, (current) => ({
        ...current,
        status: input.status,
        updatedAt: new Date(),
      })),
    }),
    onFailure: (_error, _input, context) => context?.rollback(),
    onCancel: (_input, context) => context?.rollback(),
  });

  const save = (
    patch: Partial<Pick<TicketValue, "title" | "description" | "priority" | "assignee">>,
  ) => {
    const next = {
      id: ticket.id,
      title: patch.title ?? title,
      description: patch.description ?? description,
      priority: patch.priority ?? ticket.priority,
      assignee: patch.assignee === undefined ? ticket.assignee : patch.assignee,
    };
    setProof({
      kind: "entity",
      title: "Patched by identity — instantly",
      detail:
        "The optimistic entity update reaches this detail and its list row. The server response reconciles the same identity with zero query refetches.",
    });
    void edit.mutate(next).catch(() => undefined);
  };

  const changeStatus = (status: Status) => {
    setProof({
      kind: "invalidation",
      title: "Patch now, re-check membership",
      detail:
        "The entity updates immediately. Because status can move it out of this filtered list, .affects() then refetches list membership and stats.",
    });
    void move.mutate({ id: ticket.id, status }).catch(() => undefined);
  };

  return (
    <article className="ticket-detail">
      <div className="detail-head">
        <span className="detail-key">RR-{ticket.number}</span>
        <div className="detail-actions">
          <button aria-label="Copy ticket link">⌁</button>
          <button>•••</button>
        </div>
      </div>
      <input
        className="title-editor"
        aria-label="Ticket title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => title.trim() && title !== ticket.title && save({ title: title.trim() })}
      />
      <textarea
        className="description-editor"
        aria-label="Ticket description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => description !== ticket.description && save({ description })}
      />

      <div className="properties">
        <label>
          <span>Status</span>
          <select
            value={ticket.status}
            onChange={(event) => changeStatus(event.target.value as Status)}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select
            value={ticket.priority}
            onChange={(event) => save({ priority: event.target.value as Priority })}
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Assignee</span>
          <select
            value={ticket.assignee ?? ""}
            onChange={(event) => save({ assignee: event.target.value || null })}
          >
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person}>{person}</option>
            ))}
          </select>
        </label>
        <div className="property-row">
          <span>Labels</span>
          <div>
            {ticket.labels.map((label) => (
              <em key={label}>{label}</em>
            ))}
          </div>
        </div>
      </div>

      <section className="activity">
        <div className="section-title">
          <h2>Activity</h2>
          <span>{ticket.commentCount} updates</span>
        </div>
        <div className="activity-item">
          <span className="avatar">M</span>
          <p>
            <strong>Mira</strong> linked this ticket to the public demo.
            <small>{relativeTime(ticket.updatedAt)}</small>
          </p>
        </div>
        <div className="activity-item">
          <span className="avatar blue">R</span>
          <p>
            <strong>result-rpc</strong> is tracking this entity in every cached view.
            <small>just now</small>
          </p>
        </div>
        <div className="comment-box">
          <span className="avatar">Y</span>
          <span>Leave a comment…</span>
          <kbd>⌘ ↵</kbd>
        </div>
      </section>

      {(edit.state === "pending" || move.state === "pending") && (
        <div className="saving-indicator">
          <i /> reconciling with D1…
        </div>
      )}
    </article>
  );
}

function ProofPanel({
  proof,
  timeline,
  workspace,
  onClose,
  onReset,
}: {
  proof: Proof;
  timeline: TimelineEvent[];
  workspace: string;
  onClose: () => void;
  onReset: () => void;
}) {
  const client = useResultClient<AppClient>();
  const reset = useResultMutation(client.tickets.reset, { onSuccess: onReset });
  const calls = timeline.filter(({ event }) => event.type === "call").length;
  const mutations = timeline.filter(
    ({ event }) => event.type === "call" && event.kind === "mutation",
  ).length;
  return (
    <aside className="proof-panel" aria-label="Cache proof">
      <div className="proof-head">
        <div>
          <p className="eyebrow">LIVE PROOF</p>
          <h2>Watch the protocol</h2>
        </div>
        <button onClick={onClose} aria-label="Close proof panel">
          ×
        </button>
      </div>
      <div className={`proof-card proof-${proof.kind}`}>
        <span className="proof-icon">
          {proof.kind === "entity" ? "◎" : proof.kind === "pagination" ? "⇣" : "↯"}
        </span>
        <div>
          <strong>{proof.title}</strong>
          <p>{proof.detail}</p>
        </div>
      </div>
      <div className="metric-grid">
        <div>
          <strong>{calls}</strong>
          <span>wire calls</span>
        </div>
        <div>
          <strong>{mutations}</strong>
          <span>mutations</span>
        </div>
        <div>
          <strong>
            650<small>ms</small>
          </strong>
          <span>demo latency</span>
        </div>
      </div>
      <div className="timeline-head">
        <span>CLIENT EVENTS</span>
        <small>newest first</small>
      </div>
      <ol className="timeline">
        {timeline.length === 0 ? (
          <li className="timeline-empty">Queries will appear here.</li>
        ) : (
          timeline.map(({ id, event, at }) => (
            <li key={id}>
              <i className={`event-dot event-${event.type}`} />
              <span className="event-copy">
                <strong>{event.type}</strong>
                <code>{"path" in event ? event.path : "contract"}</code>
              </span>
              <time>{at.toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>
            </li>
          ))
        )}
      </ol>
      <div className="proof-code">
        <span>client boundary</span>
        <code>{workspace.slice(0, 18)}…</code>
        <small>Handlers and D1 are absent from the browser graph.</small>
      </div>
      <button
        className="reset-button"
        disabled={reset.state === "pending"}
        onClick={() => void reset.mutate({}).catch(() => undefined)}
      >
        {reset.state === "pending" ? "Restoring…" : "Restore sample tickets"}
      </button>
    </aside>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const client = useResultClient<AppClient>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const create = useResultMutation(client.tickets.create, {
    onSuccess: (ticket) => {
      onCreated(ticket.id);
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void create
      .mutate({
        id: `ticket-${crypto.randomUUID()}`,
        title: title.trim(),
        description: description.trim() || "Created from the result-rpc demo.",
        priority,
      })
      .catch(() => undefined);
  };
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form className="create-dialog" onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <p className="eyebrow">NEW TICKET</p>
            <h2>Add work to the queue</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          Title
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What should happen?"
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Give the team enough context…"
          />
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!title.trim() || create.state === "pending"}>
            {create.state === "pending" ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConnectionBanner() {
  const connection = useConnectivity();
  if (connection.status === "online") return null;
  return (
    <div className="connection-banner" role="alert">
      <span>Connection paused — optimistic work is held safely.</span>
      <button onClick={connection.resume}>Retry now</button>
    </div>
  );
}

function priorityGlyph(priority: Priority) {
  return priority === "urgent"
    ? "!!!"
    : priority === "high"
      ? "▮▮▮"
      : priority === "medium"
        ? "▮▮"
        : "▮";
}

function relativeTime(date: Date) {
  const hours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));
  return hours < 1 ? "moments ago" : hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function AppSkeleton() {
  return (
    <main className="app-shell skeleton-shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">R</span>
          <span className="brand-name">result-rpc</span>
          <span className="demo-pill">DEMO</span>
        </span>
      </header>
      <div className="workspace-grid">
        <aside className="sidebar">
          <div className="skeleton-block tall" />
        </aside>
        <section className="ticket-column">
          <div className="list-toolbar">
            <div className="skeleton-block heading" />
          </div>
          <TicketListSkeleton />
        </section>
        <section className="detail-column">
          <DetailSkeleton />
        </section>
      </div>
    </main>
  );
}

function TicketListSkeleton() {
  return (
    <div className="ticket-list-skeleton">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail-skeleton">
      <div className="skeleton-block tiny" />
      <div className="skeleton-block title" />
      <div className="skeleton-block line" />
      <div className="skeleton-block line short" />
      <div className="skeleton-block panel" />
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="detail-empty">
      <span>◇</span>
      <strong>Select a ticket</strong>
      <p>Open an entity to edit it and watch both views stay in sync.</p>
    </div>
  );
}
