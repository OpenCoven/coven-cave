import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { CovenantAutomationDraft } from "../coven-automations-types.ts";

const LIMIT = 1024 * 1024;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const uncertain = () => Object.assign(new Error("The retained journal request cannot be reconciled safely."), { uncertain: true });

/** Keep server-derived prompt inputs with the caller's adoption key. These
 * records are requests, not execution state, and reading one never dispatches.
 * An atomic hard-link publishes one complete first-writer-wins record, so two
 * workers cannot send different prepared commands under the same key. */
export async function retainedJournalDefinition(directory: string, adoptionKey: string, input: unknown,
  prepare: () => Promise<CovenantAutomationDraft>): Promise<CovenantAutomationDraft> {
  const root = path.join(/* turbopackIgnore: true */ await realpath(/* turbopackIgnore: true */ directory), ".cave-command-intents");
  await mkdir(root, { mode: 0o700, recursive: true });
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw uncertain();
  const file = path.join(/* turbopackIgnore: true */ root, `${digest(adoptionKey)}.json`);
  const inputDigest = digest(JSON.stringify(input));
  const read = async (): Promise<CovenantAutomationDraft | undefined> => {
    let handle;
    try { handle = await open(/* turbopackIgnore: true */ file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw uncertain(); }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > LIMIT) throw uncertain();
      const buffer = Buffer.alloc(LIMIT + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > LIMIT) throw uncertain();
      const record = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      if (record.version !== 1 || record.inputDigest !== inputDigest || !record.definition || typeof record.definition !== "object") throw uncertain();
      return record.definition;
    } catch { throw uncertain(); } finally { await handle.close(); }
  };
  const prior = await read();
  if (prior) return prior;
  const definition = await prepare();
  const bytes = JSON.stringify({ version: 1, inputDigest, definition });
  if (Buffer.byteLength(bytes) > LIMIT) throw uncertain();
  const temporary = path.join(/* turbopackIgnore: true */ root, `.prepare-${randomUUID()}`);
  const handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  try { await link(temporary, file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  finally { await unlink(temporary); }
  const retained = await read();
  if (!retained) throw uncertain();
  return retained;
}
