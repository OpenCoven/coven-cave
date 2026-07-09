// cave-fy1q phase 2: the summoning circle resets by unmounting (by design —
// see SummoningCircleOverlay), so an accidental Escape used to restart the
// whole rite. This per-window sessionStorage draft seeds the rite's state
// back on reopen; a successful summon clears it. Framework-free and
// storage-injectable so it tests without a DOM.

export const SUMMONING_DRAFT_KEY = "cave:summoning-draft:v1";

export type SummoningDraft = {
  stage: number;
  maxVisited: number;
  vessel: string | null;
  harness: string | null;
  agentId: string | null;
  sshHost: string;
  sshCwd: string;
  sshCommand: string;
  name: string;
  role: string;
  description: string;
  idOverride: string | null;
  glyph: string;
  aura: string | null;
  model: string;
};

type StringStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): StringStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Parse the stored draft, coercing every field so a stale or hand-edited
 *  payload can never seed invalid state (stages clamp to 0–3). */
export function readSummoningDraft(store: StringStore | null = defaultStore()): SummoningDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SUMMONING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SummoningDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const stageOf = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.trunc(v))) : 0;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      stage: stageOf(parsed.stage),
      maxVisited: Math.max(stageOf(parsed.maxVisited), stageOf(parsed.stage)),
      vessel: strOrNull(parsed.vessel),
      harness: strOrNull(parsed.harness),
      agentId: strOrNull(parsed.agentId),
      sshHost: str(parsed.sshHost),
      sshCwd: str(parsed.sshCwd),
      sshCommand: str(parsed.sshCommand),
      name: str(parsed.name),
      role: str(parsed.role),
      description: str(parsed.description),
      idOverride: strOrNull(parsed.idOverride),
      glyph: str(parsed.glyph),
      aura: strOrNull(parsed.aura),
      model: str(parsed.model),
    };
  } catch {
    return null;
  }
}

export function saveSummoningDraft(draft: SummoningDraft, store: StringStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(SUMMONING_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage full/blocked — the draft is best-effort */
  }
}

export function clearSummoningDraft(store: StringStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(SUMMONING_DRAFT_KEY);
  } catch {
    /* best-effort */
  }
}
