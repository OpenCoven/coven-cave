import type { ChatTurn, ConversationFile } from "../cave-conversations.ts";
import { normalizeToolActivity } from "../chat-activity.ts";
import { normalizeReasoningBlocks } from "../chat-reasoning-blocks.ts";
import { isKnownToolOutcome, normalizeToolStatus } from "../chat-tool-state.ts";
import type { ToolOutputLookup } from "../conversation-tool-output.ts";
import { projectDisplayId, projectDisplayText, projectProgressDetails } from "./chat-display-projection.ts";
import { projectReasoningText } from "./chat-reasoning-projection.ts";
import { projectLegacyAssistantText, projectLegacyToolOffsets } from "./legacy-reasoning-projection.ts";

/** Stored IDs may already be projected. Do not hash that reserved namespace a
 * second time on reload. This accepts display correlation, never authority. */
function storedDisplayId(value: string): string {
  // Hashes are deliberately high entropy, so the credential redactor cannot
  // decide whether an already-projected hash needs another projection.
  const hashed = /^(.*:)?opaque-[a-f0-9]{64}$/.exec(value);
  if (hashed && (!hashed[1] || /^[A-Za-z0-9._:-]{1,128}$/.test(hashed[1]) &&
    projectDisplayText(hashed[1], { classification: "tool-name", complete: true }) === hashed[1])) return value;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value) &&
    projectDisplayText(value, { classification: "tool-name", complete: true }) === value
    ? value : projectDisplayId(value);
}

type StoredTool = NonNullable<ChatTurn["tools"]>[number];
const STORED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Shared by history reads and trace exports; project before display clipping. */
export function projectStoredTool(value: unknown): StoredTool | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tool = value as StoredTool;
  if (typeof tool.id !== "string" || !tool.id || typeof tool.name !== "string") return undefined;
  const id = storedDisplayId(tool.id);
  const status = normalizeToolStatus(tool.status);
  const activity = normalizeToolActivity(tool.activity, tool.id, status);
  const input = projectDisplayText(tool.input, { classification: "tool-input", complete: true });
  const output = projectDisplayText(tool.output, { classification: "tool-output", complete: isKnownToolOutcome(status) });
  // Select the historical display schema explicitly. Unknown siblings (opaque
  // provider state, forged disclosure flags, etc.) never ride along in a spread.
  return {
    id, name: projectDisplayText(tool.name, { classification: "tool-name", complete: true })?.slice(0, 512) || "Tool",
    status,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(Number.isFinite(tool.durationMs) && tool.durationMs! >= 0 ? { durationMs: tool.durationMs } : {}),
    ...(Number.isSafeInteger(tool.textOffset) && tool.textOffset! >= 0 ? { textOffset: tool.textOffset } : {}),
    ...(activity ? { activity: { ...activity, callId: id } } : {}),
  };
}

/** Read-only presentation defense for stored records, including pre-projection
 * transcripts. It does not rewrite execution history or upgrade legacy strings
 * into provider summaries. Existing answers and branching data stay intact. */
export function projectConversationDisplay(conversation: ConversationFile): ConversationFile {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => {
      const assistant = turn.role === "assistant";
      const reasoningBlocks = assistant ? normalizeReasoningBlocks(turn.reasoningBlocks) : undefined;
      return {
        ...turn,
        text: assistant ? projectLegacyAssistantText(turn.text, turn.cancelled || turn.isError) : turn.text,
        reasoning: undefined,
        reasoningBlocks: reasoningBlocks ? projectLegacyToolOffsets(reasoningBlocks, turn.text).map((block) => {
          const text = block.phase === "complete" ? projectReasoningText(block.text, block.representation) : undefined;
          return { ...block, id: `${block.observation.attemptId}:${storedDisplayId(block.id.slice(block.observation.attemptId.length + 1))}`,
            text, disclosure: text ? "display-safe" as const : "withheld" as const };
        }) : undefined,
        tools: assistant && Array.isArray(turn.tools) ? projectLegacyToolOffsets(turn.tools.flatMap((tool) => projectStoredTool(tool) ?? []), turn.text) : undefined,
        progress: assistant && Array.isArray(turn.progress) ? turn.progress.flatMap((entry) => {
          if (!entry || typeof entry.id !== "string" || typeof entry.label !== "string" ||
            !["running", "done", "notice", "error"].includes(entry.status) || typeof entry.createdAt !== "string" ||
            !STORED_INSTANT.test(entry.createdAt) || !Number.isFinite(Date.parse(entry.createdAt))) return [];
          const projected = projectProgressDetails(entry);
          return [{ ...projected, id: storedDisplayId(entry.id), status: entry.status, createdAt: entry.createdAt,
            ...(Number.isFinite(entry.durationMs) && entry.durationMs! >= 0 ? { durationMs: entry.durationMs } : {}) }];
        }) : undefined,
      };
    }),
  };
}

/** Resolve against the same projected IDs as history, but compare original
 * outputs before redaction so two different private values stay ambiguous. */
export function findDisplayToolOutput(conversation: ConversationFile | null, toolId: string): ToolOutputLookup {
  let match: StoredTool | undefined;
  for (const turn of conversation?.turns ?? []) {
    if (turn.role !== "assistant" || !Array.isArray(turn.tools)) continue;
    for (const tool of turn.tools) {
      if (!tool || typeof tool.id !== "string" || storedDisplayId(tool.id) !== toolId || typeof tool.output !== "string") continue;
      if (match && (match.id !== tool.id || match.output !== tool.output)) return { kind: "ambiguous" };
      match = tool;
    }
  }
  const output = match ? projectStoredTool(match)?.output : undefined;
  return output === undefined ? { kind: "missing" } : { kind: "found", output };
}
