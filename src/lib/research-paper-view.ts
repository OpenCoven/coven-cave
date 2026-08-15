export type PaperViewStatus = "idle" | "loading" | "ready" | "error";

export type PaperViewState = {
  status: PaperViewStatus;
  pageCount: number;
  error: string | null;
};

export type PaperViewAction =
  | { type: "load" }
  | { type: "ready"; pageCount: number }
  | { type: "fail"; message: string }
  | { type: "cancel" };

export const initialPaperViewState: PaperViewState = {
  status: "idle",
  pageCount: 0,
  error: null,
};

export function paperPdfUrl(arxivId: string): string {
  return `/api/research/papers/pdf?id=${encodeURIComponent(arxivId)}`;
}

export function reducePaperView(state: PaperViewState, action: PaperViewAction): PaperViewState {
  switch (action.type) {
    case "load":
      return { status: "loading", pageCount: 0, error: null };
    case "ready":
      // A render that resolves after dismissal must not revive the viewer.
      if (state.status !== "loading") return state;
      return { status: "ready", pageCount: action.pageCount, error: null };
    case "fail":
      if (state.status !== "loading") return state;
      return { status: "error", pageCount: 0, error: action.message };
    case "cancel":
      return initialPaperViewState;
  }
}
