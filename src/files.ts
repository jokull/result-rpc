/**
 * File sidecar transport support.
 *
 * `File`/`Blob` values cannot cross the devalue wire, so they ride as
 * multipart parts alongside the envelope: before serialization the encoded
 * input is walked, each file is replaced with a positional marker, and the
 * transport sends `envelope` plus parts `0..n-1`. The server reverses the
 * substitution before input decoding, so `wire.file()` codecs see real
 * `File` instances and the typed input object never degrades to FormData.
 *
 * Markers only ever resolve on multipart requests, each part must be claimed
 * exactly once, and indices must be in bounds — a marker smuggled inside an
 * ordinary JSON request resolves to nothing and fails input validation.
 */

const FILE_MARKER_KEY = "$resultRpcFile" as const;

export interface FileMarker {
  readonly [FILE_MARKER_KEY]: number;
}

export const isFileMarker = (value: unknown): value is FileMarker =>
  value !== null
  && typeof value === "object"
  && FILE_MARKER_KEY in value
  && typeof (value as Record<string, unknown>)[FILE_MARKER_KEY] === "number"
  && Object.keys(value).length === 1;

const isBlob = (value: unknown): value is Blob =>
  typeof Blob !== "undefined" && value instanceof Blob;

/**
 * Replaces every `File`/`Blob` in a value tree with a positional marker.
 * Files may appear in plain objects and arrays (the shapes input codecs
 * produce); they are not followed into Map/Set members.
 */
export const extractFiles = (
  value: unknown,
): { readonly value: unknown; readonly files: readonly Blob[] } => {
  const files: Blob[] = [];
  // Cycle- and identity-preserving rewrite: every object is cloned exactly
  // once, and revisits resolve to the clone.
  const clones = new WeakMap<object, unknown>();
  const walk = (current: unknown): unknown => {
    if (isBlob(current)) {
      files.push(current);
      return { [FILE_MARKER_KEY]: files.length - 1 };
    }
    if (Array.isArray(current)) {
      const seen = clones.get(current);
      if (seen !== undefined) return seen;
      const next: unknown[] = [];
      clones.set(current, next);
      for (const item of current) next.push(walk(item));
      return next;
    }
    if (
      current !== null
      && typeof current === "object"
      && Object.getPrototypeOf(current) === Object.prototype
    ) {
      const seen = clones.get(current);
      if (seen !== undefined) return seen;
      const next: Record<string, unknown> = {};
      clones.set(current, next);
      for (const [key, item] of Object.entries(current)) next[key] = walk(item);
      return next;
    }
    return current;
  };
  const rewritten = walk(value);
  // No files: hand back the original so identity (and cheapness) is preserved.
  return files.length === 0 ? { value, files } : { value: rewritten, files };
};

/**
 * Reverses `extractFiles`: resolves markers to their parts. Returns undefined
 * when the substitution is not a bijection — out-of-bounds, reused, or unused
 * parts are protocol violations, not recoverable inputs.
 */
export const injectFiles = (
  value: unknown,
  files: readonly Blob[],
): unknown | undefined => {
  const used = new Set<number>();
  let invalid = false;
  const clones = new WeakMap<object, unknown>();
  const walk = (current: unknown): unknown => {
    if (isFileMarker(current)) {
      const index = current[FILE_MARKER_KEY];
      if (!Number.isInteger(index) || index < 0 || index >= files.length || used.has(index)) {
        invalid = true;
        return current;
      }
      used.add(index);
      return files[index];
    }
    if (Array.isArray(current)) {
      const seen = clones.get(current);
      if (seen !== undefined) return seen;
      const next: unknown[] = [];
      clones.set(current, next);
      for (const item of current) next.push(walk(item));
      return next;
    }
    if (
      current !== null
      && typeof current === "object"
      && Object.getPrototypeOf(current) === Object.prototype
    ) {
      const seen = clones.get(current);
      if (seen !== undefined) return seen;
      const next: Record<string, unknown> = {};
      clones.set(current, next);
      for (const [key, item] of Object.entries(current)) next[key] = walk(item);
      return next;
    }
    return current;
  };
  const resolved = walk(value);
  if (invalid || used.size !== files.length) return undefined;
  return resolved;
};
