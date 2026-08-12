import "temporal-polyfill/global";
export declare const SERIALIZER_NAME: "devalue";
export declare const SERIALIZER_VERSION: 1;
export declare const DEFAULT_MAX_WIRE_BYTES = 1048576;
export declare const DEFAULT_MAX_ERROR_BYTES = 65536;
export interface SerializationOptions {
    readonly maxBytes?: number;
}
export type SerializationResult<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    ok: false;
    path?: string;
    message: string;
}>;
export declare const serialize: (value: unknown, options?: SerializationOptions) => SerializationResult<string>;
export declare const deserialize: (value: string, options?: SerializationOptions) => SerializationResult<unknown>;
export declare const isSerializable: (value: unknown) => boolean;
