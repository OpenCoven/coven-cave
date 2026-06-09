import { loadConversation } from "../cave-conversations.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export type Hydrated = {
  instructions: string;
  conversationSeed: Array<{ role: "user" | "assistant"; content: string }>;
};

type FamiliarConfigRecord = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  note?: string;
};

async function loadFamiliar(familiarId: string): Promise<FamiliarConfigRecord | null> {
  const configPath = path.join(homedir(), ".coven", "cave-config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as { familiars?: Record<string, FamiliarConfigRecord> };
    return parsed.familiars?.[familiarId] ?? null;
  } catch {
    return null;
  }
}

function buildInstructions(f: FamiliarConfigRecord): string {
  const name = f.display_name ?? "the familiar";
  const pronouns = f.pronouns ? ` (${f.pronouns})` : "";
  const lines: string[] = [
    `You are ${name}${pronouns}, a familiar in the user's coven.`,
    `Your role: ${f.role ?? "companion"}.`,
  ];
  if (f.description) lines.push(`About you: ${f.description}`);
  if (f.note) lines.push(`Notes for this conversation: ${f.note}`);
  lines.push(
    "",
    "You are speaking with the user over a live voice call. Respond conversationally and concisely. The transcript of this call will be appended to your ongoing chat history with the user, so future text turns will be able to read what you said here.",
  );
  return lines.join("\n");
}

export async function hydrateForVoiceCall(
  ids: { familiarId: string; sessionId: string },
  opts?: { seedTurns?: number },
): Promise<Hydrated> {
  const seedTurns = opts?.seedTurns ?? 12;
  const familiar = (await loadFamiliar(ids.familiarId)) ?? {};
  const instructions = buildInstructions(familiar);

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
