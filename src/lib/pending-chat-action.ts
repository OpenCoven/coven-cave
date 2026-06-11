export type PendingChatAction =
  | {
      kind: "new";
      familiarId?: string | null;
      projectRoot?: string | null;
      /** Prompt handed off from the home composer; ChatView auto-sends it so
       *  the send runs through the normal streaming path. */
      initialPrompt?: string | null;
      nonce: number;
    }
  | { kind: "open"; sessionId: string; familiarId?: string | null; nonce: number }
  | { kind: "list"; nonce: number }
  | null;
