import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, type TomlTable } from "smol-toml";
import { caveHome } from "../coven-paths.ts";
import { createResearchAutomation, type ResearchAutomationInput } from "./research-automations.ts";

const MAX_BYTES = 128 * 1024;
const MAX_PLAN_BYTES = 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const MISSION = /^[a-zA-Z0-9_-]{1,128}$/;
const KEYS = new Set(["version", "id", "kind", "name", "status", "rrule", "model", "reasoning_effort", "execution_environment", "cwds", "tags", "familiars", "skill_path", "prompt"]);
function refuse(reason: string): never { throw new Error(`Research legacy import refused: ${reason}`); }
function digest(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }

export type ResearchLegacyImportPlan = {
  version: 1; planId: string; id: string; missionId: string; sourceDigest: string;
  sourceStatus: "ACTIVE" | "PAUSED"; targetStatus: "PAUSED"; input: ResearchAutomationInput;
};

/** A deliberately narrow, lossless subset of the released scheduler grammar. */
function schedule(value: string): string {
  const fields = new Map<string, string>();
  for (const part of value.replace(/^RRULE:/, "").split(";")) {
    const match = /^(FREQ|BYHOUR|BYDAY|BYMINUTE)=([^=;]+)$/.exec(part);
    if (!match || fields.has(match[1])) refuse("unsupported-schedule");
    fields.set(match[1], match[2]);
  }
  const frequency = fields.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY") refuse("unsupported-schedule");
  // Require explicit hour/day rather than silently adopting producer defaults.
  const hours = fields.get("BYHOUR")?.split(",");
  if (!hours?.length || hours.some(hour => !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(hour)) || new Set(hours).size !== hours.length) refuse("unsupported-schedule");
  const days = fields.get("BYDAY")?.split(",");
  if (frequency === "WEEKLY" && (!days?.length || days.some(day => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(day)) || new Set(days).size !== days.length)) refuse("unsupported-schedule");
  if (frequency === "DAILY" && days) refuse("unsupported-schedule");
  if (fields.has("BYMINUTE") && fields.get("BYMINUTE") !== "0") refuse("unsupported-schedule");
  fields.delete("BYMINUTE");
  return `RRULE:${[...fields].map(([key, value]) => `${key}=${value}`).join(";")}`;
}

function planFor(bytes: Buffer, id: string, missionId: string, timezone: string): ResearchLegacyImportPlan {
  if (!ID.test(id) || !MISSION.test(missionId)) refuse("invalid-identity");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { refuse("invalid-timezone"); }
  if (!timezone || timezone === "local") refuse("invalid-timezone");
  let doc: TomlTable;
  try { doc = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { refuse("invalid-toml"); }
  if (Object.keys(doc).some(key => !KEYS.has(key))) refuse("unsupported-metadata");
  if (doc.version !== "1" || doc.kind !== "cron" || doc.id !== id || (doc.status !== "ACTIVE" && doc.status !== "PAUSED")) refuse("unsupported-definition");
  function string(key: string, optional = false): string {
    const value = doc[key];
    if (optional && value === undefined) return "";
    if (typeof value !== "string" || (!optional && !value.trim())) refuse(`invalid-${key}`);
    return value;
  }
  function strings(key: string): string[] {
    const value = doc[key];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) refuse(`invalid-${key}`);
    return value as string[];
  }
  const cwds = strings("cwds"), familiars = strings("familiars"), tags = strings("tags");
  if (cwds.length !== 1 || familiars.length !== 1 || !path.isAbsolute(cwds[0])) refuse("unsupported-binding");
  if (tags.filter(tag => tag.startsWith("research-mission:")).length !== 1 || !tags.includes(`research-mission:${missionId}`)) refuse("ambiguous-mission");
  if (string("reasoning_effort", true) || string("execution_environment", true) || string("skill_path", true)) refuse("unsupported-execution-metadata");
  const sourceDigest = digest(bytes);
  const input: ResearchAutomationInput = {
    name: string("name"), prompt: string("prompt"), rrule: schedule(string("rrule")),
    cwds, familiars, tags, model: string("model", true), reasoningEffort: "", executionEnvironment: "", skillPath: null,
    timezone, importedFrom: `codex-automation:${id}:sha256:${sourceDigest}`,
  };
  const body = { version: 1 as const, id, missionId, sourceDigest, sourceStatus: doc.status as "ACTIVE" | "PAUSED", targetStatus: "PAUSED" as const, input };
  return { ...body, planId: digest(JSON.stringify(body)) };
}

async function boundedRead(file: string, limit = MAX_BYTES): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) refuse("source-size-or-type");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > limit) refuse("source-too-large");
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** Only this explicit importer opens the selected legacy source. Never called
 * by ordinary scheduling, reconciliation, or cancellation. */
export function createResearchLegacyImporter(options: { home?: string; planRoot?: string; create?: typeof createResearchAutomation } = {}) {
  const home = options.home ?? os.homedir();
  const planRoot = options.planRoot ?? path.join(caveHome(), "research-automation-import-plans");
  const create = options.create ?? createResearchAutomation;
  async function source(id: string): Promise<Buffer> {
    if (!ID.test(id)) refuse("invalid-identity");
    const base = await realpath(home);
    const file = path.join(base, ".codex", "automations", id, "automation.toml");
    // Refuse all links in the selected relative path, including parent links.
    if (await realpath(file) !== file) refuse("source-link");
    return boundedRead(file);
  }
  return {
    async preview(id: string, missionId: string, timezone: string): Promise<ResearchLegacyImportPlan> {
      const plan = planFor(await source(id), id, missionId, timezone);
      await mkdir(planRoot, { recursive: true, mode: 0o700 });
      const file = path.join(planRoot, `${plan.planId}.json`);
      const serialized = JSON.stringify(plan);
      if (Buffer.byteLength(serialized) > MAX_PLAN_BYTES) refuse("plan-too-large");
      try { await writeFile(file, serialized, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if ((await boundedRead(file, MAX_PLAN_BYTES)).toString() !== serialized) refuse("plan-conflict");
      }
      return plan;
    },
    async apply(planId: string) {
      if (!/^[a-f0-9]{64}$/.test(planId)) refuse("invalid-plan");
      const saved: unknown = JSON.parse((await boundedRead(path.join(planRoot, `${planId}.json`), MAX_PLAN_BYTES)).toString());
      if (!saved || typeof saved !== "object" || !("id" in saved) || typeof saved.id !== "string" || !("missionId" in saved) || typeof saved.missionId !== "string" || !("input" in saved) || !saved.input || typeof saved.input !== "object" || !("timezone" in saved.input) || typeof saved.input.timezone !== "string") refuse("invalid-plan");
      const plan = planFor(await source(saved.id), saved.id, saved.missionId, saved.input.timezone);
      if (plan.planId !== planId || JSON.stringify(plan) !== JSON.stringify(saved)) refuse("source-changed-or-plan-invalid");
      return create(plan.input, { missionId: plan.missionId, automationId: plan.id, adoptionKey: `research-import:${plan.planId}` });
    },
  };
}
