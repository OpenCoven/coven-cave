// Pure logic for the Canvas "New sketch" tile (cave-fema): the composer state
// machine, pasted-code helpers, and the save-payload builder. Framework-free —
// the component owns fetches/aborts/announcements; everything here is
// deterministic and unit-tested. Spec:
// docs/superpowers/specs/2026-07-17-canvas-add-tile-design.md (local).

import {
  STARTER_ARTIFACT_HTML,
  clampArtifactCode,
  looksLikeReact,
  titleFromPrompt,
  type ArtifactKind,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";

export type AddTileMode = "describe" | "paste" | "blank";
export type AddTilePhase = "collapsed" | "composing" | "generating" | "result" | "error";

export type AddTileState = {
  phase: AddTilePhase;
  mode: AddTileMode;
  /** Describe-mode prompt. Survives collapse/failure; only save resets it. */
  prompt: string;
  /** Paste/Blank editor contents. Same retention rules as the prompt. */
  pastedCode: string;
  /** Explicit user-entered title for pasted code ("" = derive from code). */
  pastedTitle: string;
  /** The generated sketch awaiting Keep/Refine/Discard. */
  result: { code: string; kind: ArtifactKind } | null;
  error: string | null;
};

export type AddTileEvent =
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "set-mode"; mode: AddTileMode }
  | { type: "set-prompt"; prompt: string }
  | { type: "set-pasted-code"; code: string }
  | { type: "set-pasted-title"; title: string }
  | { type: "generate" }
  | { type: "generated"; code: string; kind: ArtifactKind }
  | { type: "generation-failed"; message: string }
  | { type: "refine" }
  | { type: "retry" }
  | { type: "discard-result" }
  | { type: "saved" };

export const INITIAL_ADD_TILE_STATE: AddTileState = {
  phase: "collapsed",
  mode: "describe",
  prompt: "",
  pastedCode: "",
  pastedTitle: "",
  result: null,
  error: null,
};

/**
 * The composer state machine. Retention is the contract: collapse, failure,
 * and discard keep what the user typed; only `saved` resets everything. An
 * unsaved `result` never survives a collapse (nothing was persisted).
 */
export function addTileReducer(state: AddTileState, event: AddTileEvent): AddTileState {
  switch (event.type) {
    case "expand":
      return state.phase === "collapsed" ? { ...state, phase: "composing" } : state;
    case "collapse":
      return { ...state, phase: "collapsed", result: null, error: null };
    case "set-mode": {
      if (state.phase !== "composing") return state;
      const next = { ...state, mode: event.mode };
      // Blank = Paste pre-seeded with the starter — but never clobber code
      // the user already has in the editor.
      if (event.mode === "blank" && !state.pastedCode.trim()) {
        next.pastedCode = STARTER_ARTIFACT_HTML;
      }
      return next;
    }
    case "set-prompt":
      return { ...state, prompt: event.prompt };
    case "set-pasted-code":
      return { ...state, pastedCode: event.code };
    case "set-pasted-title":
      return { ...state, pastedTitle: event.title };
    case "generate":
      if (state.phase !== "composing" || state.mode !== "describe" || !state.prompt.trim()) {
        return state;
      }
      return { ...state, phase: "generating", error: null };
    case "refine":
      return state.phase === "result" ? { ...state, phase: "generating", error: null } : state;
    case "retry":
      return state.phase === "error" ? { ...state, phase: "generating", error: null } : state;
    case "generated":
      return { ...state, phase: "result", result: { code: event.code, kind: event.kind }, error: null };
    case "generation-failed":
      // A failed refine keeps the prior sketch recoverable (result retained).
      return { ...state, phase: "error", error: event.message };
    case "discard-result":
      return { ...state, phase: "composing", result: null, error: null };
    case "saved":
      return INITIAL_ADD_TILE_STATE;
    default:
      return state;
  }
}

const strip = (html: string): string => html.replace(/<[^>]*>/g, " ");

/** Title for pasted code: `<title>` text, else first `<h1>` text, else a
 *  default — collapsed and clamped with the same rules as prompt titles. */
export function derivePastedTitle(code: string): string {
  const src = typeof code === "string" ? code : "";
  const title = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const raw = strip(title ?? h1 ?? "").replace(/\s+/g, " ").trim();
  return raw ? titleFromPrompt(raw) : "Pasted sketch";
}

/** Kind of pasted code, via the same heuristic generation extraction uses. */
export function detectPastedKind(code: string): ArtifactKind {
  return looksLikeReact(code) ? "react" : "html";
}

/** The artifact a Keep/Add action persists. `id`/`now` injected for purity. */
export function buildAddArtifact(opts: {
  id: string;
  now: string;
  mode: AddTileMode;
  prompt: string;
  pastedTitle: string;
  code: string;
  kind: ArtifactKind;
}): CanvasArtifact {
  const title =
    opts.pastedTitle.trim() ||
    (opts.mode === "describe" ? titleFromPrompt(opts.prompt) : derivePastedTitle(opts.code));
  return {
    id: opts.id,
    title,
    prompt: opts.mode === "describe" ? opts.prompt : "",
    code: clampArtifactCode(opts.code),
    kind: opts.kind,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}
