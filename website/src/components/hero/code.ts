/**
 * The code shown in the hero, tokenized by hand.
 *
 * Hand tokens rather than Shiki: every line needs to be individually
 * highlightable and some tokens are popover anchors, which means the markup has
 * to be addressable. Running a highlighter in the island to then re-parse its
 * output would cost more and control less.
 *
 * Everything here must compile against the current release. It is the first
 * code a visitor reads, and front-page code that lies is worse than no code.
 */
export type TokenKind = "" | "k" | "s" | "c" | "t" | "f";
export type Token = readonly [TokenKind, string];
export type CodeLine = readonly Token[];

/** `server.procedure()` — where the union is declared. */
export const SERVER_CODE: readonly CodeLine[] = [
  [
    ["k", "export"],
    ["", " "],
    ["k", "const"],
    ["", " rename = server"],
  ],
  [
    ["", "  ."],
    ["f", "procedure"],
    ["", "()"],
  ],
  [
    ["", "  ."],
    ["f", "use"],
    ["", "("],
    ["t", "requireViewer"],
    ["", ")"],
    ["c", "        // + auth/session-expired"],
  ],
  [
    ["", "  ."],
    ["f", "input"],
    ["", "(wire.object({ id: wire.string, title: wire.string }))"],
  ],
  [
    ["", "  ."],
    ["f", "output"],
    ["", "("],
    ["t", "DocView"],
    ["", ")"],
  ],
  [
    ["", "  ."],
    ["f", "errors"],
    ["", "({ "],
    ["t", "TitleTaken"],
    ["", " })"],
    ["c", "           // + doc/title-taken"],
  ],
  [
    ["", "  ."],
    ["f", "mutation"],
    ["", "(({ input, ctx }) =>"],
  ],
  [["", "    docs.rename(ctx.viewer, input.id, input.title),"]],
  [["", "  );"]],
];

/** The component. Line 7 is the one whose type changes and whose text never does. */
export const CLIENT_CODE: readonly CodeLine[] = [
  [
    ["k", "function"],
    ["", " "],
    ["t", "RenameDoc"],
    ["", "({ id }: { id: "],
    ["t", "string"],
    ["", " }) {"],
  ],
  [
    ["", "  "],
    ["k", "const"],
    ["", " rename = "],
    ["t", "AuthShell"],
    ["", "."],
    ["f", "useMutation"],
    ["", "(client.doc.rename);"],
  ],
  [],
  [
    ["", "  "],
    ["k", "return"],
    ["", " ("],
  ],
  [
    ["", "    <"],
    ["t", "TitleField"],
  ],
  [["", '      pending={rename.state === "pending"}']],
  [["", "      error={rename.error}"]],
  [["", "      onSubmit={(title) => rename.mutate({ id, title })}"]],
  [["", "    />"]],
  [["", "  );"]],
  [["", "}"]],
];

/** The mount. Slides in above the component when the shells enter the story. */
export const SHELL_CODE: readonly CodeLine[] = [
  [
    ["", "<"],
    ["t", "AppShells"],
    ["", ">"],
    ["c", "                     // offline · retry · stale · defect"],
  ],
  [
    ["", "  <"],
    ["t", "AuthShell.Provider"],
    ["", " session={session}>"],
  ],
  [
    ["", "    <"],
    ["t", "RenameDoc"],
    ["", " id={id} />"],
  ],
];

export type TagOrigin = "server" | "client";

export interface Tag {
  readonly name: string;
  readonly origin: TagOrigin;
  /** The component keeps exactly one. Everything else has an owner above it. */
  readonly claimed: boolean;
}

/**
 * The eleven failures that reach an unnarrowed call, in the order they join it:
 * what the procedure declared, what the server boundary can add, then what the
 * browser contributes on its own side of the wire.
 */
export const TAGS: readonly Tag[] = [
  { name: "TitleTaken", origin: "server", claimed: false },
  { name: "SessionExpired", origin: "server", claimed: true },
  { name: "ServerInternal", origin: "server", claimed: true },
  { name: "ServerBadRequest", origin: "server", claimed: true },
  { name: "Offline", origin: "client", claimed: true },
  { name: "NetworkFailure", origin: "client", claimed: true },
  { name: "Timeout", origin: "client", claimed: true },
  { name: "HttpFailure", origin: "client", claimed: true },
  { name: "ProtocolViolation", origin: "client", claimed: true },
  { name: "DecodeFailure", origin: "client", claimed: true },
  { name: "Stale", origin: "client", claimed: true },
];
