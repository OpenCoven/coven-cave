/**
 * codex-automations.ts — read + patch Codex automation TOML files.
 *
 * TOML is handled with a minimal line-level approach (no external dep):
 *   - Reads key = "value" / key = 'value' / key = BARE pairs.
 *   - Patching sets exactly `status = "ACTIVE"` or `status = "PAUSED"` inline.
 *   - Multiline values (''') are treated as opaque blobs and preserved.
 *
 * Files live at:  ~/.codex/automations/<id>/automation.toml
 */

import { readdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export type AutomationStatus = "ACTIVE" | "PAUSED";

export type CodexAutomation = {
  id: string;
  name: string;
  kind: string;
  status: AutomationStatus;
  rrule: string | null;
  model: string | null;
  reasoningEffort: string | null;
  executionEnvironment: string | null;
  cwds: string[];
  tags: string[];
  prompt: string;
  skillPath: string | null;
  /** Parsed from rrule for display */
  scheduleHuman: string;
  tomlPath: string;
};

export type CodexAutomationPatch = {
  name?: string;
  prompt?: string;
  status?: AutomationStatus;
  rrule?: string;
  model?: string;
  reasoning_effort?: string;
  execution_environment?: string;
  cwds?: string[];
  tags?: string[];
  skill_path?: string;
};

const AUTOMATIONS_DIR = path.join(homedir(), ".codex", "automations");

// ── TOML minimal parser ──────────────────────────────────────────────────────

function parseTomlString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Multiline literal string: key = '''content can start here
    const mlMatch = line.match(/^(\w[\w-]*)\s*=\s*'''(.*)$/);
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
    const match = line.match(/^(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*))$/);
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
  const statusLine = /^status\s*=\s*"(ACTIVE|PAUSED)"/m;
  if (statusLine.test(raw)) {
    return raw.replace(statusLine, `status = "${newStatus}"`);
  }
  // Append if missing
  return raw.trimEnd() + `\nstatus = "${newStatus}"\n`;
}

function replaceTomlKey(raw: string, key: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  const next: string[] = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^(\w[\w-]*)\s*=/);
    if (keyMatch?.[1] !== key) {
      next.push(line);
      continue;
    }

    next.push(`${key} = ${value}`);
    replaced = true;

    if (/^\w[\w-]*\s*=\s*'''/.test(line) && !line.endsWith("'''")) {
      while (i + 1 < lines.length) {
        i++;
        if (lines[i].endsWith("'''")) break;
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

export async function listCodexAutomations(): Promise<CodexAutomation[]> {
  let entries: string[];
  try {
    entries = await readdir(AUTOMATIONS_DIR);
  } catch {
    return [];
  }

  const results: CodexAutomation[] = [];

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

export async function getCodexAutomation(id: string): Promise<CodexAutomation | null> {
  const list = await listCodexAutomations();
  return list.find((a) => a.id === id) ?? null;
}

export async function setCodexAutomationStatus(
  id: string,
  status: AutomationStatus,
): Promise<CodexAutomation | null> {
  const auto = await getCodexAutomation(id);
  if (!auto) return null;

  const raw = await readFile(auto.tomlPath, "utf8");
  const patched = patchTomlStatus(raw, status);
  await writeFile(auto.tomlPath, patched, "utf8");

  return { ...auto, status };
}

export async function updateCodexAutomation(
  id: string,
  patch: CodexAutomationPatch,
): Promise<CodexAutomation | null> {
  const auto = await getCodexAutomation(id);
  if (!auto) return null;

  const raw = await readFile(auto.tomlPath, "utf8");
  const patched = patchTomlAutomationFields(raw, patch);
  await writeFile(auto.tomlPath, patched, "utf8");

  return getCodexAutomation(id);
}
