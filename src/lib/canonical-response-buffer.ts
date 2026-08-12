import { appendCollapsingNewlines } from "./stream-text.ts";

export type CanonicalResponseBuffer = {
  read(): string;
  append(delta: string): string;
  replace(snapshot: string): string;
};

/**
 * Owns the authoritative text for one in-flight response.
 *
 * Provider deltas append through the transcript's newline normalization;
 * provider revisions replace the whole snapshot. Consumers publish only the
 * returned canonical value, never a second independently accumulated string.
 */
export function createCanonicalResponseBuffer(initial = ""): CanonicalResponseBuffer {
  let value = initial;

  return {
    read: () => value,
    append(delta) {
      value = appendCollapsingNewlines(value, delta);
      return value;
    },
    replace(snapshot) {
      value = snapshot;
      return value;
    },
  };
}
