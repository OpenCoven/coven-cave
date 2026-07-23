import { randomUUID } from "node:crypto";

/**
 * Aside path used when preserving the bytes of a corrupt store file:
 * `<source>.corrupt-<timestamp>-<random>`.
 *
 * The timestamp is millisecond-resolution and exists for humans triaging a
 * capture. On its own it is NOT unique — two corruption events in the same
 * millisecond would target the same path, and both rename() and copyFile()
 * silently replace an existing destination, destroying the first capture.
 * The random suffix keeps every capture distinct.
 */
export function corruptAsidePath(source: string): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
  return `${source}.corrupt-${stamp}-${randomUUID().slice(0, 8)}`;
}
