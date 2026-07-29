import { defineModel, entityIdFor, type ModelKeyInput } from "../src/model.js";
import { rpc } from "../src/contract.js";
import type { QueryCache } from "../src/query/runtime.js";
import type { ProcedureHandlerArgs } from "../src/server/contract.js";
import { wire } from "../src/wire.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const Content = defineModel("content", {
  key: ["id", "locale"],
  shape: {
    id: wire.string,
    locale: wire.string,
    title: wire.string,
  },
});

export type _CompositeKeyIsRetained = Assert<Equal<typeof Content.key, readonly ["id", "locale"]>>;

Content.pick("id", "locale", "title");
Content.select({ id: true, locale: true, title: true });
// @ts-expect-error every composite identity field is required
Content.pick("id", "title");
// @ts-expect-error structured selections carry the same identity requirement
Content.select({ id: true, title: true });

const contract = rpc.context<{}>();
const contentWrite = contract
  .procedure()
  .input(wire.object({ id: wire.string, locale: wire.string }))
  .output(wire.object({}));
contentWrite.writes(Content, (input) => ({ id: input.id, locale: input.locale }));
// @ts-expect-error declared writes retain every composite identity field
contentWrite.writes(Content, (input) => ({ id: input.id }));

const acceptsContentKey = (_key: ModelKeyInput<typeof Content>) => undefined;
acceptsContentKey("content:en");
acceptsContentKey({ id: "content", locale: "en" });
entityIdFor(Content, { id: "content", locale: "en" });
declare const cache: QueryCache;
cache.invalidateEntity(Content, { id: "content", locale: "en" });
declare const handler: ProcedureHandlerArgs<{}, {}, {}>;
handler.touch(Content, { id: "content", locale: "en" });
// @ts-expect-error composite prejoined ids are strings, never numbers
acceptsContentKey(1);
// @ts-expect-error entityIdFor preserves the model-specific composite key too
entityIdFor(Content, 1);
// @ts-expect-error cache identity APIs preserve the same model-specific key
cache.invalidateEntity(Content, 1);
// @ts-expect-error handler touch declarations preserve the model-specific key
handler.touch(Content, 1);
// @ts-expect-error a structured key must contain every identity field
acceptsContentKey({ id: "content" });
// @ts-expect-error unrelated fields are not part of this model's identity
acceptsContentKey({ id: "content", locale: "en", tenant: "acme" });

const NumericIdentity = defineModel("numeric-identity", {
  key: "sequence",
  shape: { sequence: wire.number, label: wire.string },
});
const acceptsNumericKey = (_key: ModelKeyInput<typeof NumericIdentity>) => undefined;
acceptsNumericKey(42);
acceptsNumericKey({ sequence: 42 });
// @ts-expect-error a single-field key uses that field's actual decoded type
acceptsNumericKey("42");
// @ts-expect-error the structured form uses the declared key field
acceptsNumericKey({ id: 42 });

const StringIdentity = defineModel("string-identity", {
  key: "slug",
  shape: { slug: wire.string },
});
const acceptsStringKey = (_key: ModelKeyInput<typeof StringIdentity>) => undefined;
acceptsStringKey("forty-two");
acceptsStringKey({ slug: "forty-two" });
// @ts-expect-error a string-keyed model does not accept a numeric id
acceptsStringKey(42);

defineModel("bad-object-key", {
  // @ts-expect-error object-valued fields cannot be entity keys
  key: "id",
  shape: { id: wire.object({ nested: wire.string }) },
});

defineModel("bad-nullable-key", {
  // @ts-expect-error nullable fields cannot be entity keys
  key: "id",
  shape: { id: wire.union([wire.string, wire.null]) },
});
