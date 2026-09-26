import { resolveActivePath, type TreeTurn } from "./conversation-tree.ts";

/**
 * On-demand tool outputs for the web chat view (#5581).
 *
 * Tool payloads are about 70% of the bytes in large transcripts, but the chat
 * view renders a tool's output only once its card is opened (#5577). With
 * `?toolOutputs=recent` the conversation GET omits older outputs, recording
 * their length in `outputChars`, and a card fetches its output when opened.
 *
 * Kept in full: every tool that has not finished, the last RECENT_TOOL_OUTPUTS
 * finished tools on the active path (the composer's enhance context reads
 * exactly those), and any output of at most INLINE_TOOL_OUTPUT_MAX_CHARS,
 * which costs less than a round trip.
 */

export const RECENT_TOOL_OUTPUTS = 3;
export const INLINE_TOOL_OUTPUT_MAX_CHARS = 400;

type SlimTool = {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  outputChars?: number;
  [key: string]: unknown;
};
type SlimTurn = TreeTurn & { tools?: SlimTool[] | unknown; [key: string]: unknown };
type SlimConversation = { turns?: unknown; activeLeafId?: unknown; [key: string]: unknown };

function toolsOf(turn: SlimTurn): SlimTool[] {
  return Array.isArray(turn.tools) ? (turn.tools as SlimTool[]) : [];
}

function recentToolKeys(turns: SlimTurn[], activeLeafId: unknown): Set<SlimTool> {
  const path = typeof activeLeafId === "string" && activeLeafId ? resolveActivePath(turns, activeLeafId) : turns;
  const finished = path
    .flatMap((turn) => toolsOf(turn))
    .filter((tool) => tool.status === "ok" || tool.status === "error");
  return new Set(finished.slice(-RECENT_TOOL_OUTPUTS));
}

/** A copy of `conversation` with older, larger tool outputs omitted. */
export function slimConversationToolOutputs<T extends SlimConversation>(conversation: T): T {
  if (!Array.isArray(conversation.turns)) return conversation;
  const turns = conversation.turns as SlimTurn[];
  const keep = recentToolKeys(turns, conversation.activeLeafId);
  let changed = false;
  const slimTurns = turns.map((turn) => {
    const tools = toolsOf(turn);
    if (tools.length === 0) return turn;
    let turnChanged = false;
    const slimTools = tools.map((tool) => {
      // A running tool is never slimmed: a thread opened mid-reply takes its
      // live tools from this payload and keeps extending them from the stream.
      const finished = tool.status === "ok" || tool.status === "error";
      if (!finished || keep.has(tool) || typeof tool.output !== "string" || tool.output.length <= INLINE_TOOL_OUTPUT_MAX_CHARS) {
        return tool;
      }
      turnChanged = true;
      const { output, ...rest } = tool;
      return { ...rest, outputChars: (output as string).length };
    });
    if (!turnChanged) return turn;
    changed = true;
    return { ...turn, tools: slimTools };
  });
  return changed ? { ...conversation, turns: slimTurns } : conversation;
}

export type ToolOutputLookup =
  | { kind: "found"; output: string }
  | { kind: "missing" }
  | { kind: "ambiguous" };

/** The full output of one tool, by id. Two different outputs under one id is
 *  reported rather than guessed. */
export function findToolOutput(conversation: SlimConversation | null, toolId: string): ToolOutputLookup {
  if (!conversation || !Array.isArray(conversation.turns)) return { kind: "missing" };
  let found: string | null = null;
  for (const turn of conversation.turns as SlimTurn[]) {
    for (const tool of toolsOf(turn)) {
      if (tool.id !== toolId || typeof tool.output !== "string") continue;
      if (found !== null && found !== tool.output) return { kind: "ambiguous" };
      found = tool.output;
    }
  }
  return found === null ? { kind: "missing" } : { kind: "found", output: found };
}
