export const RIGHT_CHAT_OPEN_PREF_KEY = "cave:shell:right-chat-open";
export const RIGHT_CHAT_WIDTH_PREF_KEY = "cave:shell:right-chat-width";
export const RIGHT_CHAT_DEFAULT_PX = 360;
export const RIGHT_CHAT_MIN_PX = 320;
export const RIGHT_CHAT_MAX_PX = 640;
export const SHELL_DETAIL_MIN_PX = 320;

const SHELL_SEPARATOR_PX = 4;

export interface RightChatFitInput {
  viewportWidth: number;
  navWidth: number;
  listWidth?: number;
  rightChatWidth: number;
}

export function normalizeRightChatOpen(raw: string | null): boolean {
  return raw === "1";
}

export function normalizeRightChatWidth(raw: string | null): number {
  const parsed = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return RIGHT_CHAT_DEFAULT_PX;

  const rounded = Math.round(parsed);
  return Math.min(RIGHT_CHAT_MAX_PX, Math.max(RIGHT_CHAT_MIN_PX, rounded));
}

export function shouldAutoCollapseNavForRightChat({
  viewportWidth,
  navWidth,
  listWidth = 0,
  rightChatWidth,
}: RightChatFitInput): boolean {
  const separatorCount = listWidth > 0 ? 3 : 2;
  return (
    navWidth +
      listWidth +
      rightChatWidth +
      SHELL_DETAIL_MIN_PX +
      separatorCount * SHELL_SEPARATOR_PX >
    viewportWidth
  );
}
