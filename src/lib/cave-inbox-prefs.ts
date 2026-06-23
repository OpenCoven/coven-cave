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

export async function patchPrefs(
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

export async function toggleMute(familiarId: string): Promise<InboxPrefs> {
  const current = await loadPrefs();
  const muted = new Set(current.mutedFamiliars);
  if (muted.has(familiarId)) muted.delete(familiarId);
  else muted.add(familiarId);
  return patchPrefs({ mutedFamiliars: Array.from(muted) });
}

export { PREFS_PATH };
