import type { PromptEnhanceMode } from "./prompt-enhancer.ts";
import { canonicalize, splitSlashCommandPrompt } from "./slash-commands.ts";

export type PreparedChatPromptEnhancement = {
  draft: string;
  commandPrefix: string;
  mode: PromptEnhanceMode;
};

const COMMAND_MODES: Partial<Record<string, PromptEnhanceMode>> = {
  "/image": "image",
  "/research": "research",
};

/**
 * Prompt-like slash commands keep their routing token outside the text sent to
 * the enhancer. Otherwise a valid command can become an ordinary chat message.
 */
export function prepareChatPromptEnhancement(
  draft: string,
  hasProject: boolean,
): PreparedChatPromptEnhancement {
  const fallbackMode: PromptEnhanceMode = hasProject ? "code" : "chat";
  const { token, args } = splitSlashCommandPrompt(draft);
  const command = canonicalize(token);
  const mode = command ? COMMAND_MODES[command] : undefined;

  return mode
    ? { draft: args, commandPrefix: `${token} `, mode }
    : { draft, commandPrefix: "", mode: fallbackMode };
}

export function applyChatPromptEnhancement(
  prepared: Pick<PreparedChatPromptEnhancement, "commandPrefix">,
  enhanced: string,
): string {
  return `${prepared.commandPrefix}${enhanced}`;
}
