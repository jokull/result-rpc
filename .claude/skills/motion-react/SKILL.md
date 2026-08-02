---
name: motion-react
description: Build animations with Motion for React (the `motion` package, formerly Framer Motion) — motion components, variants, shared-element transitions with layoutId, AnimatePresence exits, transition/spring/stagger tuning, scroll and gesture animation, and reduced-motion accessibility. Use when writing or debugging any animation in the result-rpc website, especially the home-page hero sequence.
---

# Motion for React

Installed in `website/` at **motion 12.43.0**, React 19.2.8, as an Astro island.
Import from **`motion/react`** — not `framer-motion`, which is the old package
name. Docs at <https://motion.dev/docs/react>; `https://motion.dev/llms.txt`
indexes every page (individual pages are HTML only, no `.md` variants).

```tsx
import { motion, AnimatePresence, MotionConfig, stagger, useReducedMotion } from "motion/react";
```

## Astro integration

Motion needs a React island. **Blume already registers `@astrojs/react`** when
React is installed — it even applies the React Compiler. Do **not** add
`react()` to `integrations` yourself: two React integrations each inject the
refresh preamble, and the page dies on `Identifier 'injectIntoGlobalHook' has
already been declared`.

`blume.config.ts` does accept `integrations`, appended after Blume's built-ins,
which is the supported way to reach Vite config. The generated
`.blume/astro.config.mjs` is rewritten on every run and must never be edited.

Mount with a client directive, or nothing runs:

```astro
<HeroSequence client:load />   <!-- hydrate immediately: above the fold -->
<HeroSequence client:visible /> <!-- hydrate on intersection: below the fold -->
```

`client:visible` is usually right for animation, since an unseen animation
should not cost hydration. For the hero, `client:load` — it is the fold.

## `pnpm dev` cannot run the island — use the build

**Known, and not worth fighting.** In `pnpm dev` the island dies on
`Invalid hook call ... more than one copy of React`. Vite's optimizer produces
two pre-bundles of React with different `?v=` cache-busting hashes; the browser
treats the two URLs as two modules and instantiates React twice. The repo root
carries its own `react` devDependency and this site is nested inside it, which
is what splits the graph.

`blume.config.ts` adds a `resolve.dedupe` integration that fixes plain React
islands, but an island importing `motion` still splits. **The production build
is unaffected**, so iterate this way:

```bash
pnpm --dir website build
pnpm --dir website preview --port 4321
```

Restart `preview` after every build — it holds the old worker bundle and starts
returning 500s otherwise, which looks exactly like a broken component.

## The core object

Any `motion.*` element takes `initial`, `animate`, `exit`, plus gesture props.
Values not listed are left alone.

```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, ease: "easeOut" }}
/>
```

Animate to a **variant label** instead of an object to drive a whole subtree
from one parent state. This is the right tool for a stepper: the parent holds
the step, children declare what they look like in each.

```tsx
const panel = {
  idle: { opacity: 0.4 },
  active: { opacity: 1 },
};

<motion.section animate={step === 2 ? "active" : "idle"} variants={panel}>
  <motion.div variants={child} /> {/* inherits the label automatically */}
</motion.section>;
```

Children inherit the parent's label without being passed anything — that
inheritance is what makes variants worth using over per-element `animate`.

## Shared element transitions (`layoutId`)

**The single most useful feature for explaining a system visually.** Two
elements in different places with the same `layoutId` become one element that
travels between them.

```tsx
{
  tags.map((tag) => <motion.span key={tag} layoutId={`tag-${tag}`}>{tag}</motion.span>);
}
```

Move a tag from one container to another in state and it *flies* there. It is
one continuous element, not a crossfade, so the viewer reads it as the same
thing moving — which is exactly the claim when an error tag leaves a
component's union and docks in a shell.

- The transition of the element being animated **to** is the one that applies.
- `<LayoutGroup>` wraps components that must animate together but do not
  re-render together.
- Wrap in `AnimatePresence` when the source or destination unmounts.

## Layout animations (`layout`)

`layout` animates position and size changes that CSS cannot transition —
`justify-content`, grid placement, an element changing its own text.

```tsx
<motion.div layout transition={{ layout: { duration: 0.3 } }} />
```

- `layout="position"` animates position only and lets size snap. Use for text
  and images, whose aspect ratio distorts under scale.
- Layout changes must come from **`style` or `className`**, never from
  `animate`. `layout` observes the DOM; animating the property fights it.
- Motion performs layout animation with `transform`, so children can visually
  distort. Fix by giving children their own `layout`, and set `borderRadius` /
  `boxShadow` via `style` so Motion can correct them.

### Caveats that will bite

- **`display: inline` cannot animate.** Browsers do not apply `transform` to
  inline elements. Use `inline-block`.
- **SVG is unsupported** for layout animations — no layout system. Animate
  attributes (`cx`, `pathLength`) directly instead.
- Layout animation is suspended during horizontal window resize.
- A layout change that adds or removes a scrollbar will jump. `scrollbar-gutter:
  stable` in CSS.

## Exits (`AnimatePresence`)

React removes a node immediately; `AnimatePresence` defers that until `exit`
finishes.

```tsx
<AnimatePresence>
  {isOpen && <motion.div key="sheet" exit={{ opacity: 0, y: 12 }} />}
</AnimatePresence>
```

- Every direct child needs a **stable unique `key`**. Array indices break on
  reorder.
- `AnimatePresence` must wrap the condition — never be conditional itself.
  `{open && <AnimatePresence>…}` silently does nothing.
- `mode="wait"` holds the entering child until the exiting one is gone. Right
  for swapping one panel for another; one child at a time.
- `mode="popLayout"` pulls exiting children out of layout flow so siblings
  reflow immediately. Needs a non-static parent `position`.
- `initial={false}` suppresses mount animations on first paint — use it for
  anything server-rendered so the page does not animate itself in on load.

## Transitions

```tsx
transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
transition={{ type: "spring", visualDuration: 0.4, bounce: 0.2 }}
```

- Default is a tween at `0.3s`.
- Springs: prefer **`visualDuration` + `bounce`** over `stiffness`/`damping`.
  It is the same physics parameterized by what you can actually see, and it is
  tunable without a feedback loop.
- Springs suit gestures and anything interruptible; tweens suit sequences that
  must line up with other timed events — a stepper is tweens.
- Per-value overrides: `transition={{ default: { type: "spring" }, opacity: { ease: "linear" } }}`.
- `when: "beforeChildren" | "afterChildren"` orders a parent against its
  children.

### Stagger

```tsx
transition={{ delayChildren: stagger(0.04, { from: "first" }) }}
```

Eleven items appearing at once reads as a wall; the same eleven at 40ms apart
read as accumulation. Stagger is a rhetorical device, not decoration — reach
for it when the *count* is the point.

## Sequencing

For imperative, awaited sequences — the shape a scripted storyboard wants:

```tsx
const [scope, animate] = useAnimate();

useEffect(() => {
  const run = async () => {
    await animate(".line-3", { backgroundColor: "#fee" }, { duration: 0.2 });
    await animate(".packet", { x: 320 }, { duration: 0.5 });
  };
  void run();
}, [animate]);

return <div ref={scope}>…</div>;
```

`animate` is scoped to `scope`, so selectors are local. Prefer declarative
variants when state maps cleanly onto steps; reach for `useAnimate` when a step
is genuinely a *sequence* with awaited beats.

## Reduced motion — required, not optional

```tsx
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

With `"user"`, Motion automatically disables **transform and layout**
animations while still animating `opacity`, `backgroundColor`, and other
non-spatial values. That default is good but it is not a whole strategy: an
animation carrying *information* must still deliver it.

```tsx
const shouldReduceMotion = useReducedMotion();
```

For a stepper, the correct reduced-motion behavior is **jump to each step's
final frame**. The story survives; only the travel is gone. Autoplay should not
start at all — motion someone asked not to see is not more acceptable for
being subtle.

## Bundle

`motion` is not small. If the island grows, `LazyMotion` with a deferred
feature bundle takes the initial cost to ~4.6kb:

```tsx
import { LazyMotion, domAnimation, m } from "motion/react";
<LazyMotion features={domAnimation}>
  <m.div animate={{ opacity: 1 }} />
</LazyMotion>;
```

Note `m` rather than `motion` — mixing them defeats the point. `domAnimation`
excludes layout animation; `domMax` includes it and is most of the weight. A
hero built on `layoutId` needs `domMax`, so measure before assuming
`LazyMotion` helps here.

## Checklist before calling an animation done

- [ ] `prefers-reduced-motion` respected, and the meaning survives without motion.
- [ ] Controls are real `<button>`s, keyboard reachable, with `aria-current`.
- [ ] Autoplay pauses on hover, on `focus-within`, and permanently after any
      manual interaction.
- [ ] Captions are DOM text, not baked into images.
- [ ] Content is legible with JavaScript disabled.
- [ ] No `display: inline` on anything animated.
- [ ] `AnimatePresence` children have stable keys.
- [ ] Verified in a browser at the real viewport, not only in code review.
