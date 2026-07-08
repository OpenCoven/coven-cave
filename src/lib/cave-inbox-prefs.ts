import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./server/atomic-write.ts";

const PREFS_PATH = path.join(homedir(), ".coven", "cave-inbox-prefs.json");

export type SoundMode = "default" | "silent" | "named";

export type InboxPrefs = {
  version: number;
  mutedFamiliars: string[];
  sound: { mode: SoundMode; name?: string };
};

const EMPTY: InboxPrefs = {
  version: 1,
  mutedFamiliars: [],
  sound: { mode: "default" },
};

async function ensureDir() {
  await mkdir(path.dirname(PREFS_PATH), { recursive: true });
}

// Serialize prefs read-modify-write. Two concurrent PATCHes (e.g. a mute toggle
// from two surfaces, or rapid toggles outracing the disk write) each did an
// unlocked load→merge→save, so the last writer silently dropped the other's
// change. This promise-chain (mirroring withInboxLock in cave-inbox.ts) runs each
// mutation to completion before the next starts. Attached to globalThis so the
// chain survives Next.js dev hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __inboxPrefsWriteChain: Promise<unknown> | undefined;
}

function withPrefsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__inboxPrefsWriteChain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__inboxPrefsWriteChain = next.catch(() => undefined);
  return next;
}

export async function loadPrefs(): Promise<InboxPrefs> {
  try {
    const raw = await readFile(PREFS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<InboxPrefs>;
    return {
      version: parsed.version ?? 1,
      mutedFamiliars: Array.isArray(parsed.mutedFamiliars)
        ? parsed.mutedFamiliars.filter((s): s is string => typeof s === "string")
        : [],
      sound:
        parsed.sound && typeof parsed.sound === "object"
          ? {
              mode: ((["default", "silent", "named"] as SoundMode[]).includes(
                parsed.sound.mode as SoundMode,
              )
                ? parsed.sound.mode
                : "default") as SoundMode,
              name:
                typeof parsed.sound.name === "string" ? parsed.sound.name : undefined,
            }
          : { mode: "default" },
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function savePrefs(prefs: InboxPrefs): Promise<void> {
  await ensureDir();
  await writeJsonAtomic(PREFS_PATH, prefs);
}

// The actual load→merge→save. Must run under withPrefsLock — never call it
// directly (except from another already-locked mutator, to avoid re-entrant
// deadlock on the single-acquisition chain).
async function patchPrefsUnlocked(
  patch: Partial<Omit<InboxPrefs, "version">>,
): Promise<InboxPrefs> {
  const current = await loadPrefs();
  const next: InboxPrefs = {
    ...current,
    ...patch,
    version: 1,
    sound: patch.sound ? { ...current.sound, ...patch.sound } : current.sound,
    mutedFamiliars: patch.mutedFamiliars
      ? Array.from(new Set(patch.mutedFamiliars.filter(Boolean)))
      : current.mutedFamiliars,
  };
  await savePrefs(next);
  return next;
}

export function patchPrefs(
  patch: Partial<Omit<InboxPrefs, "version">>,
): Promise<InboxPrefs> {
  return withPrefsLock(() => patchPrefsUnlocked(patch));
}

export function toggleMute(familiarId: string): Promise<InboxPrefs> {
  // The read of the current muted set and the write MUST be one atomic unit, or
  // two concurrent toggles both read the same set and one flip is lost. Take the
  // lock once and use the unlocked patch inside it (calling the exported
  // patchPrefs here would deadlock on the same single-acquisition chain).
  return withPrefsLock(async () => {
    const current = await loadPrefs();
    const muted = new Set(current.mutedFamiliars);
    if (muted.has(familiarId)) muted.delete(familiarId);
    else muted.add(familiarId);
    return patchPrefsUnlocked({ mutedFamiliars: Array.from(muted) });
  });
}

export { PREFS_PATH };
