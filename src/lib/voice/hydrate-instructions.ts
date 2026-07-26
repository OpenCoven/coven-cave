// Voice-call identity hydration — the familiar's REAL identity, not a costume.
//
// A chat turn gets the familiar's identity implicitly: the harness boots in the
// familiar's workspace (SOUL.md / IDENTITY.md / MEMORY.md on disk) and
// /api/chat/send wraps the prompt with the Coven identity canon and the
// Knowledge Vault. A voice call has none of that — the realtime provider (or
// the local loop's brain) sees only the `instructions` string minted here. So
// this module assembles chat-parity identity into that one string:
//
//   persona    — config.json fields (display_name/role/pronouns/description/note)
//   roles      — the familiar's active roles from config.roles
//   canon      — buildCovenIdentityCanonBlock (same rules text as chat)
//   contract   — SOUL.md / IDENTITY.md / MEMORY.md from the familiar workspace
//   knowledge  — the familiar-scoped Knowledge Vault block (same builder as chat)
//
// Every block is clamped (an oversized SOUL.md or vault entry must never fail
// a mint) and every loader is throw-proof (a missing file degrades to the
// persona-only instructions this module always produced).

import { loadConversation } from "../cave-conversations.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { buildCovenIdentityCanonBlock } from "../coven-identity-canon.ts";
import {
  isValidFamiliarId,
  readFamiliarContractFiles,
} from "../server/familiar-contract-files.ts";
import {
  buildPromptWithKnowledgeVault,
  listCollections,
  readKnowledgeVaultForPrompt,
} from "../server/knowledge-vault.ts";

export type Hydrated = {
  instructions: string;
  conversationSeed: Array<{ role: "user" | "assistant"; content: string }>;
};

/** Per-file clamp for SOUL.md / IDENTITY.md (core identity — keep generous). */
export const VOICE_IDENTITY_FILE_CHARS = 6_000;
/** Clamp for MEMORY.md, which drifts and can grow without bound. */
export const VOICE_MEMORY_FILE_CHARS = 4_000;
/** Clamp for the whole Knowledge Vault block. */
export const VOICE_VAULT_BLOCK_CHARS = 8_000;
/** Final safety clamp on the assembled instructions. */
export const VOICE_INSTRUCTIONS_CHARS = 24_000;

type FamiliarConfigRecord = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  note?: string;
};

type LoadedFamiliarConfig = {
  familiar: FamiliarConfigRecord;
  activeRoles: string[];
};

async function loadFamiliarConfig(familiarId: string): Promise<LoadedFamiliarConfig> {
  const configPath = path.join(caveHome(), "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      familiars?: Record<string, FamiliarConfigRecord>;
      roles?: Array<{ id?: string; familiar?: string; active?: boolean }>;
    };
    const activeRoles = (parsed.roles ?? [])
      .filter((r) => r.active && r.familiar === familiarId && typeof r.id === "string" && r.id)
      .map((r) => r.id as string);
    return { familiar: parsed.familiars?.[familiarId] ?? {}, activeRoles };
  } catch {
    return { familiar: {}, activeRoles: [] };
  }
}

/** Head-clamp with an ellipsis marker, mirroring local-loop's turn clamp. */
function clampBlock(text: string, cap: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= cap) return trimmed;
  return `${trimmed.slice(0, cap - 1)}…`;
}

function buildPersona(f: FamiliarConfigRecord, activeRoles: string[]): string {
  const name = f.display_name ?? "the familiar";
  const pronouns = f.pronouns ? ` (${f.pronouns})` : "";
  const lines: string[] = [
    `You are ${name}${pronouns}, a familiar in the user's coven.`,
    `Your role: ${f.role ?? "companion"}.`,
  ];
  if (f.description) lines.push(`About you: ${f.description}`);
  if (f.note) lines.push(`Notes for this conversation: ${f.note}`);
  if (activeRoles.length > 0) lines.push(`Active roles: ${activeRoles.join(", ")}.`);
  return lines.join("\n");
}

/** SOUL.md / IDENTITY.md / MEMORY.md, inlined so a filesystem-less realtime
 *  brain still answers as the declared identity. Missing workspace or files
 *  degrade to null (no block). */
async function buildContractBlock(familiarId: string): Promise<string | null> {
  if (!isValidFamiliarId(familiarId)) return null;
  let files: Awaited<ReturnType<typeof readFamiliarContractFiles>>["files"];
  try {
    ({ files } = await readFamiliarContractFiles(familiarId));
  } catch {
    return null;
  }
  const sections: string[] = [];
  if (files.soul?.trim()) {
    sections.push(`## SOUL.md\n${clampBlock(files.soul, VOICE_IDENTITY_FILE_CHARS)}`);
  }
  if (files.identity?.trim()) {
    sections.push(`## IDENTITY.md\n${clampBlock(files.identity, VOICE_IDENTITY_FILE_CHARS)}`);
  }
  if (files.memory?.trim()) {
    sections.push(`## MEMORY.md\n${clampBlock(files.memory, VOICE_MEMORY_FILE_CHARS)}`);
  }
  if (sections.length === 0) return null;
  return [
    "<FAMILIAR_CONTRACT>",
    "Your declared identity files. Speak and decide as this identity — it overrides any generic assistant persona.",
    "",
    sections.join("\n\n"),
    "</FAMILIAR_CONTRACT>",
  ].join("\n");
}

/** The familiar-scoped Knowledge Vault block, via the same builder chat uses. */
async function buildVaultBlock(familiarId: string): Promise<string | null> {
  try {
    const entries = await readKnowledgeVaultForPrompt(familiarId);
    const collections = await listCollections();
    const block = buildPromptWithKnowledgeVault("", entries, collections);
    if (!block.trim()) return null;
    return clampBlock(block, VOICE_VAULT_BLOCK_CHARS);
  } catch {
    return null;
  }
}

const VOICE_CALL_CLOSING =
  "You are speaking with the user over a live voice call. Respond conversationally and concisely. The transcript of this call will be appended to your ongoing chat history with the user, so future text turns will be able to read what you said here.";

export async function hydrateForVoiceCall(
  ids: { familiarId: string; sessionId: string },
  opts?: { seedTurns?: number },
): Promise<Hydrated> {
  const seedTurns = opts?.seedTurns ?? 12;
  const [{ familiar, activeRoles }, contractBlock, vaultBlock] = await Promise.all([
    loadFamiliarConfig(ids.familiarId),
    buildContractBlock(ids.familiarId),
    buildVaultBlock(ids.familiarId),
  ]);

  const blocks: string[] = [
    buildPersona(familiar, activeRoles),
    buildCovenIdentityCanonBlock(ids.familiarId),
  ];
  if (contractBlock) blocks.push(contractBlock);
  if (vaultBlock) blocks.push(vaultBlock);
  // The voice-call behavioral instruction stays last — closest to the moment
  // of speech, so style guidance wins over document prose above it.
  blocks.push(VOICE_CALL_CLOSING);
  const instructions = clampBlock(blocks.join("\n\n"), VOICE_INSTRUCTIONS_CHARS);

  const conv = await loadConversation(ids.sessionId);
  const conversationSeed: Hydrated["conversationSeed"] = [];
  if (conv) {
    const tail = conv.turns
      .filter(t => t.role === "user" || t.role === "assistant")
      .slice(-seedTurns);
    for (const t of tail) {
      conversationSeed.push({
        role: t.role as "user" | "assistant",
        content: t.text,
      });
    }
  }

  return { instructions, conversationSeed };
}
