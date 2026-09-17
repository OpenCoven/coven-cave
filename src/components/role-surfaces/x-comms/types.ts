/**
 * The callback surface the composer parts are driven by.
 *
 * Grouped into one object rather than two dozen props: the room owns every
 * mutation (it is the only thing holding the draft list), and threading them
 * individually through three levels of component made the signatures longer
 * than the components.
 */

import type { XMediaKind, XPollDuration, XTone } from "@/lib/x-comms-model";

/** An open generation panel. `target` says what the result attaches to. */
export type XGenerateState = {
  /** A post index, or the article slot the image is bound for. */
  target: number | "cover" | "inline";
  kind: XMediaKind;
  preset: string;
  prompt: string;
  /** Set when regenerating in place, so the result replaces rather than adds. */
  replaceIndex?: number;
};

export type XComposerActions = {
  setPostText(index: number, text: string): void;
  setPostCaret(index: number, caret: number): void;
  movePost(from: number, to: number): void;
  splitPost(index: number): void;
  mergePost(index: number): void;
  removePost(index: number): void;
  addPost(): void;

  addMedia(index: number, kind: XMediaKind): void;
  removeMedia(index: number, mediaIndex: number): void;
  setAlt(index: number, mediaIndex: number, alt: string): void;
  convertToGif(index: number, mediaIndex: number): void;

  addPoll(index: number): void;
  removePoll(index: number): void;
  addPollOption(index: number): void;
  removePollOption(index: number, optionIndex: number): void;
  setPollOption(index: number, optionIndex: number, text: string): void;
  setPollDuration(index: number, duration: XPollDuration): void;
  reorderPollOption(index: number, from: number, to: number): void;

  openGenerate(state: XGenerateState): void;
  closeGenerate(): void;
  updateGenerate(patch: Partial<XGenerateState>): void;
  runGenerate(): void;

  setTarget(value: string): void;
  setType(value: string): void;
  setPermission(value: string): void;
  setTone(value: XTone): void;
  setNotes(value: string): void;

  setArticleTitle(value: string): void;
  setArticleBody(value: string): void;
  setArticleCaret(caret: number): void;
  setCoverAlt(value: string): void;
  removeCover(): void;
  setInlineAlt(index: number, value: string): void;
  removeInline(index: number): void;
};
