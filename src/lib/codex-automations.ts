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
  tags: string[];
  prompt: string;
  /** Parsed from rrule for display */
  scheduleHuman: string;
  tomlPath: string;
};

const AUTOMATIONS_DIR = path.join(homedir(), ".codex", "automations");

// ── TOML minimal parser ──────────────────────────────────────────────────────

function parseTomlString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Handle multiline: collapse ''' ... ''' blocks into a single placeholder
  // so line iteration works cleanly.
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Multiline string: key = '''
    const mlMatch = line.match(/^(\w[\w-]*)\s*=\s*'''\s*$/);
    if (mlMatch) {
      const key = mlMatch[1];
      const parts: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "'''") {
        parts.push(lines[i]);
        i++;
      }
      result[key] = parts.join("\n");
      i++; // skip closing '''
      continue;
    }
    // Normal key = "value" or key = 'value' or key = bare
    const match = line.match(/^(\w[\w-]*)\s*=\s*(?:"([^"\\]*)"|'([^']*)'|(.*))$/);
    if (match) {
      const key = match[1];
      const val = match[2] ?? match[3] ?? (match[4] ?? "").trim();
      result[key] = val;
    }
    i++;
  }
  return result;
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
        tags: parseTags(kv["tags"] ?? ""),
        prompt: kv["prompt"] ?? "",
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
