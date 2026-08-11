/**
 * The handful of pieces `github-card-composer.tsx` shares with its section
 * files. Nothing here holds state or knows a route — the composer stays the one
 * owner of both, so a section file can be read end-to-end as presentation.
 */

export type Method = "squash" | "merge" | "rebase";

export const METHOD_LABEL: Record<Method, string> = { squash: "squash", merge: "merge commit", rebase: "rebase" };

/** Segment-control item classNames — `--tight` is the footer/inline density. */
export const seg = (on: boolean) => `ghc-seg__item focus-ring${on ? " ghc-seg__item--on" : ""}`;
export const segTight = (on: boolean) =>
  `ghc-seg__item ghc-seg__item--tight focus-ring${on ? " ghc-seg__item--on" : ""}`;
