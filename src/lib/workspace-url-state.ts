import { isWorkspaceMode, type WorkspaceMode } from "@/lib/workspace-mode";

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

export function readModeParam(): WorkspaceMode | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("mode");
  return raw && isWorkspaceMode(raw) ? raw : null;
}

export function clearModeParam() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("mode")) return;
  params.delete("mode");
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}
