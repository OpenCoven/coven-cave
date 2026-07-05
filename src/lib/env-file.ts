import { readFileSync } from "node:fs";
import path from "node:path";
import { covenHome } from "./coven-paths.ts";

/**
 * Path to the writable `.env.local` that holds user-saved secrets (today, the
 * GitHub PAT + username from the in-app form).
 *
 * In packaged desktop builds the server runs with its cwd inside the read-only,
 * code-signed `.app` bundle. Writing `.env.local` there mutates the bundle and
 * breaks its signature seal, which makes Gatekeeper reject the app and stops the
 * in-place auto-updater (same class of bug fixed for the Next cache, workflows,
 * and the vault map). So in bundle mode it resolves to a writable per-user file
 * under `<covenHome>/cave/`.
 *
 * Resolution (first hit wins): `COVEN_CAVE_ENV_FILE` → bundle path → `<cwd>/.env.local`.
 */
export function envLocalPath(): string {
  const override = process.env.COVEN_CAVE_ENV_FILE?.trim();
  if (override) return override;
  if (process.env.COVEN_CAVE_BUNDLE === "1") return path.join(covenHome(), "cave", ".env.local");
  return path.join(process.cwd(), ".env.local");
}

/**
 * Parse `.env.local` into a key→value record in one file read.
 *
 * Uses the same minimal `.env` parsing as {@link readEnvLocalValue}. Useful
 * when multiple keys need to be looked up in a single call (e.g. iterating
 * over all vault entries) to avoid O(N) file reads.
 */
export function readEnvLocalAll(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(envLocalPath(), "utf8");
  } catch {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }
  return result;
}

/**
 * Read a single key's value from the writable `.env.local`, or undefined.
 *
 * In dev, Next auto-loads `<cwd>/.env.local` into `process.env` at boot, so
 * secret resolution hits the env first and never needs this. In packaged builds
 * the file lives outside the bundle (see {@link envLocalPath}) where Next does
 * NOT auto-load it, so resolution falls back to reading it directly. Minimal
 * `.env` parsing — matches the unquoted `KEY=value` lines {@link upsertEnvContent}
 * writes, but tolerates surrounding quotes.
 */
export function readEnvLocalValue(key: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(envLocalPath(), "utf8");
  } catch {
    return undefined;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

/**
 * Surgical `.env`-style upsert. The previous PAT route parsed `.env.local` into
 * a map and rewrote the whole file from scratch, which dropped comments, blank
 * lines, and key ordering, and stripped quotes from unrelated values. This
 * edits in place: existing keys are replaced where they sit, new keys are
 * appended, a `null` value deletes its key, and every other line is preserved
 * byte-for-byte.
 */
export function upsertEnvContent(existing: string, updates: Record<string, string | null>): string {
  const lines = existing === "" ? [] : existing.split("\n");
  // Drop a single trailing empty line (from a trailing newline) so appended
  // keys don't get separated by a blank gap; we re-add the newline at the end.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const remaining = new Map(Object.entries(updates));
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const eq = line.indexOf("=");
    // Preserve comments, blanks, and non `key=value` lines untouched.
    if (!trimmed || trimmed.startsWith("#") || eq < 0) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!remaining.has(key)) {
      out.push(line);
      continue;
    }
    const val = remaining.get(key)!;
    remaining.delete(key);
    if (val === null) continue; // delete: drop this line
    out.push(`${key}=${val}`);
  }

  // Append keys that weren't already present (skip deletes for absent keys).
  for (const [key, val] of remaining) {
    if (val === null) continue;
    out.push(`${key}=${val}`);
  }

  return out.length ? out.join("\n") + "\n" : "";
}
