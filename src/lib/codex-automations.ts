/**
 * codex-automations.ts — read + patch Codex automation TOML files.
 *
 * TOML is handled with a minimal line-level approach (no external dep):
 *   - Reads key = "value" / key = 'value' / key = BARE pairs.
 *   - Patching replaces recognized top-level keys inline.
 *   - Multiline values (''') are treated as opaque blobs and preserved.
 *
 * Files live at:  ~/.codex/automations/<id>/automation.toml
 */

import { readdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type {
  AutomationStatus,
  CodexAutomation,
  CodexAutomationPatch,
  CodexAutomationRecord,
} from "./codex-automations-types";

export type { AutomationStatus, CodexAutomation, CodexAutomationPatch };

const AUTOMATIONS_DIR = path.join(homedir(), ".codex", "automations");

// ── TOML minimal parser ──────────────────────────────────────────────────────

function parseTomlString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Multiline literal string: key = '''content can start here
    const mlMatch = line.match(/^\s*(\w[\w-]*)\s*=\s*'''(.*)$/);
    if (mlMatch) {
      const key = mlMatch[1];
      const first = mlMatch[2] ?? "";
      const parts: string[] = [];
      if (first.endsWith("'''")) {
        result[key] = first.slice(0, -3);
        i++;
        continue;
      }
      parts.push(first);
      i++;
      while (i < lines.length) {
        const current = lines[i];
        if (current.endsWith("'''")) {
          parts.push(current.slice(0, -3));
          i++;
          break;
        }
        parts.push(current);
        i++;
      }
      result[key] = parts.join("\n");
      continue;
    }
    // Normal key = "value" or key = 'value' or key = bare
    const match = line.match(/^\s*(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*))$/);
    if (match) {
      const key = match[1];
      const val = match[2] !== undefined
        ? unescapeTomlBasicString(match[2])
        : match[3] ?? (match[4] ?? "").trim();
      result[key] = val;
    }
    i++;
  }
  return result;
}

function unescapeTomlBasicString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  // ["a", "b", "c"] or [a, b, c]
  const inner = raw.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function escapeTomlBasicString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function tomlString(value: string): string {
  return `"${escapeTomlBasicString(value)}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlPrompt(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/'''/g, "''\\'");
  return `'''${normalized.replace(/\n*$/g, "")}\n'''`;
}

function humanRrule(rrule: string | null): string {
  if (!rrule) return "Scheduled";
  // RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=30;BYDAY=MO,TU,WE,TH,FR
  const freq = rrule.match(/FREQ=(\w+)/)?.[1];
  const days = rrule.match(/BYDAY=([^;]+)/)?.[1];
  const hour = rrule.match(/BYHOUR=(\d+)/)?.[1];
  const min  = rrule.match(/BYMINUTE=(\d+)/)?.[1];

  const WEEKDAY: Record<string, string> = {
    MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
  };

  const timeStr = hour !== undefined
    ? `${hour.padStart(2, "0")}:${(min ?? "0").padStart(2, "0")}`
    : null;

  if (freq === "WEEKLY") {
    const dayStr = days
      ? days.split(",").map((d) => WEEKDAY[d] ?? d).join("/")
      : "Daily";
    return timeStr ? `${dayStr} at ${timeStr}` : dayStr;
  }
  if (freq === "DAILY") {
    return timeStr ? `Daily at ${timeStr}` : "Daily";
  }
  return rrule;
}

// ── Patch status in TOML preserving file structure ────────────────────────────

export function patchTomlStatus(raw: string, newStatus: AutomationStatus): string {
  return patchTomlAutomationFields(raw, { status: newStatus });
}

function replaceTomlKey(raw: string, key: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  const next: string[] = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^(\s*)(\w[\w-]*)\s*=/);
    if (keyMatch?.[2] !== key) {
      next.push(line);
      continue;
    }

    next.push(`${keyMatch[1]}${key} = ${value}`);
    replaced = true;

    if (/^\s*\w[\w-]*\s*=\s*'''/.test(line) && !line.trimEnd().endsWith("'''")) {
      while (i + 1 < lines.length) {
        i++;
        if (lines[i].trimEnd().endsWith("'''")) break;
      }
    }
  }

  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${key} = ${value}`);
  }

  return next.join("\n");
}

export function patchTomlAutomationFields(
  raw: string,
  patch: CodexAutomationPatch,
): string {
  const entries: [keyof CodexAutomationPatch, string, (value: never) => string][] = [
    ["name", "name", tomlString as (value: never) => string],
    ["prompt", "prompt", tomlPrompt as (value: never) => string],
    ["status", "status", tomlString as (value: never) => string],
    ["rrule", "rrule", tomlString as (value: never) => string],
    ["model", "model", tomlString as (value: never) => string],
    ["reasoning_effort", "reasoning_effort", tomlString as (value: never) => string],
    ["execution_environment", "execution_environment", tomlString as (value: never) => string],
    ["cwds", "cwds", tomlStringArray as (value: never) => string],
    ["tags", "tags", tomlStringArray as (value: never) => string],
    ["skill_path", "skill_path", tomlString as (value: never) => string],
  ];

  let next = raw;
  for (const [patchKey, tomlKey, formatter] of entries) {
    const value = patch[patchKey];
    if (value === undefined) continue;
    next = replaceTomlKey(next, tomlKey, formatter(value as never));
  }
  return next;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function toCodexAutomationPayload(auto: CodexAutomationRecord): CodexAutomation {
  const { tomlPath: _tomlPath, ...payload } = auto;
  return payload;
}

// Serialize read-modify-write sequences against automation TOMLs. Multiple
// route handlers may patch the same file concurrently when the UI autosaves or
// toggles status; the chain prevents last-writer-wins clobbering.
declare global {
  // eslint-disable-next-line no-var
  var __codexAutomationWriteChain: Promise<unknown> | undefined;
}

function withCodexAutomationLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__codexAutomationWriteChain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__codexAutomationWriteChain = next.catch(() => undefined);
  return next;
}

export async function listCodexAutomations(): Promise<CodexAutomationRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(AUTOMATIONS_DIR);
  } catch {
    return [];
  }

  const results: CodexAutomationRecord[] = [];

  for (const entry of entries.sort()) {
    const tomlPath = path.join(AUTOMATIONS_DIR, entry, "automation.toml");
    try {
      await access(tomlPath);
      const raw = await readFile(tomlPath, "utf8");
      const kv = parseTomlString(raw);

      const id = kv["id"] ?? entry;
      const name = kv["name"] ?? id;
      const status: AutomationStatus = kv["status"] === "ACTIVE" ? "ACTIVE" : "PAUSED";
      const rrule = kv["rrule"] ?? null;

      results.push({
        id,
        name,
        kind: kv["kind"] ?? "cron",
        status,
        rrule,
        model: kv["model"] ?? null,
        reasoningEffort: kv["reasoning_effort"] ?? null,
        executionEnvironment: kv["execution_environment"] ?? null,
        cwds: parseTags(kv["cwds"] ?? ""),
        tags: parseTags(kv["tags"] ?? ""),
        prompt: kv["prompt"] ?? "",
        skillPath: kv["skill_path"] ?? null,
        scheduleHuman: humanRrule(rrule),
        tomlPath,
      });
    } catch {
      // skip dirs without a valid toml
    }
  }

  return results;
}

export async function getCodexAutomation(id: string): Promise<CodexAutomationRecord | null> {
  const list = await listCodexAutomations();
  return list.find((a) => a.id === id) ?? null;
}

export async function setCodexAutomationStatus(
  id: string,
  status: AutomationStatus,
): Promise<CodexAutomationRecord | null> {
  return updateCodexAutomation(id, { status });
}

export async function updateCodexAutomation(
  id: string,
  patch: CodexAutomationPatch,
): Promise<CodexAutomationRecord | null> {
  return withCodexAutomationLock(async () => {
    const auto = await getCodexAutomation(id);
    if (!auto) return null;

    const raw = await readFile(auto.tomlPath, "utf8");
    const patched = patchTomlAutomationFields(raw, patch);
    await writeFile(auto.tomlPath, patched, "utf8");

    return getCodexAutomation(id);
  });
}
