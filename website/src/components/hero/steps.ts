/** The storyboard, as data. See `website/HERO-STORYBOARD.md` for the reasoning. */

export type Focus = "server" | "client" | "app";
export type UiState = "idle" | "pending" | "login" | "offline" | "resumed";

/** Which tags the popover shows, and where the rest of them are. */
export type UnionMode = "server" | "full" | "narrowed";

export interface Step {
  readonly id: string;
  /** Stepper label. Two words at most; it is a control, not a caption. */
  readonly label: string;
  readonly title: string;
  readonly caption: string;
  readonly focus: Focus;
  /** 1-indexed, matching the rendered gutter. */
  readonly serverHighlight: readonly number[];
  readonly clientHighlight: readonly number[];
  readonly showShell: boolean;
  readonly union: UnionMode;
  readonly ui: UiState;
  /** Dwell in ms — what the caption needs to be read, not what the motion needs. */
  readonly duration: number;
}

export const STEPS: readonly Step[] = [
  {
    id: "contract",
    label: "Contract",
    title: "One procedure. One union.",
    caption:
      "The union grows as the procedure is declared. `.use(requireViewer)` contributes its failure to every call — the handler was never edited.",
    focus: "server",
    serverHighlight: [3, 6],
    clientHighlight: [],
    showShell: false,
    union: "server",
    ui: "idle",
    duration: 5200,
  },
  {
    id: "call-path",
    label: "Call path",
    title: "The browser fails in ways the server cannot.",
    caption:
      "Offline, timeout, a stale deploy: the client adds its own failures to the same union rather than opening a second error channel. Eleven reach the component.",
    focus: "client",
    serverHighlight: [],
    clientHighlight: [2],
    showShell: false,
    union: "full",
    ui: "idle",
    duration: 6400,
  },
  {
    id: "shells",
    label: "Shells",
    title: "Ten of those have an owner. One is yours.",
    caption:
      "Mounting under the shells subtracts every failure they claim. Look at the component: not one line changed. The union narrowed because of where it sits.",
    focus: "client",
    serverHighlight: [],
    clientHighlight: [7],
    showShell: true,
    union: "narrowed",
    ui: "idle",
    duration: 6600,
  },
  {
    id: "live",
    label: "Live",
    title: "The session expires mid-rename.",
    caption:
      "The failure travels past the component to the shell that owns it, which opens the login sheet. The component has no branch for this, and cannot forget one.",
    focus: "app",
    serverHighlight: [3],
    clientHighlight: [],
    showShell: true,
    union: "narrowed",
    ui: "login",
    duration: 7200,
  },
  {
    id: "offline",
    label: "Offline",
    title: "A different shell. The same subtraction.",
    caption:
      "Offline is not a special case bolted on. The write is held rather than failed, and resumes on reconnect — same mechanism, different owner.",
    focus: "app",
    serverHighlight: [],
    clientHighlight: [],
    showShell: true,
    union: "narrowed",
    ui: "offline",
    duration: 7000,
  },
];
