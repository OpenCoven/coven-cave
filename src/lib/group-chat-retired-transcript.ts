import type { GroupReply, GroupTurn, GroupUserTurn } from "./group-chat";

type TranscriptIo = {
  loadTranscript: (groupId: string) => GroupTurn[];
  saveTranscript: (groupId: string, turns: GroupTurn[]) => void;
};

type RetiredRunRecord = {
  groupId: string;
  scopeId: number;
  runId: string;
  userTurn: GroupUserTurn;
  reply: GroupReply;
};

function insertReplyAfterThreadTurns(
  turns: GroupTurn[],
  userTurnId: string,
  reply: GroupReply,
): GroupTurn[] {
  const next = [...turns];
  const existingReplyIndex = next.findIndex((turn) => turn.role === "assistant" && turn.id === reply.id);
  if (existingReplyIndex >= 0) {
    next[existingReplyIndex] = reply;
    return next;
  }
  const lastThreadTurnIndex = next.reduce((last, turn, index) => {
    if (turn.role === "user") return turn.id === userTurnId ? index : last;
    return turn.replyTo === userTurnId ? index : last;
  }, -1);
  if (lastThreadTurnIndex >= 0) {
    next.splice(lastThreadTurnIndex + 1, 0, reply);
    return next;
  }
  return [...next, reply];
}

export function mergeRetiredRunIntoTranscript(
  current: readonly GroupTurn[],
  userTurn: GroupUserTurn,
  reply: GroupReply,
): GroupTurn[] {
  const next = [...current];
  const userTurnIndex = next.findIndex((turn) => turn.role === "user" && turn.id === userTurn.id);
  if (userTurnIndex < 0) next.push(userTurn);
  return insertReplyAfterThreadTurns(next, userTurn.id, reply);
}

export function createGroupRetiredTranscriptStore(io: TranscriptIo) {
  const runs = new Map<string, RetiredRunRecord>();
  const replyOwners = new Map<string, string>();

  return {
    registerRun(record: RetiredRunRecord) {
      runs.set(record.runId, record);
      replyOwners.set(record.reply.id, record.runId);
    },
    updateRunReply(runId: string, updater: (reply: GroupReply) => GroupReply): GroupReply | null {
      const current = runs.get(runId);
      if (!current) return null;
      const next = updater(current.reply);
      runs.set(runId, { ...current, reply: next });
      return next;
    },
    persistRetiredRun(runId: string): boolean {
      const record = runs.get(runId);
      if (!record) return false;
      if (replyOwners.get(record.reply.id) !== runId) return false;
      if (record.reply.status !== "done" && record.reply.status !== "error") return false;
      const current = io.loadTranscript(record.groupId);
      io.saveTranscript(
        record.groupId,
        mergeRetiredRunIntoTranscript(current, record.userTurn, record.reply),
      );
      return true;
    },
    finishRun(runId: string) {
      const record = runs.get(runId);
      if (!record) return;
      runs.delete(runId);
      if (replyOwners.get(record.reply.id) === runId) {
        replyOwners.delete(record.reply.id);
      }
    },
    getRun(runId: string): RetiredRunRecord | null {
      return runs.get(runId) ?? null;
    },
    getReplyOwner(replyId: string): string | null {
      return replyOwners.get(replyId) ?? null;
    },
  };
}
