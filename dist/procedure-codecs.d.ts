import { type WireCodec, type WireValue } from "./wire.js";
/** Builds the correlated request and response codecs for a paginated procedure. */
export declare const paginationCodecs: <TListInput, TListData extends WireValue, TCursor, TCursorData extends WireValue, TItem, TItemData extends WireValue>(list: WireCodec<TListInput, TListData>, cursor: WireCodec<TCursor, TCursorData>, item: WireCodec<TItem, TItemData>) => {
    readonly input: WireCodec<{
        readonly cursor: TCursor | null;
        readonly list: TListInput;
    } & {}, {
        readonly cursor: TCursorData | null;
        readonly list: TListData;
    } & {}>;
    readonly output: WireCodec<{
        readonly items: readonly TItem[];
        readonly nextCursor: TCursor | null;
    } & {}, {
        readonly items: readonly TItemData[];
        readonly nextCursor: TCursorData | null;
    } & {}>;
};
