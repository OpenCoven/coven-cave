/**
 * Per-item draft persistence for the inline GitHub card composer
 * (design: `Final Card Components.dc.html` §04 — "Drafts write to
 * `cave:gh-card-draft:…#4034` on every keystroke and restore on mount").
 *
 * One key per GitHub item, so two cards for different PRs in the same
 * transcript never share a draft. Every call is storage-fault tolerant: in a
 * private window or with storage disabled the draft simply stays in memory
 * rather than throwing through the keystroke handler.
 */

const PREFIX = "cave:gh-card-draft:";

/** `cave:gh-card-draft:OpenCoven/coven-cave#4034` */
export function draftKey(repo: string, number: number): string {
  return `${PREFIX}${repo}#${number}`;
}

export function readDraft(repo: string, number: number): string {
  try {
    return window.localStorage.getItem(draftKey(repo, number)) ?? "";
  } catch {
    return "";
  }
}

/** Blank (or whitespace-only) clears the key instead of storing an empty draft. */
export function writeDraft(repo: string, number: number, text: string): void {
  try {
    if (text.trim()) window.localStorage.setItem(draftKey(repo, number), text);
    else window.localStorage.removeItem(draftKey(repo, number));
  } catch {
    /* storage unavailable — the draft stays in component state */
  }
}

export function clearDraft(repo: string, number: number): void {
  writeDraft(repo, number, "");
}
