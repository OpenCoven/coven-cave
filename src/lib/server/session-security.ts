import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";

export const MAX_SESSION_JSON_BYTES = 70 * 1024;
export const MAX_PROMPT_CHARS = 64 * 1024;
export const MAX_INPUT_CHARS = 64 * 1024;

const ALLOWED_HARNESSES = new Set(COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id));
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeProjectRoot(value: unknown): string | null {
  if (value !== undefined && typeof value !== "string") return null;
  const rawRoot = value ?? process.cwd();
  if (rawRoot.length > 4096) return null;
  const normalized =
    process.platform === "win32" && /^[a-zA-Z]:$/.test(rawRoot)
      ? rawRoot + "\\"
      : rawRoot;
  return resolveAllowedProjectPath(normalized);
}

export function isAllowedHarness(value: string): boolean {
  return ALLOWED_HARNESSES.has(value);
}

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export function boundedString(value: unknown, maxChars: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  return value.length <= maxChars ? value : null;
}

export function boundedInt(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}
