// Persists the desktop's active theme + resolved color tokens to
// ~/.coven/cave-theme.json so other clients (the iOS app over Tailscale) can
// read it from GET /api/theme. The location is fixed in normal use, but
// COVEN_THEME_PATH overrides it so tests / E2E runs / any throwaway server never
// clobber a real user's theme (mirrors COVEN_AUTOMATION_RUNS_PATH). Not
// user-request-controlled — only the process environment can set it.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { homedir } from "node:os";

// Resolved at call-time so the env can be set before the first read/write.
function themePath(): string {
  return process.env.COVEN_THEME_PATH ?? path.join(homedir(), ".coven", "cave-theme.json");
}

export type ThemeSnapshot = {
  themeId: string;
  mode: string;
  tokens: Record<string, string>;
  updatedAt: string;
};

const DEFAULT_SNAPSHOT: ThemeSnapshot = { themeId: "coven", mode: "dark", tokens: {}, updatedAt: "" };

function sanitizeTokens(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof key === "string" && key.startsWith("--") && typeof value === "string" && value.length <= 64) {
      out[key] = value;
    }
  }
  return out;
}

export async function loadTheme(): Promise<ThemeSnapshot> {
  const THEME_PATH = themePath();
  try {
    const parsed = JSON.parse(await readFile(THEME_PATH, "utf8")) as Partial<ThemeSnapshot>;
    return {
      themeId: typeof parsed.themeId === "string" ? parsed.themeId : DEFAULT_SNAPSHOT.themeId,
      mode: typeof parsed.mode === "string" ? parsed.mode : DEFAULT_SNAPSHOT.mode,
      tokens: sanitizeTokens(parsed.tokens),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

export async function saveTheme(input: { themeId?: unknown; mode?: unknown; tokens?: unknown }): Promise<ThemeSnapshot> {
  const snap: ThemeSnapshot = {
    themeId: typeof input.themeId === "string" && input.themeId ? input.themeId : DEFAULT_SNAPSHOT.themeId,
    mode: typeof input.mode === "string" && input.mode ? input.mode : DEFAULT_SNAPSHOT.mode,
    tokens: sanitizeTokens(input.tokens),
    updatedAt: new Date().toISOString(),
  };
  const THEME_PATH = themePath();
  await mkdir(path.dirname(THEME_PATH), { recursive: true });
  // Unique temp name per write: a fixed `.tmp` made concurrent PUTs race —
  // both wrote the same file, the first rename consumed it, and the second
  // rename hit ENOENT, crashing the dev server. A per-write name lets parallel
  // saves each rename their own file (last writer wins) without colliding.
  const tmp = `${THEME_PATH}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(snap, null, 2), "utf8");
    await rename(tmp, THEME_PATH);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return snap;
}
