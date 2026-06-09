import type { VoiceProvider } from "./types";

export const geminiLiveProvider: VoiceProvider = {
  id: "gemini",
  label: "Gemini Live",
  async mintSession() {
    throw new Error("not_implemented: Gemini Live ships in v1.1");
  },
  clientAdapter: {
    async connect() {
      throw new Error("not_implemented: Gemini Live ships in v1.1");
    },
  },
};
