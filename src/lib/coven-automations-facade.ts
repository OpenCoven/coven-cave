// Facade mapping: the Automations UI still speaks the Codex payload shape
// (coven#4990 keeps /api/codex-automations as a compatibility facade), while
// the authoritative store is now the Coven daemon. This module maps daemon
// routine records onto that legacy payload without ever reading ~/.codex.

import { humanRrule } from "@/lib/codex-automations";
import type { CodexAutomation } from "@/lib/codex-automations-types";
import type { CovenantAutomation } from "@/lib/coven-automations-types";

/** Prefix the Coven RRULE with the Codex-era marker the UI's copy and tests
 * expect, without duplicating it. */
export function codexRruleText(rrule: string): string {
  return rrule.startsWith("RRULE:") ? rrule : `RRULE:${rrule}`;
}

export function toCodexAutomationPayload(auto: CovenantAutomation): CodexAutomation {
  const rrule = codexRruleText(auto.rrule);
  return {
    id: auto.id,
    name: auto.name,
    kind: "cron",
    status: auto.status,
    rrule,
    model: auto.model ?? null,
    reasoningEffort: null,
    executionEnvironment: null,
    cwds: auto.cwd ? [auto.cwd] : [],
    tags: auto.tags,
    familiars: auto.familiarId ? [auto.familiarId] : [],
    prompt: auto.prompt,
    skillPath: null,
    scheduleHuman: humanRrule(rrule),
  };
}
