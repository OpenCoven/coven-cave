import { GRIMOIRE_HASH_PREFIX } from "@/lib/grimoire-link";
import { knowledgeDocKey } from "./grimoire-helpers";

export type GrimoireSelection =
  | { kind: "knowledge"; id: string; collection?: string }
  | { kind: "knowledge-new" }
  | { kind: "stitch-new" }
  | { kind: "memory"; path: string }
  | { kind: "journal"; date: string };

/** Stable identity shared by the navigator, tab strip, and persisted tab list. */
export function selectionKey(sel: GrimoireSelection): string {
  if (sel.kind === "knowledge") return `knowledge:${knowledgeDocKey(sel.id, sel.collection)}`;
  if (sel.kind === "memory") return `memory:${sel.path}`;
  if (sel.kind === "journal") return `journal:${sel.date}`;
  if (sel.kind === "stitch-new") return "stitch-new";
  return "knowledge-new";
}

export function readGrimoireHash(): GrimoireSelection | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith(GRIMOIRE_HASH_PREFIX)) return null;
  const rest = hash.slice(GRIMOIRE_HASH_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  let id: string;
  try {
    id = decodeURIComponent(rest.slice(sep + 1));
  } catch {
    return null;
  }
  if (!id) return null;
  if (kind === "knowledge") {
    const parts = id.split("/");
    return parts.length === 2 && parts[0] && parts[1]
      ? { kind: "knowledge", collection: parts[0], id: parts[1] }
      : { kind: "knowledge", id };
  }
  if (kind === "memory") return { kind: "memory", path: id };
  if (kind === "journal") return { kind: "journal", date: id };
  return null;
}

export function writeGrimoireHash(sel: GrimoireSelection | null) {
  if (typeof window === "undefined") return;
  const base = window.location.pathname + window.location.search;
  if (!sel || sel.kind === "knowledge-new" || sel.kind === "stitch-new") {
    if (window.location.hash.startsWith(GRIMOIRE_HASH_PREFIX)) {
      window.history.replaceState(null, "", base);
    }
    return;
  }
  const id = sel.kind === "knowledge" ? knowledgeDocKey(sel.id, sel.collection) : sel.kind === "memory" ? sel.path : sel.date;
  window.history.replaceState(null, "", `${base}${GRIMOIRE_HASH_PREFIX}${sel.kind}:${encodeURIComponent(id)}`);
}

const TABS_STORAGE_KEY = "cave:grimoire:tabs";
const ACTIVE_TAB_STORAGE_KEY = "cave:grimoire:active-tab";
export const MAX_OPEN_TABS = 8;

export function parseStoredTabs(raw: string | null): GrimoireSelection[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tabs: GrimoireSelection[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      if (item.kind === "knowledge" && typeof item.id === "string" && item.id) {
        tabs.push({
          kind: "knowledge",
          id: item.id,
          ...(typeof item.collection === "string" && item.collection ? { collection: item.collection } : {}),
        });
      } else if (item.kind === "memory" && typeof item.path === "string" && item.path) {
        tabs.push({ kind: "memory", path: item.path });
      } else if (item.kind === "journal" && typeof item.date === "string" && item.date) {
        tabs.push({ kind: "journal", date: item.date });
      }
    }
    return tabs.slice(0, MAX_OPEN_TABS);
  } catch {
    return [];
  }
}

export function readStoredTabs(): { tabs: GrimoireSelection[]; activeKey: string | null } {
  if (typeof window === "undefined") return { tabs: [], activeKey: null };
  try {
    const tabs = parseStoredTabs(window.localStorage.getItem(TABS_STORAGE_KEY));
    const activeKey = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return { tabs, activeKey: activeKey && tabs.some((t) => selectionKey(t) === activeKey) ? activeKey : null };
  } catch {
    return { tabs: [], activeKey: null };
  }
}

export function writeStoredTabs(tabs: GrimoireSelection[], activeKey: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify(tabs.filter((t) => t.kind !== "knowledge-new" && t.kind !== "stitch-new")),
    );
    if (activeKey) window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeKey);
    else window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
  } catch {
    /* private mode — tabs stay session-only */
  }
}
