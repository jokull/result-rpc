/** Closes a sync or async iterator through one audited iterator-protocol boundary. */
export declare const closeIterator: (iterator: Iterator<unknown, unknown, never> | AsyncIterator<unknown, unknown, never>) => Promise<void>;
