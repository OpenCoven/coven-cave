// Persists the desktop's active theme + resolved color tokens to
// ~/.coven/cave-theme.json so other clients (the iOS app over Tailscale)
// can read it from GET /api/theme. Fixed filename — no user-controlled path.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const THEME_PATH = path.join(homedir(), ".coven", "cave-theme.json");

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
  await mkdir(path.dirname(THEME_PATH), { recursive: true });
  const tmp = THEME_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(snap, null, 2), "utf8");
  await rename(tmp, THEME_PATH);
  return snap;
}
