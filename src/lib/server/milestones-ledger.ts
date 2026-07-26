import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import type { MilestoneAward } from "../milestone-defs.ts";

/**
 * The renown ledger — which milestones have ever been awarded, so each fires
 * at most once. Awarding is append-only: milestones celebrate what happened,
 * and what happened doesn't un-happen (a broken streak is simply not
 * re-awarded until the next genuine crossing of a *new* key).
 */

const LEDGER_PATH = () => path.join(caveHome(), "milestones.json");

type LedgerFile = {
  version: 1;
  /** key → ISO timestamp of the award. */
  awarded: Record<string, string>;
};

// Serialize read-modify-write like withInboxLock / withPrefsLock: two
// concurrent POSTs (e.g. two open windows both noticing the same crossing)
// must not double-award. Attached to globalThis to survive dev hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __milestonesWriteChain: Promise<unknown> | undefined;
}

function withLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__milestonesWriteChain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__milestonesWriteChain = next.catch(() => undefined);
  return next;
}

export async function loadLedger(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(LEDGER_PATH(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LedgerFile>;
    if (parsed && typeof parsed.awarded === "object" && parsed.awarded !== null) {
      const out: Record<string, string> = {};
      for (const [key, at] of Object.entries(parsed.awarded)) {
        if (typeof at === "string") out[key] = at;
      }
      return out;
    }
  } catch {
    // Missing or unreadable ledger reads as empty — first run.
  }
  return {};
}

export type AwardResult = {
  /** Awards that were new this call (already-ledgered keys are dropped). */
  newly: MilestoneAward[];
  /** True when the ledger held nothing before this call. */
  firstRun: boolean;
};

/** Record awards idempotently; returns only the keys that were actually new. */
export async function recordAwards(awards: MilestoneAward[]): Promise<AwardResult> {
  return withLedgerLock(async () => {
    const awarded = await loadLedger();
    const firstRun = Object.keys(awarded).length === 0;
    const now = new Date().toISOString();
    const newly: MilestoneAward[] = [];
    for (const award of awards) {
      if (awarded[award.key]) continue;
      awarded[award.key] = now;
      newly.push(award);
    }
    if (newly.length > 0) {
      await mkdir(path.dirname(LEDGER_PATH()), { recursive: true });
      await writeJsonAtomic(LEDGER_PATH(), { version: 1, awarded } satisfies LedgerFile);
    }
    return { newly, firstRun };
  });
}
