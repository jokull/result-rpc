/** Closes a sync or async iterator through one audited iterator-protocol boundary. */
export const closeIterator = async (
  iterator: Iterator<unknown, unknown, never> | AsyncIterator<unknown, unknown, never>,
): Promise<void> => {
  await iterator.return?.(undefined);
};
