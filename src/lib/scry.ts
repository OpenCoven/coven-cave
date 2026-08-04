/**
 * scry — read a likeness, suggest a familiar (cave-3rz.3).
 *
 * The rite's first and only real input is an image. Scrying turns that image
 * into *suggestions* — a name, a role, a description, a type or two — which the
 * rite shows as pre-filled, overwritable guesses. Nothing here is ever
 * committed on the user's behalf.
 *
 * Three rules shape this file:
 *
 *  1. **No familiar is required.** `familiarId` is how `/api/chat/send`
 *     resolves harness + model + workspace; a scry needs only a harness, a
 *     model and an image path. `coven doctor` reports harnesses OK with an
 *     empty familiar roster, so harness availability was never downstream of a
 *     familiar existing.
 *  2. **Local harnesses only.** Images reach a harness as temp file PATHS
 *     (see `buildPromptWithAttachments`), so only a harness that can read this
 *     machine's filesystem can see one. That is exactly the `imagesSupported`
 *     gate in the chat send route, and `pickScryHarness` mirrors it.
 *  3. **Pronouns are never inferred from an image.** Not asked for, not
 *     parsed, not accepted if volunteered. The suggestion always carries
 *     `they/them` flagged as a default the user should change. This is a
 *     product decision, not an omission.
 *
 * Parsing is deliberately tolerant: the reply is free text from a CLI harness,
 * not a JSON-mode API response. Every field degrades to empty rather than
 * failing the request, and an unparseable reply still returns a usable
 * (empty, default-pronoun) suggestion set the user can fill in by hand.
 */

import { stripAnsi } from "./ansi.ts";
import {
  FAMILIAR_TYPES,
  RETIRED_FAMILIAR_TYPE_SUCCESSORS,
  type FamiliarTypeId,
} from "./familiar-types.ts";

/** The only pronouns a scry ever produces. Never read off a face. */
export const SCRY_DEFAULT_PRONOUNS = "they/them";

export const SCRY_NAME_MAX = 40;
export const SCRY_ROLE_MAX = 60;
export const SCRY_DESCRIPTION_MAX = 280;
/** At most two offices — a scry guesses, it does not assign a whole career. */
export const SCRY_MAX_TYPES = 2;

export type ScrySuggestions = {
  /** Empty when the reply carried nothing usable — the field stays editable. */
  name: string;
  role: string;
  description: string;
  /** Always ids from FAMILIAR_TYPES; "general" is the empty state and is never
   *  a member (same convention as the stored `familiarType` list). */
  typeIds: FamiliarTypeId[];
  pronouns: string;
  /** Always true. Present so the surface can flag the field as a placeholder
   *  rather than a reading of the image. */
  pronounsAreDefault: true;
};

export function emptyScrySuggestions(): ScrySuggestions {
  return {
    name: "",
    role: "",
    description: "",
    typeIds: [],
    pronouns: SCRY_DEFAULT_PRONOUNS,
    pronounsAreDefault: true,
  };
}

// ── Harness selection ────────────────────────────────────────────────────────

/** The shape `/api/harnesses` reports, narrowed to what selection needs. */
export type ScryHarnessReport = {
  id: string;
  label?: string;
  chatSupported?: boolean;
  installed?: boolean;
  availability?: { state?: string } | null;
};

export type ScryHarnessChoice = { id: string; label: string };

export type ScryHarnessFilterOptions = {
  /**
   * False when a Hermes API endpoint is configured that cannot reach this
   * machine's files (a non-loopback base URL). Mirrors the send route's
   * `!(hermesApi && !hermesApiCanAccessLocalFiles(hermesApi))` term.
   */
  hermesReachesLocalFiles?: boolean;
};

/**
 * Bridges, not local runtimes: OpenClaw runs its own agent vessel and never
 * receives a Cave temp path. SSH runtimes are the other exclusion in
 * `imagesSupported`, and they cannot occur here — an SSH runtime is resolved
 * from a familiar binding, and a scry has no familiar.
 */
const NON_LOCAL_HARNESSES = new Set(["openclaw"]);

function harnessReady(report: ScryHarnessReport): boolean {
  if (report.chatSupported === false) return false;
  if (report.installed !== true) return false;
  const state = report.availability?.state;
  // Missing availability means the endpoint did not probe a launch vehicle for
  // this adapter; `installed` is then the only signal there is.
  return state === undefined || state === "ready";
}

/**
 * The first harness in `/api/harnesses` order that could actually look at a
 * local image file. Order is the endpoint's, so the curated bundle (codex,
 * claude, …) is preferred over registry and daemon-merged entries without a
 * second ranking to keep in sync.
 */
export function pickScryHarness(
  reports: readonly ScryHarnessReport[],
  options: ScryHarnessFilterOptions = {},
): ScryHarnessChoice | null {
  for (const report of reports) {
    const id = typeof report.id === "string" ? report.id.trim().toLowerCase() : "";
    if (!id) continue;
    if (NON_LOCAL_HARNESSES.has(id)) continue;
    if (id === "hermes" && options.hermesReachesLocalFiles === false) continue;
    if (!harnessReady(report)) continue;
    return { id, label: report.label?.trim() || id };
  }
  return null;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const TYPE_VOCABULARY = FAMILIAR_TYPES.map((type) => type.id).join(", ");

/**
 * The scry instruction. The image itself is appended by
 * `buildPromptWithAttachments`, which renders it as the file path the harness
 * opens with its Read tool — the same channel a chat turn uses.
 *
 * It asks for JSON because a shape is easier to hit than to describe, but the
 * parser never assumes it got one.
 */
export const SCRY_INSTRUCTIONS = [
  "You are scrying a likeness: an image someone intends to use as a familiar's face.",
  "Look at the attached image, then describe what a familiar wearing it would be.",
  "",
  "Reply with ONE JSON object and no other text:",
  '{"name":"","role":"","description":"","type":[]}',
  "",
  "  name         one or two words, evocative, drawn from what you actually see.",
  "  role         a short title under 40 characters (e.g. \"Archivist of Small Things\").",
  "  description  one sentence under 200 characters about the figure in the image.",
  `  type         one or two ids from EXACTLY this list: ${TYPE_VOCABULARY}. Invent nothing.`,
  "",
  "Never guess gender, pronouns, age, ethnicity, or identity from an image.",
  "Do not include a pronouns field. Describe the figure, not the person.",
].join("\n");

// ── Reply parsing ────────────────────────────────────────────────────────────

/**
 * Collect assistant text out of a `coven run --stream-json` transcript. Same
 * shaping as the board enrich route: JSONL assistant events when the harness
 * emits them, raw lines when it does not, and the whole cleaned output as a
 * last resort so a plain-text harness is never silently dropped.
 */
export function scryAssistantText(raw: string): string {
  const clean = stripAnsi(raw);
  let assistantText = "";
  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              assistantText += `${block.text}\n`;
            }
          }
          continue;
        }
        // A non-assistant JSONL frame (system.init, tool_result, result) is
        // transport, not reply — skip it rather than scraping its fields.
        if (typeof event.type === "string") continue;
      } catch {
        // Not a JSONL frame; fall through and keep it as plain text.
      }
    }
    assistantText += `${trimmed}\n`;
  }
  return assistantText.trim() || clean.trim();
}

/** First balanced `{…}` in the text, parsed. Tolerates prose on either side —
 *  harnesses routinely narrate before answering. */
function firstJsonObject(haystack: string): Record<string, unknown> | null {
  for (let start = haystack.indexOf("{"); start >= 0; start = haystack.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < haystack.length; i += 1) {
      const ch = haystack[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(haystack.slice(start, i + 1)) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // Malformed candidate — try the next `{`.
          }
          break;
        }
      }
    }
  }
  return null;
}

/** Strip the decorations a CLI reply arrives wearing, then bound the length. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const firstLine = value.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const bare = firstLine
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/[*_`]/g, "")
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return bare.length > max ? `${bare.slice(0, max - 1).trimEnd()}…` : bare;
}

/** A name is a name, not a sentence: keep at most three words. */
function cleanName(value: unknown): string {
  const text = cleanText(value, SCRY_NAME_MAX);
  if (!text) return "";
  const words = text.split(" ").slice(0, 3).join(" ");
  return words.replace(/[.,;:!?]+$/, "");
}

const TYPE_IDS = new Set<string>(FAMILIAR_TYPES.map((type) => type.id));
const TYPE_BY_LABEL = new Map<string, FamiliarTypeId>(
  FAMILIAR_TYPES.map((type) => [type.label.toLowerCase(), type.id]),
);

/** Resolve one token to a live type id — accepting a label, a retired id, or
 *  the id itself. Anything else is discarded rather than invented into. */
function resolveTypeId(token: string): FamiliarTypeId | null {
  const key = token.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  if (TYPE_IDS.has(key)) return key as FamiliarTypeId;
  const retired = RETIRED_FAMILIAR_TYPE_SUCCESSORS[key];
  if (retired) return retired;
  return TYPE_BY_LABEL.get(token.trim().toLowerCase()) ?? null;
}

function cleanTypeIds(value: unknown): FamiliarTypeId[] {
  const tokens = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(/[,\s|/]+/)
      : [];
  const resolved: FamiliarTypeId[] = [];
  for (const token of tokens) {
    const id = resolveTypeId(token);
    // "general" is the empty state, never a member of the stored list.
    if (!id || id === "general" || resolved.includes(id)) continue;
    resolved.push(id);
    if (resolved.length >= SCRY_MAX_TYPES) break;
  }
  return resolved;
}

/** Last-ditch scrape for a `Name: …` / `- role — …` style reply. */
function scrapeField(text: string, field: string): string {
  const pattern = new RegExp(
    `^\\s*[-*•]?\\s*["'\`]?${field}["'\`]?\\s*[:=—–-]\\s*(.+)$`,
    "im",
  );
  return pattern.exec(text)?.[1] ?? "";
}

/** Types named anywhere in a free-text reply, in the order they appear. */
function scrapeTypeIds(text: string): FamiliarTypeId[] {
  const found: FamiliarTypeId[] = [];
  for (const match of text.toLowerCase().matchAll(/[a-z]+/g)) {
    const id = resolveTypeId(match[0]);
    if (!id || id === "general" || found.includes(id)) continue;
    found.push(id);
    if (found.length >= SCRY_MAX_TYPES) break;
  }
  return found;
}

/**
 * Turn a harness transcript into suggestions. Never throws, never rejects:
 * a reply this cannot read yields empty fields, which the rite renders as the
 * same editable inputs a successful scry does.
 *
 * Pronouns are set here, unconditionally, and are never taken from the reply.
 */
export function parseScryReply(raw: string): ScrySuggestions {
  const text = scryAssistantText(raw ?? "");
  const suggestions = emptyScrySuggestions();
  if (!text) return suggestions;

  const parsed = firstJsonObject(text);
  if (parsed) {
    suggestions.name = cleanName(parsed.name ?? parsed.familiarName);
    suggestions.role = cleanText(parsed.role ?? parsed.title, SCRY_ROLE_MAX);
    suggestions.description = cleanText(
      parsed.description ?? parsed.summary,
      SCRY_DESCRIPTION_MAX,
    );
    suggestions.typeIds = cleanTypeIds(parsed.type ?? parsed.types ?? parsed.familiarType);
  }

  // Fall back per FIELD, not per reply: a harness that emitted JSON with an
  // empty role and prose underneath should still get a role out of the prose.
  if (!suggestions.name) suggestions.name = cleanName(scrapeField(text, "name"));
  if (!suggestions.role) {
    suggestions.role = cleanText(scrapeField(text, "role") || scrapeField(text, "title"), SCRY_ROLE_MAX);
  }
  if (!suggestions.description) {
    suggestions.description = cleanText(
      scrapeField(text, "description") || scrapeField(text, "summary"),
      SCRY_DESCRIPTION_MAX,
    );
  }
  if (suggestions.typeIds.length === 0) {
    const scraped = scrapeField(text, "type") || scrapeField(text, "types");
    suggestions.typeIds = scraped ? cleanTypeIds(scraped) : scrapeTypeIds(text);
  }
  return suggestions;
}
