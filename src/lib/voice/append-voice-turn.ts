import { appendTurn, type ChatTurn } from "../cave-conversations.ts";
import { randomUUID } from "node:crypto";

export type VoiceOriginTurnInput = {
  callId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export async function appendVoiceOriginTurn(
  sessionId: string,
  input: VoiceOriginTurnInput,
): Promise<void> {
  const turn: ChatTurn = {
    id: randomUUID(),
    role: input.role,
    text: input.text,
    createdAt: input.createdAt,
    origin: "voice",
    voiceCallId: input.callId,
  };
  await appendTurn(sessionId, turn);
}
