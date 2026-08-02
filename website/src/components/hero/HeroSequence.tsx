import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT_CODE, SERVER_CODE, SHELL_CODE, TAGS, type CodeLine } from "./code";
import { STEPS, type Step } from "./steps";
import "./hero-sequence.css";

const CodeBlock = ({
  lines,
  highlight,
  label,
}: {
  lines: readonly CodeLine[];
  highlight: readonly number[];
  label: string;
}) => (
  <div className="hs-code" aria-label={label}>
    <pre>
      <code>
        {lines.map((line, index) => {
          const lit = highlight.includes(index + 1);
          return (
            // Lines are a fixed, ordered listing; the index is the identity.
            // eslint-disable-next-line react/no-array-index-key
            <span className={`hs-line${lit ? " is-lit" : ""}`} key={index}>
              {lit ? (
                <motion.span
                  className="hs-line-band"
                  layoutId={`band-${label}`}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                />
              ) : null}
              {line.length === 0
                ? " "
                : line.map(([kind, text], token) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <span className={kind ? `hs-${kind}` : undefined} key={token}>
                      {text}
                    </span>
                  ))}
            </span>
          );
        })}
      </code>
    </pre>
  </div>
);

/**
 * The union, as chips. Each chip carries a `layoutId`, so a tag leaving the
 * popover for the shell dock is one element travelling rather than two
 * crossfading — which is the actual claim: the failure did not disappear, it
 * went somewhere with an owner.
 */
const Tag = ({ name, origin, dimmed }: { name: string; origin: string; dimmed: boolean }) => (
  <motion.span
    layoutId={`tag-${name}`}
    className={`hs-tag hs-tag-${origin}${dimmed ? " is-dim" : ""}`}
    transition={{ type: "spring", visualDuration: 0.45, bounce: 0.18 }}
  >
    {name}
  </motion.span>
);

const TypePopover = ({ step }: { step: Step }) => {
  const visible =
    step.union === "server"
      ? TAGS.filter(
          (tag) =>
            tag.origin === "server" &&
            tag.name !== "ServerInternal" &&
            tag.name !== "ServerBadRequest",
        )
      : step.union === "full"
        ? TAGS
        : TAGS.filter((tag) => !tag.claimed);

  return (
    <motion.div className="hs-popover" layout transition={{ duration: 0.35, ease: "easeOut" }}>
      <div className="hs-popover-head">
        <span className="hs-popover-anchor">rename.error</span>
        <motion.span
          className="hs-count"
          key={visible.length}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {visible.length}
        </motion.span>
      </div>
      <div className="hs-popover-body">
        <span className="hs-t">Result</span>
        <span>&lt;</span>
        <span className="hs-t">Doc</span>
        <span>,&nbsp;</span>
        <motion.span className="hs-tags" layout>
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((tag) => (
              <Tag
                key={tag.name}
                name={tag.name}
                origin={tag.origin}
                dimmed={step.union === "full" && tag.origin === "server"}
              />
            ))}
          </AnimatePresence>
          {/* Inside the flex so it trails the last chip instead of orphaning
              onto its own line when the union wraps. */}
          <span className="hs-close">&gt;</span>
        </motion.span>
      </div>
    </motion.div>
  );
};

/** Where claimed failures end up. Empty until the shells enter the story. */
const ShellDock = ({ active }: { active: boolean }) => (
  <div className="hs-dock" aria-hidden={!active}>
    <span className="hs-dock-label">claimed above</span>
    <div className="hs-dock-tags">
      <AnimatePresence initial={false}>
        {active
          ? TAGS.filter((tag) => tag.claimed).map((tag) => (
              <Tag key={tag.name} name={tag.name} origin={tag.origin} dimmed={false} />
            ))
          : null}
      </AnimatePresence>
    </div>
  </div>
);

const AppPanel = ({ step }: { step: Step }) => (
  <div className="hs-app" aria-label="The running app">
    <div className="hs-app-bar">
      <span className="hs-dot" />
      <span className="hs-dot" />
      <span className="hs-dot" />
      <AnimatePresence>
        {step.ui === "offline" ? (
          <motion.span
            className="hs-offline-banner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            Offline — the write is held
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>

    <div className="hs-app-body">
      <label className="hs-field-label" htmlFor="hs-title">
        Document title
      </label>
      <div
        className={`hs-field${step.ui === "pending" || step.ui === "offline" ? " is-pending" : ""}`}
      >
        <span id="hs-title">Q3 planning notes</span>
        {step.ui === "pending" || step.ui === "offline" ? <span className="hs-spinner" /> : null}
      </div>
      <button className="hs-save" type="button" tabIndex={-1}>
        Save
      </button>

      <AnimatePresence>
        {step.ui === "login" ? (
          <motion.div
            className="hs-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", visualDuration: 0.45, bounce: 0.12 }}
          >
            <p className="hs-sheet-title">Your session expired</p>
            <p className="hs-sheet-copy">
              Sign in to finish saving. Opened by AuthShell, not by the form.
            </p>
            <span className="hs-sheet-button">Sign in</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  </div>
);

export default function HeroSequence() {
  const [index, setIndex] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const reduce = useReducedMotion();
  const step = STEPS[index]!;
  const engagedRef = useRef(false);

  const select = useCallback((next: number) => {
    engagedRef.current = true;
    setEngaged(true);
    setIndex(next);
  }, []);

  // Autoplay once, then rest. Never under reduced motion, and never again once
  // the visitor has taken control — an animation that resumes under someone's
  // cursor has stopped being a demonstration and started being a distraction.
  useEffect(() => {
    if (reduce || engaged || index >= STEPS.length - 1) return undefined;
    const timer = setTimeout(() => {
      if (!engagedRef.current) setIndex((current) => Math.min(current + 1, STEPS.length - 1));
    }, step.duration);
    return () => clearTimeout(timer);
  }, [engaged, index, reduce, step.duration]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="hs"
        onPointerDown={() => setEngaged(true)}
        onFocusCapture={() => setEngaged(true)}
      >
        <div className="hs-stage">
          <div className={`hs-col hs-col-code${step.focus === "app" ? " is-back" : ""}`}>
            <div className={`hs-panel${step.focus === "server" ? " is-focus" : ""}`}>
              <p className="hs-panel-label">server · the procedure</p>
              <CodeBlock lines={SERVER_CODE} highlight={step.serverHighlight} label="server" />
            </div>

            <div className={`hs-panel${step.focus === "client" ? " is-focus" : ""}`}>
              <p className="hs-panel-label">client · the component</p>
              <AnimatePresence initial={false}>
                {step.showShell ? (
                  <motion.div
                    className="hs-shell"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  >
                    <CodeBlock lines={SHELL_CODE} highlight={[]} label="shell" />
                    <ShellDock active={step.showShell} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <CodeBlock lines={CLIENT_CODE} highlight={step.clientHighlight} label="client" />
            </div>
          </div>

          <div className={`hs-col hs-col-app${step.focus === "app" ? " is-focus" : ""}`}>
            <TypePopover step={step} />
            <AppPanel step={step} />
          </div>
        </div>

        <div className="hs-caption">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              <p className="hs-caption-title">{step.title}</p>
              <p className="hs-caption-copy">{step.caption}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <ol className="hs-stepper">
          {STEPS.map((entry, position) => (
            <li key={entry.id}>
              <button
                type="button"
                className={position === index ? "is-current" : undefined}
                aria-current={position === index ? "step" : undefined}
                onClick={() => select(position)}
              >
                <span className="hs-stepper-index">{position + 1}</span>
                {entry.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </MotionConfig>
  );
}

export { LayoutGroup };
