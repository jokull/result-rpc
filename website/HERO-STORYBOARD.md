# Hero animation — storyboard

A clickable stepper that walks one mutation from contract to rendered UI, so a
visitor sees the library's whole claim in about 25 seconds without reading a
paragraph.

## The one thing this must land

**Eleven failures reach the component. It handles one.**

Everything else — the syntax highlighting, the popovers, the login sheet — is in
service of that single contrast. If a viewer leaves remembering only "the error
union got smaller as it went down the tree, and something else handled the
rest", the animation worked.

The corollary, which is the part people do not believe until they see it: the
component code **does not change** between step 2 and step 3. The union narrows
because of where the component is mounted, not because anyone wrote a branch.
Step 4 exists to prove it — a real failure fires and the component's code never
lights up.

## Layout

```
┌───────────────────────────────┬─────────────────────────┐
│ A · server: the procedure     │                         │
│    (9 lines, syntax hl)       │  C · the app            │
│                               │     (mock UI, ~360px)   │
├───────────────────────────────┤                         │
│ B · client: the component     │                         │
│    (11 lines, syntax hl)      │                         │
│    ── shell mount appears     │                         │
│       above B at step 3       │                         │
└───────────────────────────────┴─────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ ①  contract   ②  call path   ③  shells   ④  live   ⑤ offline │
└──────────────────────────────────────────────────────────┘
```

Left column is code, right column is the running app, stepper underneath. The
type popover is an overlay anchored to a token in whichever panel is active —
it is the connective tissue between the two columns, and it is where the union
count actually changes.

## The code on screen

Real API, trimmed to what fits. Nothing here should be aspirational — if it
does not compile against the current version, it does not go on the front page.

### Panel A — the procedure

```ts
export const rename = server
  .procedure()
  .use(requireViewer) // + auth/session-expired
  .input(wire.object({ id: wire.string, title: wire.string }))
  .output(DocView)
  .errors({ TitleTaken }) // + doc/title-taken
  .mutation(({ input, ctx }) => docs.rename(ctx.viewer, input.id, input.title));
```

Lines: 1 `export`, 2 `.procedure()`, 3 `.use`, 4 `.input`, 5 `.output`,
6 `.errors`, 7–9 `.mutation`.

### Panel B — the component

```tsx
function RenameDoc({ id }: { id: string }) {
  const rename = AuthShell.useMutation(client.doc.rename);

  return (
    <TitleField
      pending={rename.state === "pending"}
      error={rename.error}
      onSubmit={(title) => rename.mutate({ id, title })}
    />
  );
}
```

Lines: 2 the hook, 6 `pending`, 7 `error`, 8 `mutate`.

Line 7 is the emotional center of the whole piece. It is the line whose _type_
changes while its _text_ never does.

### Panel B′ — the shell mount (slides in above B at step 3)

```tsx
<AuthShell.Provider session={session} signOut={signOut}>
  <RenameDoc id={id} />
</AuthShell.Provider>
```

With, shown once as a popover rather than a panel:

```ts
export const AuthShell = defineShell({
  name: "auth",
  claims: authErrors, // { SessionExpired, Unauthorized }
  onError: (_error, { signOut }) => signOut(),
});
```

## The steps

Times are cumulative; each step's dwell is what a reader needs to finish the
caption, not what the motion needs.

---

### ① The contract · 0:00–0:05 · "One procedure. One union."

**Panel A** types in — or rather, reveals line by line; typing animation is
slower to read and adds nothing. Lines 3 and 6 get a sustained highlight.

**Popover** anchored to `rename` on line 1, assembling as the lines land:

```
Result<Doc, TitleTaken>
Result<Doc, TitleTaken | SessionExpired>
```

The second member arrives when line 3 (`.use(requireViewer)`) highlights. That
is the whole idea of middleware-contributed errors in one motion — the union
grew because a _dependency_ was declared, not because the handler was edited.

**Panel C** idle: a document with a title field, unfocused.

---

### ② The call path adds its own · 0:05–0:11 · "The browser fails in ways the server cannot."

Focus moves to **Panel B**, which reveals. Line 2 highlights.

**Popover** anchored to `rename.error` on line 7 — and this is the money shot.
It expands to the unnarrowed union, members arriving in two visually distinct
groups:

```
Result<Doc,
  TitleTaken | SessionExpired          ← from the server (dimmer, already seen)
  | ServerInternal | ServerBadRequest
  | Offline | NetworkFailure | Timeout ← added by the client (brighter, new)
  | HttpFailure | ProtocolViolation
  | DecodeFailure | Stale
>
```

A counter in the popover corner: **11**. It should feel like slightly too much —
that is the honest depiction of what any real network call can do, and the
feeling of "that's a lot to handle" is precisely the setup for step 3.

**Panel C** still idle.

---

### ③ Shells subtract · 0:11–0:17 · "Ten of those have an owner. One is yours."

The camera pulls back: **Panel B′** slides in above Panel B, wrapping it — the
component visibly becomes a child of `AuthShell.Provider`.

Ten tag chips lift out of the popover and travel **upward** into the shell
mount, where they dock. `TitleTaken` stays. The counter runs **11 → 1**.

**Popover** settles to:

```
Result<Doc, TitleTaken>
```

**The caption must say the quiet part:** _Panel B did not change._ Consider a
literal diff gutter on B showing zero changed lines while the popover above it
transforms.

**Panel C** still idle. Resist the urge to animate the UI here; this step is
about types, and splitting attention weakens it.

---

### ④ Watch it happen · 0:17–0:24 · "Session expires mid-rename. The component never hears about it."

Now the UI moves.

1. **Panel C**: user edits the title, presses save. Field goes pending.
2. **Panel B** line 8 (`rename.mutate`) pulses. A packet travels along the
   wire from B to A.
3. **Panel A** line 3 (`.use(requireViewer)`) flashes **red** — the session is
   gone.
4. The packet returns as a chip labelled `auth/session-expired`. It reaches
   Panel B and **does not stop** — it passes through and docks in Panel B′,
   the shell.
5. **Panel C**: a login sheet rises. Not a toast, not an inline error — a
   different piece of UI entirely, owned by a different part of the tree.

**Nothing in Panel B highlights during any of this.** That absence is the
payload. The caption should point at it directly: _no branch, no `if`, no
`catch` — this component cannot see that error, so it cannot forget to handle
it._

Optional flourish if it does not crowd the beat: `rename.state` returns to
`"idle"` rather than `"failure"`, briefly shown in the popover, because a
claimed error never becomes that operation's terminal failure.

---

### ⑤ Offline, same mechanism · 0:24–0:30 · "A different shell. The same subtraction."

Network toggles off in Panel C. An offline banner appears from `OfflineShell` —
again, not from `RenameDoc`. The pending rename is **held**, not failed. The
connection returns; the mutation resumes and lands; the banner retracts.

This step earns its place by showing the mechanism generalizes: the previous
step could be read as "auth is special-cased". This proves it is not.

---

### Rest state

After ⑤, settle into a legible final frame: full code, narrowed popover
visible, stepper showing all five, UI at rest. Loop only if the visitor has not
interacted — an animation that restarts under someone's cursor is hostile.

## Motion notes

- **Framer Motion**, `layoutId` for the tag chips so a tag flying from popover
  to shell is one continuous element, not a crossfade. That continuity _is_ the
  argument — the error did not disappear, it moved somewhere with an owner.
- **Line highlighting** as an absolutely-positioned band behind the token span,
  animated by `layout`, so it slides between lines rather than blinking.
- Union members enter with a small stagger (~40ms). Eleven at once reads as a
  wall; eleven in sequence reads as accumulation, which is the point.
- The wire packet is the only element allowed to move horizontally between the
  columns. Keeping that axis exclusive makes "this crossed the network" legible
  without a label.

## Accessibility and degradation

Non-negotiable, and cheap if designed in now rather than bolted on:

- `prefers-reduced-motion` → render the **final frame of each step** and let
  the stepper switch between them instantly. The story survives; only the
  transitions go. This also becomes the mobile treatment.
- The stepper is real `<button>`s with `aria-current`, keyboard-operable,
  arrow-key navigable.
- Every caption is real text in the DOM, not baked into an image, and the whole
  sequence is readable as static content with JS off.
- Autoplay pauses on hover, on focus-within, and after any manual step
  selection. Once someone takes control they keep it.

## Decisions I need from you

1. **React + Motion on the site.** The website is Astro with no React today.
   This means `@astrojs/react`, `react`, `react-dom`, and `motion` — one
   client island on the home page only. Fine, or do you want to try it with CSS
   and the Web Animations API to keep the dependency out?
2. **Where it sits.** Replacing the current `.hero-code` figure, or below the
   existing hero copy as a second section? Replacing is bolder and makes the
   fold do more work; below is safer for the CTA buttons.
3. **Five steps or four.** ⑤ (offline) is the most cuttable if the whole thing
   runs long. I would keep it — it is what turns "nice auth trick" into "this
   is a mechanism" — but it is the one I would drop under protest.
4. **Autoplay or click-to-start.** Autoplay gets more views and annoys more
   people. My inclination: autoplay once, no loop, prominent stepper.

## Open question I could not settle

The type popover has to be _legible_ at eleven union members without dominating
the frame. That is a typography problem more than a motion problem, and it may
force the union onto multiple lines in a way that weakens the "one line, one
type" feeling. Worth mocking up statically before any of the motion work
starts — if the 11-member popover cannot be made to look good, the whole
storyboard needs rethinking, and better to learn that in an afternoon than
after the island is built.
