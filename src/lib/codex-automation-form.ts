// Pure helpers for Codex automation scheduling and prompt authoring.
// Extracted from automations-view.tsx so they can be tested independently
// and reused across other surfaces (e.g. automation authoring dialogs).

export type ScheduleMode = "daily" | "weekly" | "raw";

export const RRULE_DAY_ORDER = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** RRULE weekday code → short label, for day-chip pickers. */
export const RRULE_DAY_LABEL: Record<string, string> = {
  SU: "Sun",
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
};

export function parseCodexRrule(rrule: string | null): {
  mode: ScheduleMode;
  days: string[];
  time: string;
  raw: string;
} {
  const raw = rrule ?? "";
  const freq = raw.match(/FREQ=(\w+)/)?.[1];
  const hour = raw.match(/BYHOUR=(\d+)/)?.[1];
  const min = raw.match(/BYMINUTE=(\d+)/)?.[1];
  const days = raw.match(/BYDAY=([^;]+)/)?.[1]?.split(",").filter(Boolean) ?? [];
  const time = `${(hour ?? "9").padStart(2, "0")}:${(min ?? "0").padStart(2, "0")}`;

  if (freq === "DAILY" && hour !== undefined) return { mode: "daily", days: [], time, raw };
  if (freq === "WEEKLY" && hour !== undefined) {
    return {
      mode: "weekly",
      days: days.length > 0 ? days : RRULE_DAY_ORDER,
      time,
      raw,
    };
  }
  return { mode: "raw", days: RRULE_DAY_ORDER, time, raw };
}

export function buildCodexRrule(mode: ScheduleMode, time: string, days: string[], raw: string): string {
  if (mode === "raw") return raw.trim();
  // A cleared <input type=time> yields "" — split gives [""], so the "9"
  // default never applies and Number("") is 0: the cron silently lands at
  // midnight. Fall back per-part instead.
  const [rawHour, rawMinute] = time.split(":");
  const hour = rawHour || "9";
  const minute = rawMinute || "0";
  const parts = [
    "RRULE:FREQ=" + (mode === "daily" ? "DAILY" : "WEEKLY"),
    `BYHOUR=${Number(hour)}`,
    `BYMINUTE=${Number(minute)}`,
  ];
  if (mode === "weekly") {
    const ordered = RRULE_DAY_ORDER.filter((day) => days.includes(day));
    parts.push(`BYDAY=${ordered.join(",")}`);
  }
  return parts.join(";");
}

export function splitAutomationPrompt(prompt: string): {
  goals: string;
  deliverables: string;
  hasStructuredSections: boolean;
} {
  const sectionPattern = /^\s*(?:#{1,6}\s*)?(Goals|Deliverables)\s*:?\s*$/gim;
  const matches = [...prompt.matchAll(sectionPattern)];
  if (matches.length === 0) {
    return { goals: prompt, deliverables: "", hasStructuredSections: false };
  }

  const parts = { goals: "", deliverables: "" };
  const leading = prompt.slice(0, matches[0].index ?? 0).trim();
  if (leading) parts.goals = leading;

  matches.forEach((match, index) => {
    const key = match[1].toLowerCase() === "deliverables" ? "deliverables" : "goals";
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? prompt.length;
    const value = prompt.slice(start, end).trim();
    parts[key] = parts[key] ? `${parts[key]}\n\n${value}`.trim() : value;
  });

  return { ...parts, hasStructuredSections: true };
}

export function composeAutomationPrompt(
  goals: string,
  deliverables: string,
  includeHeadings: boolean,
): string {
  const nextGoals = goals.trim();
  const nextDeliverables = deliverables.trim();

  if (!includeHeadings && !nextDeliverables) return nextGoals;

  const sections: string[] = [];
  if (nextGoals) sections.push(`Goals:\n${nextGoals}`);
  if (nextDeliverables) sections.push(`Deliverables:\n${nextDeliverables}`);
  return sections.join("\n\n");
}

/** Lowercase kebab id from a name, safe as an automation dir name. */
export function slugifyAutomationId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug.slice(0, 80) : "automation";
}
