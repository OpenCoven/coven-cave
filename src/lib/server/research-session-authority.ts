import { hasUnpairedUtf16Surrogate } from "../utf16.ts";

export const RESEARCH_SESSION_AUTHORITY_SOCKET_MAX_LENGTH = 4_096;

/** Exact owner-local daemon provenance. This type is server-only by design. */
export type ResearchSessionAuthority = {
  kind: "owner-local-daemon";
  socketPath: string;
};

/** Private owner classes whose identity must never come from mission.json. */
export type ResearchSessionOwnerKind = "direct-copilot" | "owner-local-daemon";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnerLocalResearchSocketPath(value: unknown): value is string {
  if (typeof value !== "string"
    || value.length < 2
    || value.length > RESEARCH_SESSION_AUTHORITY_SOCKET_MAX_LENGTH
    || value.includes("\0")
    || hasUnpairedUtf16Surrogate(value)) {
    return false;
  }
  const windowsPipePrefix = "\\\\.\\pipe\\";
  const lower = value.toLowerCase();
  if (lower.startsWith(windowsPipePrefix)) {
    return value.length > windowsPipePrefix.length;
  }
  return value.startsWith("/") && !value.startsWith("//");
}

/** Parse only exact owner-local IPC provenance; hub URLs and remote UNC paths fail closed. */
export function parseResearchSessionAuthority(value: unknown): ResearchSessionAuthority | null {
  if (!isRecord(value)
    || value.kind !== "owner-local-daemon"
    || !isOwnerLocalResearchSocketPath(value.socketPath)) {
    return null;
  }
  return {
    kind: "owner-local-daemon",
    socketPath: value.socketPath,
  };
}
