---
title: "Forms and the wire"
description: "Forms validate humans; wires validate applications. The bridge: validators as wire codecs and server issues onto fields."
---

Two validations live near each other here, and they are not the same thing.
A form validates a *human*: values arrive as strings, get coerced, deserve
progressive per-field feedback, and usually cover only a slice of the
eventual input — the id comes from the route, the author from the session.
The wire validates an *application boundary*: values arrive typed, complete,
and possibly hostile. Collapsing the two into one schema is tempting and
almost never right — the form wants "looks like an email while you type",
the wire wants "is a string, or 400".

So result-rpc is not a form library and does not pretend the input codec is
your form schema. Use a real one (we like [Formisch](https://formisch.dev) —
schema-first, headless, signal-fast). The contract contributes exactly the
two edges that are its business:

**Your validator can be the wire codec.** If your team's input vocabulary is
Valibot, Zod, or ArkType (the tRPC `.input(z.object(...))` habit),
`wire.standard` adopts any synchronous [Standard Schema](https://standardschema.dev)
as a procedure's input codec — validation on both sides of the wire, plus
the serializer preflight a plain validator can't give you:

```ts
const rename = app.procedure()
  .input(wire.standard(RenameInput))   // your Valibot/Zod schema, as the wire codec
  .output(DocCodec)
  .mutation()
```

(Async schemas are rejected — wire validation is synchronous — and the
schema must accept its own output, so one-way transforms don't fit. And when
a form's shape happens to coincide exactly with an input, sharing the schema
is free — but treat that as a coincidence to notice, not an architecture to
force.)

**Server rejections land on fields.** Whatever validates the form, the
codec still validates the wire — and when a request fails there,
`server/bad-request` carries path-scoped issues that project onto field
keys:

```tsx
const result = await rename.mutate(toInput(form.values))
if (!result.ok && result.error._tag === "server/bad-request") {
  setFieldErrors(fieldIssues(result.error))
  // { "title": ["Expected a string"], "author.email": ["Expected an email"] }
}
```

The paths are shaped like the *input*. When the form edits a projection of
the input — it usually does — map the keys where the shapes diverge, in the
same place you already map values (`toInput` above). The mapping is the
honest artifact: it is where "what the human edits" and "what the wire
carries" meet, and no bridge should hide it.
