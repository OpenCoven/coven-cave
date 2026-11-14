import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { advanceFirstUse, createQuickStartState, parseFirstUseState, type FirstUseAction, type FirstUseState } from "../first-use.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { createKeyedTransactionLock } from "./keyed-transaction-lock.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";

const withFirstUseLock = createKeyedTransactionLock();
export class FirstUseRevisionError extends Error {
  constructor() { super("The introduction changed in another window. Reload it before continuing."); }
}

function firstUseFile(): string { return path.join(/* turbopackIgnore: true */ caveHome(), "first-use.json"); }

export async function readFirstUseState(file = firstUseFile()): Promise<FirstUseState> {
  let raw: string;
  try { raw = await readFile(/* turbopackIgnore: true */ file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createQuickStartState();
    throw error;
  }
  return parseFirstUseState(JSON.parse(raw));
}

export async function updateFirstUseState(revision: number, action: FirstUseAction, file = firstUseFile()): Promise<FirstUseState> {
  return withFirstUseLock(file, () => withProcessIntentLock({ intentsDirectory: `${file}.intents`, label: "introduction progress" }, async () => {
    const previous = await readFirstUseState(file);
    if (previous.revision !== revision) throw new FirstUseRevisionError();
    const next = advanceFirstUse(previous, action);
    await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, next);
    return next;
  }));
}
