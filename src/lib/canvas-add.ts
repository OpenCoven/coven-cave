// Pure state and payload helpers for Canvas's describe-first New sketch flow.
// The component owns effects; this reducer owns lifecycle/race invariants so
// late async events cannot revive or overwrite a cancelled/newer run.

import {
  STARTER_ARTIFACT_HTML,
  STARTER_ARTIFACT_REACT,
  clampArtifactCode,
  looksLikeReact,
  titleFromPrompt,
  type ArtifactKind,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";

export type AddTileMode = "describe" | "paste" | "blank-html" | "blank-react";
export type AddTilePhase =
  | "collapsed"
  | "composing"
  | "generating"
  | "repairing"
  | "result"
  | "error";
export type AddTileSaveState = "idle" | "saving" | "saved" | "error";

export type ArtifactIdentity = { id: string; createdAt: string };
export type AddTileResult = { code: string; kind: ArtifactKind; sessionId: string | null };

export type AddTileState = {
  phase: AddTilePhase;
  mode: AddTileMode;
  prompt: string;
  pastedCode: string;
  pastedTitle: string;
  result: AddTileResult | null;
  /** Last revision confirmed in the store; refine failures never replace it. */
  persistedResult: AddTileResult | null;
  identity: ArtifactIdentity | null;
  revision: number;
  saveState: AddTileSaveState;
  activeRunId: string | null;
  generationPurpose: "create" | "refine" | null;
  error: string | null;
  errorKind: "format" | "generation" | "discard" | null;
};

export type AddTileEvent =
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "set-mode"; mode: AddTileMode }
  | { type: "set-prompt"; prompt: string }
  | { type: "set-pasted-code"; code: string }
  | { type: "set-pasted-title"; title: string }
  | { type: "begin-generation"; runId: string; identity: ArtifactIdentity }
  | { type: "begin-refine"; runId: string }
  | { type: "begin-repair"; runId: string }
  | { type: "generated"; runId: string; code: string; kind: ArtifactKind; sessionId: string | null; revision: number }
  | { type: "generation-failed"; runId: string; message: string; kind: "format" | "generation" }
  | { type: "save-started"; revision: number }
  | { type: "save-succeeded"; revision: number; savedId?: string; savedCreatedAt?: string }
  | { type: "save-failed"; revision: number }
  | { type: "edit-description" }
  | { type: "discard-local" }
  | { type: "discard-failed"; message: string }
  | { type: "code-saved" };

export const INITIAL_ADD_TILE_STATE: AddTileState = {
  phase: "collapsed",
  mode: "describe",
  prompt: "",
  pastedCode: "",
  pastedTitle: "",
  result: null,
  persistedResult: null,
  identity: null,
  revision: 0,
  saveState: "idle",
  activeRunId: null,
  generationPurpose: null,
  error: null,
  errorKind: null,
};

export type AddTileFocusTarget = "ghost" | "prompt" | "editor" | "cancel" | "refine" | "retry" | null;

/** Pure accessibility view-model for predictable focus after phase changes. */
export function focusTargetForState(
  state: Pick<AddTileState, "phase" | "mode">,
  previousPhase: AddTilePhase,
): AddTileFocusTarget {
  if (state.phase === previousPhase) return null;
  switch (state.phase) {
    case "collapsed": return "ghost";
    case "composing": return state.mode === "describe" ? "prompt" : "editor";
    case "generating":
    case "repairing": return "cancel";
    case "result": return "refine";
    case "error": return "retry";
  }
}

/** One stable live-region sentence per generation phase. */
export function generationStatusText(
  phase: "generating" | "repairing",
  familiarName: string,
): string {
  return phase === "repairing"
    ? "Still preparing your preview…"
    : `${familiarName || "Familiar"} is creating your preview…`;
}

export function addTileReducer(state: AddTileState, event: AddTileEvent): AddTileState {
  switch (event.type) {
    case "expand":
      if (state.phase !== "collapsed") return state;
      return { ...state, phase: state.result ? "result" : "composing" };
    case "collapse":
      // A confirmed artifact has joined the gallery, so closing completes this
      // creation and the next New sketch starts fresh. An unsaved valid preview
      // remains in reducer state and reopens instead of being silently lost.
      if (state.result && state.saveState === "saved") return INITIAL_ADD_TILE_STATE;
      return { ...state, phase: "collapsed", activeRunId: null, generationPurpose: null };
    case "set-mode": {
      if (state.phase !== "composing") return state;
      let pastedCode = state.pastedCode;
      if (event.mode === "blank-html") pastedCode = STARTER_ARTIFACT_HTML;
      if (event.mode === "blank-react") pastedCode = STARTER_ARTIFACT_REACT;
      return { ...state, mode: event.mode, pastedCode, error: null, errorKind: null };
    }
    case "set-prompt":
      return state.phase === "composing" ? { ...state, prompt: event.prompt } : state;
    case "set-pasted-code":
      return state.phase === "composing" ? { ...state, pastedCode: event.code } : state;
    case "set-pasted-title":
      return state.phase === "composing" ? { ...state, pastedTitle: event.title } : state;
    case "begin-generation":
      if ((state.phase !== "composing" && state.phase !== "error") || !state.prompt.trim()) return state;
      return {
        ...state,
        phase: "generating",
        mode: "describe",
        identity: state.identity ?? event.identity,
        activeRunId: event.runId,
        generationPurpose: "create",
        error: null,
        errorKind: null,
      };
    case "begin-refine":
      if (state.phase !== "result" || !state.result || !state.identity) return state;
      return {
        ...state,
        phase: "generating",
        activeRunId: event.runId,
        generationPurpose: "refine",
        error: null,
        errorKind: null,
      };
    case "begin-repair":
      return state.phase === "generating" && state.activeRunId === event.runId
        ? { ...state, phase: "repairing" }
        : state;
    case "generated":
      if (
        (state.phase !== "generating" && state.phase !== "repairing") ||
        state.activeRunId !== event.runId ||
        event.revision <= state.revision
      ) return state;
      return {
        ...state,
        phase: "result",
        result: { code: event.code, kind: event.kind, sessionId: event.sessionId },
        revision: event.revision,
        saveState: "saving",
        error: null,
        errorKind: null,
      };
    case "generation-failed":
      if (
        (state.phase !== "generating" && state.phase !== "repairing") ||
        state.activeRunId !== event.runId
      ) return state;
      return {
        ...state,
        phase: state.result ? "result" : "error",
        activeRunId: null,
        generationPurpose: null,
        error: event.message,
        errorKind: event.kind,
      };
    case "save-started":
      return event.revision === state.revision && state.result
        ? { ...state, saveState: "saving", error: null, errorKind: null }
        : state;
    case "save-succeeded":
      if (event.revision !== state.revision || !state.result) return state;
      // If the user closed while the autosave was in flight, the successful
      // artifact now belongs to the gallery; clear the retained draft so the
      // next New sketch really is new.
      if (state.phase === "collapsed") return INITIAL_ADD_TILE_STATE;
      return {
            ...state,
            identity: event.savedId && state.identity
              ? {
                  id: event.savedId,
                  createdAt: event.savedCreatedAt ?? state.identity.createdAt,
                }
              : state.identity,
            saveState: "saved",
            persistedResult: state.result,
            activeRunId: null,
            generationPurpose: null,
          };
    case "save-failed":
      return event.revision === state.revision && state.result
        ? {
            ...state,
            saveState: "error",
            activeRunId: null,
            generationPurpose: null,
            error: "Couldn’t save this preview.",
            errorKind: "generation",
          }
        : state;
    case "edit-description":
      return state.phase === "error"
        ? { ...state, phase: "composing", error: null, errorKind: null, activeRunId: null }
        : state;
    case "discard-local":
      return {
        ...INITIAL_ADD_TILE_STATE,
        phase: "composing",
        prompt: state.prompt,
      };
    case "discard-failed":
      return { ...state, error: event.message, errorKind: "discard" };
    case "code-saved":
      return INITIAL_ADD_TILE_STATE;
    default:
      return state;
  }
}

const strip = (html: string): string => html.replace(/<[^>]*>/g, " ");

export function derivePastedTitle(code: string): string {
  const src = typeof code === "string" ? code : "";
  const title = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const raw = [title, h1]
    .map((s) => strip(s ?? "").replace(/\s+/g, " ").trim())
    .find(Boolean) ?? "";
  return raw ? titleFromPrompt(raw) : "Pasted sketch";
}

export function detectPastedKind(code: string): ArtifactKind {
  return looksLikeReact(code) ? "react" : "html";
}

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

/** Build an id-stable generated/refined revision without changing createdAt. */
export function buildArtifactRevision(opts: {
  identity: ArtifactIdentity;
  prompt: string;
  code: string;
  kind: ArtifactKind;
  updatedAt: string;
}): CanvasArtifact {
  return {
    id: opts.identity.id,
    title: titleFromPrompt(opts.prompt),
    prompt: opts.prompt,
    code: clampArtifactCode(opts.code),
    kind: opts.kind,
    createdAt: opts.identity.createdAt,
    updatedAt: opts.updatedAt,
  };
}
