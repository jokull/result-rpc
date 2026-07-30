import { wire, type WireCodec, type WireValue } from "./wire.js";

/** Builds the correlated request and response codecs for a paginated procedure. */
export const paginationCodecs = <
  TListInput,
  TListData extends WireValue,
  TCursor,
  TCursorData extends WireValue,
  TItem,
  TItemData extends WireValue,
>(
  list: WireCodec<TListInput, TListData>,
  cursor: WireCodec<TCursor, TCursorData>,
  item: WireCodec<TItem, TItemData>,
) => {
  const cursorOrNull = wire.union([cursor, wire.null]);
  return {
    input: wire.object({ list, cursor: cursorOrNull }),
    output: wire.object({ items: wire.array(item), nextCursor: cursorOrNull }),
  } as const;
};
