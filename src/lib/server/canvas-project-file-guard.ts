import { createHash } from "node:crypto";

export type StableProjectFileRead =
  | { ok: true; originalCode: string }
  | { ok: false; reason: "stale" | "changed_during_apply" };

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Compare twice around preparation so a stale checkout or a concurrent edit
 * cannot be mistaken for the exact GitHub content imported into Canvas.
 */
export async function readStableProjectFile(
  readText: () => Promise<string>,
  expectedHash: string,
): Promise<StableProjectFileRead> {
  const originalCode = await readText();
  if (sha256Text(originalCode) !== expectedHash) return { ok: false, reason: "stale" };
  const currentCode = await readText();
  if (sha256Text(currentCode) !== expectedHash) {
    return { ok: false, reason: "changed_during_apply" };
  }
  return { ok: true, originalCode };
}
