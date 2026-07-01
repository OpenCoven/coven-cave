import type { InitialCommandControls } from "@/lib/command-controls";
import type { ChatAttachment } from "@/lib/chat-attachments";

export type PendingChatAction =
  | {
      kind: "new";
      familiarId?: string | null;
      projectRoot?: string | null;
      /** Prompt handed off from the home composer; ChatView auto-sends it so
       *  the send runs through the normal streaming path. */
      initialPrompt?: string | null;
      /** Files handed off with the prompt; included in the auto-sent message. */
      initialAttachments?: ChatAttachment[] | null;
      initialControls?: InitialCommandControls | null;
      nonce: number;
    }
  | { kind: "open"; sessionId: string; familiarId?: string | null; findQuery?: string; nonce: number }
  | { kind: "list"; nonce: number }
  | null;
