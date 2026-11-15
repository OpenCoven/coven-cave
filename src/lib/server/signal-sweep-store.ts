import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.ts";
import { createKeyedTransactionLock } from "./keyed-transaction-lock.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

type Receipt = { key: string; revision: string; requestId: string; status: "reserved" | "requested" };
type Entry = Receipt & { previous?: Entry };
const withTransaction = createKeyedTransactionLock();
export const DUPLICATE_SIGNAL_SWEEP = "This signal already has a requested fix. Review that thread first. After fixing its prerequisite, explicitly retry the fix; a new report does not start another sweep.";
function validEntry(value: unknown, depth = 0): value is Entry {
  if (depth > 16 || !value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.key === "string" && /^[a-f0-9]{64}$/.test(entry.key)
    && typeof entry.revision === "string" && typeof entry.requestId === "string"
    && (entry.status === "reserved" || entry.status === "requested")
    && (entry.previous === undefined || (validEntry(entry.previous, depth + 1) && entry.previous.key === entry.key));
}

/** Retain unresolved signal identities across reports, remounts and windows.
 * Only hashes and request receipts are stored, never report prose or prompts.
 * An uncertain handoff stays reserved; time passing is not proof it failed. */
export function createSignalSweepStore(file: string) {
  const locked = <T>(operation: (entries: Entry[]) => Promise<T>) => withTransaction(file, () =>
    withProcessIntentLock({ intentsDirectory: `${file}.intents`, label: "signal fix requests" }, async () => {
      let entries: Entry[];
      try {
        const parsed: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
        if (!Array.isArray(parsed) || !parsed.every((entry) => validEntry(entry))) {
          throw new Error("Signal fix receipts could not be read. Review the existing threads before retrying.");
        }
        entries = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        entries = [];
      }
      return operation(entries);
    }));
  const save = async (entries: Entry[]) => {
    await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, entries);
  };
  return {
    prepare(familiarId: string, identities: readonly string[], revision: string, expectedPrevious: Readonly<Record<string, string>> = {}) {
      return locked(async (entries) => {
        const keyed = [...new Set(identities)].map((identity) => ({ identity,
          key: createHash("sha256").update(JSON.stringify([familiarId, identity])).digest("hex") }));
        const receipts = Object.fromEntries(keyed.flatMap(({ key, identity }) => {
          const previous = entries.find((entry) => entry.key === key);
          return previous ? [[identity, previous.requestId]] : [];
        }));
        const accepted = keyed.filter(({ key, identity }) => {
          const previous = entries.find((entry) => entry.key === key);
          return !previous || expectedPrevious[identity] === previous.requestId;
        });
        if (!accepted.length) {
          const uncertain = keyed.some(({ key }) => entries.some((entry) => entry.key === key && entry.status === "reserved"));
          return { ok: false as const, error: uncertain
            ? "A signal fix request is awaiting confirmation. Review the Chat panel first. After checking its delivery and fixing its prerequisite, explicitly retry the fix."
            : DUPLICATE_SIGNAL_SWEEP, receipts };
        }
        const keys = new Set(accepted.map((entry) => entry.key));
        const next = entries.filter((entry) => !keys.has(entry.key));
        const requestId = randomUUID();
        next.push(...accepted.map(({ key }): Entry => {
          const previous = entries.find((entry) => entry.key === key);
          return { key, revision, requestId, status: "reserved", ...(previous ? { previous } : {}) };
        }));
        if (!next.every((entry) => validEntry(entry))) throw new Error("Too many unconfirmed retries. Review the existing fix threads before retrying again.");
        await save(next);
        return { ok: true as const, requestId, accepted: accepted.map(({ identity }) => identity),
          receipts: { ...receipts, ...Object.fromEntries(accepted.map(({ identity }) => [identity, requestId])) } };
      });
    },
    commit(requestId: string) {
      return locked(async (entries) => { await save(entries.map((entry) => entry.requestId === requestId
        ? { key: entry.key, revision: entry.revision, requestId, status: "requested" } : entry)); });
    },
    /** Only a synchronous rejected handoff proves nothing was dispatched. */
    release(requestId: string) {
      return locked(async (entries) => { await save(entries.flatMap((entry) => {
        if (entry.requestId !== requestId || entry.status !== "reserved") return [entry];
        return entry.previous ? [entry.previous] : [];
      })); });
    },
  };
}
