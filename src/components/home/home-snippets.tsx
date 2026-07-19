"use client";

// "Prompt snippets" — the hearth card's saved-template disclosure (chat
// revamp 1a). Collapsed by default (preference persisted); expanded it shows
// the top three saved prompts (favorites > recents > scan order, the same
// ordering the snippets modal uses) with an insert affordance, plus a
// "Show all…" row that opens the existing PromptSnippetsModal browser.

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { PromptOption } from "@/lib/slash-prompt";
import {
  orderPrompts,
  readPromptFavorites,
  readPromptRecents,
} from "@/lib/prompt-prefs";
import { promptIconName } from "@/components/prompt-snippets-modal";
import { useHomeDisclosure } from "@/components/home/use-home-disclosure";

export const HOME_SNIPPETS_PREF_KEY = "cave:home:snippets-expanded";
const PREVIEW_COUNT = 3;

type Props = {
  prompts: PromptOption[];
  /** Insert the template into the composer for editing — never a send. */
  onInsert: (prompt: PromptOption) => void;
  /** Open the full PromptSnippetsModal browser. */
  onShowAll: () => void;
};

export function HomeSnippets({ prompts, onInsert, onShowAll }: Props) {
  const [open, toggle] = useHomeDisclosure(HOME_SNIPPETS_PREF_KEY, false);
  // Favorites/recents sampled per mount — the modal broadcasts refreshes
  // through the composer's picker hook, which re-renders this list anyway.
  const [favorites] = useState<string[]>(() => readPromptFavorites());
  const [recents] = useState<string[]>(() => readPromptRecents());
  const top = useMemo(
    () => orderPrompts(prompts, favorites, recents).slice(0, PREVIEW_COUNT),
    [prompts, favorites, recents],
  );
  if (prompts.length === 0) return null;

  const chevron: IconName = open ? "ph:caret-down" : "ph:caret-right";

  return (
    <section className="home-disclosure" aria-label="Prompt snippets">
      <button
        type="button"
        className="home-disclosure__head"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name={chevron} width={11} aria-hidden />
        <span className="home-disclosure__title">Prompt snippets</span>
        <span className="home-disclosure__count">· {prompts.length} saved</span>
      </button>
      {open ? (
        <div className="home-disclosure__rows">
          {top.map((p) => (
            <button
              key={p.id}
              type="button"
              className="home-work-row"
              onClick={() => onInsert(p)}
              title={`Insert “${p.name}” into the composer`}
            >
              <Icon
                name={promptIconName(p.icon)}
                width={13}
                className="home-work-row__icon"
                aria-hidden
              />
              <span className="home-work-row__title">{p.name}</span>
              <span className="home-work-row__meta">insert ↵</span>
            </button>
          ))}
          <button
            type="button"
            className="home-work-row home-work-row--more"
            onClick={onShowAll}
          >
            <span className="home-work-row__title">Show all {prompts.length}…</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
