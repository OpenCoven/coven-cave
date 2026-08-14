import { isWorkspacePageId, type WorkspacePageId } from "@/lib/workspace-page-registry";

const CHAT_HASH_PREFIX = "#chat-";

export function readChatHash(): string | null {
  if (typeof window === "undefined" || !window.location.hash.startsWith(CHAT_HASH_PREFIX)) return null;
  try {
    return decodeURIComponent(window.location.hash.slice(CHAT_HASH_PREFIX.length));
  } catch {
    return null;
  }
}

export function clearChatHash() {
  if (typeof window === "undefined" || !window.location.hash.startsWith(CHAT_HASH_PREFIX)) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

function readWorkspacePageParam(name: string): WorkspacePageId | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(name);
  if (!raw) return null;
  return isWorkspacePageId(raw) ? raw : null;
}

export function readModeParam(): WorkspacePageId | null {
  return readWorkspacePageParam("mode");
}

export function readSplitPageParam(): WorkspacePageId | null {
  return readWorkspacePageParam("split");
}

export function readSplitSideParam(): "left" | "right" {
  if (typeof window === "undefined") return "right";
  return new URLSearchParams(window.location.search).get("splitSide") === "left" ? "left" : "right";
}

export function clearModeParam() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("mode") && !params.has("split") && !params.has("splitSide")) return;
  params.delete("mode");
  params.delete("split");
  params.delete("splitSide");
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}
