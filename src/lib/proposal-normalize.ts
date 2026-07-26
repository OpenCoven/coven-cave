import { normalizeProposalAuthority } from "./proposal-authority.ts";
import {
  isRecord,
  normalizeChannel,
  normalizeTension,
  timeArrayToIso,
  type NormalizedProposalView,
  type ProposalView,
} from "./threads-read.ts";

export function normalizeProposal(fileName: string, raw: unknown, daemonSummary?: unknown): NormalizedProposalView {
  const candidate = isRecord(raw) && isRecord(raw.pending) ? raw.pending : raw;
  if (!isRecord(candidate) || typeof candidate.id !== "string" || !Array.isArray(candidate.edits)) {
    return {
      file: fileName,
      parse: "corrupt",
      payload: null,
      authority: normalizeProposalAuthority(raw, daemonSummary, null),
    };
  }
  const edits: NonNullable<ProposalView["payload"]>["edits"] = [];
  for (const e of candidate.edits) {
    if (!isRecord(e) || typeof e.surface !== "string" || !isRecord(e.contents)) {
      return {
        file: fileName,
        parse: "corrupt",
        payload: null,
        authority: normalizeProposalAuthority(raw, daemonSummary, null),
      };
    }
    const encoding = e.contents.encoding;
    const data = e.contents.data;
    if ((encoding !== "utf8" && encoding !== "base64") || typeof data !== "string") {
      return {
        file: fileName,
        parse: "corrupt",
        payload: null,
        authority: normalizeProposalAuthority(raw, daemonSummary, null),
      };
    }
    edits.push({ surface: e.surface, contents: { encoding, data } });
  }
  const payload = {
    id: candidate.id,
    familiarId: typeof candidate.familiar_id === "string" ? candidate.familiar_id : typeof candidate.familiarId === "string" ? candidate.familiarId : "",
    writer: typeof candidate.writer === "string" ? candidate.writer : "",
    channel: normalizeChannel(candidate.channel),
    threadId: typeof candidate.thread_id === "string" ? candidate.thread_id : typeof candidate.threadId === "string" ? candidate.threadId : "",
    fray: normalizeTension(candidate.fray),
    edits,
    stagedAt: timeArrayToIso(candidate.staged_at ?? candidate.stagedAt),
  };
  return {
    file: fileName,
    parse: "ok",
    payload,
    authority: normalizeProposalAuthority(raw, daemonSummary, payload),
  };
}
