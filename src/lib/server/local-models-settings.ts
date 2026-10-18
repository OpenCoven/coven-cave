// Saved Settings for Codex local mode (#6049): which Ollama and LM Studio
// servers this machine's chats use, and whether a server on another computer
// is allowed at all.
//
// The file lives in Cave's home on the machine that runs the harness, beside
// the rest of Cave's per-machine state. The API route lets only a request
// from this machine change it, so a paired phone can read where inference
// happens but never redirect it.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import type { LocalCodexBackend } from "../local-codex.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

export type LocalModelSettings = {
  /** A saved base URL per backend; a missing entry means the backend default. */
  endpoints: Partial<Record<LocalCodexBackend, string>>;
  /** Allow a server on another computer. Off unless someone turns it on. */
  allowRemote: boolean;
};

export const EMPTY_LOCAL_MODEL_SETTINGS: LocalModelSettings = Object.freeze({
  endpoints: Object.freeze({}),
  allowRemote: false,
}) as LocalModelSettings;

const BACKENDS: readonly LocalCodexBackend[] = ["ollama", "lmstudio"];
const MAX_ENDPOINT_LENGTH = 2_048;

export function localModelSettingsPath(): string {
  return path.join(caveHome(), "local-models.json");
}

/** Keep only the fields this version understands. Values are validated again
 * where they are used, so a hand-edited file cannot widen what a chat reaches. */
export function normalizeLocalModelSettings(value: unknown): LocalModelSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_LOCAL_MODEL_SETTINGS;
  const record = value as Record<string, unknown>;
  const endpoints: Partial<Record<LocalCodexBackend, string>> = {};
  const saved = typeof record.endpoints === "object" && record.endpoints !== null ? record.endpoints as Record<string, unknown> : {};
  for (const backend of BACKENDS) {
    const endpoint = saved[backend];
    if (typeof endpoint === "string" && endpoint.trim() && endpoint.length <= MAX_ENDPOINT_LENGTH) {
      endpoints[backend] = endpoint.trim();
    }
  }
  return { endpoints, allowRemote: record.allowRemote === true };
}

/** The saved settings, or the defaults when nothing is saved or the file is unreadable. */
export async function readLocalModelSettings(): Promise<LocalModelSettings> {
  let text: string;
  try {
    text = await readFile(localModelSettingsPath(), "utf8");
  } catch {
    return EMPTY_LOCAL_MODEL_SETTINGS;
  }
  try {
    return normalizeLocalModelSettings(JSON.parse(text));
  } catch {
    return EMPTY_LOCAL_MODEL_SETTINGS;
  }
}

export async function writeLocalModelSettings(settings: LocalModelSettings): Promise<void> {
  const normalized = normalizeLocalModelSettings(settings);
  const file = localModelSettingsPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, { version: 1, ...normalized });
}

let updates: Promise<unknown> = Promise.resolve();

/**
 * Read, change and write the settings one change at a time, so two quick
 * saves from Settings cannot drop each other's edit. `change` returns the
 * settings to write, or null to leave the file alone, plus its own result.
 */
export function updateLocalModelSettings<R>(
  change: (current: LocalModelSettings) => { settings: LocalModelSettings | null; result: R },
): Promise<R> {
  const run = updates.then(async () => {
    const { settings, result } = change(await readLocalModelSettings());
    if (settings) await writeLocalModelSettings(settings);
    return result;
  });
  updates = run.catch(() => {});
  return run;
}
