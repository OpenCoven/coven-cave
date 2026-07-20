import type { GroupReply, GroupTurn, GroupUserTurn } from "./group-chat";

export type GroupChatThread = { user: GroupUserTurn; replies: GroupReply[] };

/** Keep transcript threading independent from the streaming/view layer. */
export function groupChatTranscriptThreads(turns: readonly GroupTurn[]): GroupChatThread[] {
  const users: GroupUserTurn[] = [];
  const repliesByUser = new Map<string, GroupReply[]>();
  for (const turn of turns) {
    if (turn.role === "user") {
      users.push(turn);
      continue;
    }
    const replies = repliesByUser.get(turn.replyTo) ?? [];
    replies.push(turn);
    repliesByUser.set(turn.replyTo, replies);
  }
  return users.map((user) => ({ user, replies: repliesByUser.get(user.id) ?? [] }));
}
