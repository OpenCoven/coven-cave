import { randomBytes } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import {
  applyPreferencesPatch,
  createDefaultPreferences,
  legacyStorageToPreferencesPatch,
  normalizeCavePreferences,
  sanitizeThemeTokens,
  validatePreferencesPatch,
  type CavePreferences,
  type CavePreferencesPatch,
  type CustomThemeData,
} from "@/lib/preferences-schema";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import { withCaveHomeReconciledStore } from "./cave-home-migration.ts";

export function preferencesPath(): string {
  const override = process.env.COVEN_PREFERENCES_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "preferences.json");
}

function legacyThemePath(): string {
  const override = process.env.COVEN_THEME_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "theme.json");
}

type DiskState = "valid" | "missing" | "malformed";
type DiskRead = { preferences: CavePreferences; state: DiskState };

async function readPreferencesFile(): Promise<DiskRead> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ preferencesPath(), "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== 1 ||
      (parsed as { initialized?: unknown }).initialized !== true
    ) {
      return { preferences: createDefaultPreferences(false), state: "malformed" };
    }
    return { preferences: normalizeCavePreferences(parsed), state: "valid" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    return {
      preferences: createDefaultPreferences(false),
      state: code === "ENOENT" ? "missing" : "malformed",
    };
  }
}

async function readLegacyThemeSeed(): Promise<CavePreferencesPatch | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ legacyThemePath(), "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const legacyPatch = legacyStorageToPreferencesPatch({
      "coven-theme": parsed.themeId,
      "coven-mode": parsed.mode,
    });
    const theme = legacyPatch.appearance?.theme;
    if (!theme || (!theme.id && !theme.modePreference)) return null;

    const tokens = sanitizeThemeTokens(parsed.tokens);
    const mode = parsed.mode === "light" ? "light" : "dark";
    theme.resolvedMode = mode;
    theme.tokens = tokens;
    if (theme.id === "custom" && Object.keys(tokens).length > 0) {
      const custom: CustomThemeData = {
        name: "Recovered custom theme",
        cssVars: { [mode]: tokens },
      };
      theme.custom = custom;
    }
    return validatePreferencesPatch(legacyPatch);
  } catch {
    return null;
  }
}

async function preserveMalformedFile(): Promise<void> {
  const source = preferencesPath();
  const suffix = new Date().toISOString().replace(/[^0-9]/g, "");
  await copyFile(/* turbopackIgnore: true */ source, `${source}.corrupt-${suffix}`).catch(() => {});
}

async function writePreferences(preferences: CavePreferences): Promise<void> {
  const target = preferencesPath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeJsonAtomic(/* turbopackIgnore: true */ target, preferences);
}

async function loadPreferencesUnlocked(options: { seedLegacy: boolean }): Promise<DiskRead> {
  const disk = await readPreferencesFile();
  if (disk.state === "valid" || !options.seedLegacy) return disk;

  const legacy = await readLegacyThemeSeed();
  if (!legacy) return disk;

  const seeded = applyPreferencesPatch(createDefaultPreferences(false), legacy);
  // Keep this provisional so the current browser origin still gets one chance
  // to merge its richer legacy prefs (fonts, reading, backdrop, news, etc.). A
  // fresh random-port origin has no such values, but can still use this theme
  // fallback for its first paint. The first explicit PATCH initializes/writes.
  seeded.initialized = false;
  seeded.revision = 0;
  seeded.updatedAt = "";
  seeded.appearance.theme.selectionRevision = 0;
  seeded.appearance.theme.updatedAt = "";
  return { preferences: seeded, state: disk.state };
}

declare global {
  // eslint-disable-next-line no-var
  var __cavePreferencesWriteChain: Promise<unknown> | undefined;
}

function withPreferencesLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.__cavePreferencesWriteChain ?? Promise.resolve();
  const next = previous.then(operation, operation);
  globalThis.__cavePreferencesWriteChain = next.catch(() => undefined);
  return next;
}

const FILE_LOCK_TIMEOUT_MS = 15_000;
const ORPHAN_INTENT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const TRANSIENT_REMOVE_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

async function removeIntent(pathname: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(/* turbopackIgnore: true */ pathname, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_REMOVE_ERRORS.has(code) || attempt >= 6) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, 2 ** (attempt + 1))));
    }
  }
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function intentPid(name: string): number | null {
  const match = /^\d{24}-(\d+)-[a-f0-9]+\.lock$/.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Serialize read-modify-write cycles across overlapping Cave sidecar processes.
 * Atomic rename prevents torn JSON, but without this lock two processes can
 * both read revision N and the later rename can discard the other's disjoint
 * patch. Each contender owns a unique intent file ordered by the OS monotonic
 * clock. Only the oldest live intent enters. A process removes only its own
 * path, so stale recovery and release can never unlink a successor's lock.
 */
async function acquirePreferencesFileLock(): Promise<() => Promise<void>> {
  const target = preferencesPath();
  const intentsDir = `${target}.locks`;
  // Lock files coordinate runtime sidecars in the user's data directory; they
  // must not become inputs to standalone output-file tracing.
  await mkdir(/* turbopackIgnore: true */ intentsDir, { recursive: true });
  const order = process.hrtime.bigint().toString().padStart(24, "0");
  const ownName = `${order}-${process.pid}-${randomBytes(8).toString("hex")}.lock`;
  const ownPath = path.join(/* turbopackIgnore: true */ intentsDir, ownName);
  const handle = await open(/* turbopackIgnore: true */ ownPath, "wx", 0o600);
  try {
    await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
  } finally {
    await handle.close();
  }
  const deadline = Date.now() + FILE_LOCK_TIMEOUT_MS;

  try {
    while (true) {
      const names = (await readdir(/* turbopackIgnore: true */ intentsDir)).filter((name) => intentPid(name) !== null).sort();
      for (const name of names) {
        if (name === ownName) continue;
        const pid = intentPid(name)!;
        const candidate = path.join(/* turbopackIgnore: true */ intentsDir, name);
        let tooOld = false;
        try {
          tooOld = Date.now() - (await stat(/* turbopackIgnore: true */ candidate)).mtimeMs > ORPHAN_INTENT_MAX_AGE_MS;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        // The process-local promise chain guarantees an older intent carrying
        // our own PID is an orphan from a previously failed cleanup.
        if (pid === process.pid || !processIsAlive(pid) || tooOld) {
          await removeIntent(candidate);
        }
      }

      const remaining = (await readdir(/* turbopackIgnore: true */ intentsDir))
        .filter((name) => intentPid(name) !== null)
        .sort();
      if (remaining[0] === ownName) {
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await removeIntent(ownPath);
        };
      }

      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for preferences lock: ${intentsDir}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 20)));
    }
  } catch (error) {
    try {
      await removeIntent(ownPath);
    } catch {
      // Preserve the original acquisition error; the same-PID orphan cleanup
      // above will remove this unique intent before the next local attempt.
    }
    throw error;
  }
}

/** Load the canonical snapshot, seeding it once from cave-theme.json when possible. */
export function loadPreferences(): Promise<CavePreferences> {
  return withPreferencesLock(() => withCaveHomeReconciledStore(
    "cave-preferences.json",
    async () => (await loadPreferencesUnlocked({ seedLegacy: true })).preferences,
  ));
}

export class PreferencesConflictError extends Error {
  readonly current: CavePreferences;

  constructor(message: string, current: CavePreferences) {
    super(message);
    this.name = "PreferencesConflictError";
    this.current = current;
  }
}

/**
 * Run a conditional mutation under the same lock as every other preference
 * write. Returning null is a no-op and returns the current snapshot.
 */
export function updatePreferences(
  mutator: (current: CavePreferences) => CavePreferencesPatch | null | Promise<CavePreferencesPatch | null>,
): Promise<CavePreferences> {
  return withPreferencesLock(() => withCaveHomeReconciledStore("cave-preferences.json", async () => {
    const release = await acquirePreferencesFileLock();
    try {
      const disk = await loadPreferencesUnlocked({ seedLegacy: true });
      const rawPatch = await mutator(disk.preferences);
      if (rawPatch === null) return disk.preferences;
      const patch = validatePreferencesPatch(rawPatch);
      const next = applyPreferencesPatch(disk.preferences, patch);
      if (next.revision === disk.preferences.revision && next.initialized === disk.preferences.initialized) {
        return disk.preferences;
      }
      if (disk.state === "malformed") await preserveMalformedFile();
      await writePreferences(next);
      return next;
    } finally {
      await release();
    }
  }));
}

export function patchPreferences(patch: CavePreferencesPatch): Promise<CavePreferences> {
  const validated = validatePreferencesPatch(patch);
  return updatePreferences(() => validated);
}
