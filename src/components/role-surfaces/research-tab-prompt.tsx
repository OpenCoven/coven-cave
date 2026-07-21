"use client";

/**
 * Prompt tab — the design's "New research" screen (cave-dl74, Phase B1).
 *
 * Hero line, the intake engine (research-mission-composer.tsx: slash palette,
 * ✦ Improve, angle chips, mode cards, bounds disclosure), and the Quick saves
 * panel. Quick saves come from the shared /api/research/links store
 * (useResearchLinks — the same hook the Resources tab uses); rows toggle an
 * attach state that renders as "Related context" chips inside the composer
 * card. On Start research the mission is created first, then every attached
 * link is added as a `candidate` source through the same attach-source action
 * the evidence ledger uses, and the desk opens on the new mission.
 *
 * Suggested-angle seeds are REAL data only: recent mission titles plus
 * saved-link titles. With no missions and no saves the chips row simply does
 * not render. (This panel supersedes the old ResearchLinkShelf composition on
 * this tab — Phase C reconciles the surface test pin.)
 */

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { LINK_CATEGORY_META, type SavedLink } from "@/lib/link-organizer";
import type { ResearchMissionMode } from "@/lib/research-missions";
import { relativeTime } from "@/lib/relative-time";
import { ResearchMissionComposer, type AttachedResearchLink } from "./research-mission-composer";
import type { ResearchTabProps } from "./researcher-surface";
import { useResearchLinks } from "./use-research-links";

export type ResearchTabPromptProps = ResearchTabProps & {
  /** Composer mode preselected by cross-tab navigation. */
  initialMode?: ResearchMissionMode;
};

/** How many recent titles feed the suggested-angle rotation from each pool. */
const ANGLE_SEEDS_PER_POOL = 6;

export function ResearchTabPrompt({ research, context, onNavigate, initialMode }: ResearchTabPromptProps) {
  const links = useResearchLinks();
  const [attached, setAttached] = useState<SavedLink[]>([]);
  const [query, setQuery] = useState("");

  // Angle seeds are real titles only: recent, non-archived missions plus the
  // newest quick saves. No data → no chips (the composer hides the row).
  const angleSeeds = useMemo(() => {
    const missionTitles = research.missions
      .filter((mission) => mission.status !== "archived")
      .slice(0, ANGLE_SEEDS_PER_POOL)
      .map((mission) => mission.title);
    const linkTitles = links.links.slice(0, ANGLE_SEEDS_PER_POOL).map((link) => link.title);
    return [...missionTitles, ...linkTitles];
  }, [research.missions, links.links]);

  const attachedChips: AttachedResearchLink[] = attached.map((link) => ({
    id: link.id,
    title: link.title,
    url: link.url,
  }));

  const toggleAttach = (link: SavedLink) => {
    setAttached((current) => (
      current.some((entry) => entry.id === link.id)
        ? current.filter((entry) => entry.id !== link.id)
        : [...current, link]
    ));
  };

  const trimmedQuery = query.trim().toLowerCase();
  const visibleLinks = trimmedQuery
    ? links.links.filter((link) => `${link.title} ${link.url}`.toLowerCase().includes(trimmedQuery))
    : links.links;

  return (
    <div className="research-intake">
      <header className="research-intake__hero">
        <h2>Turn a question into durable knowledge.</h2>
        <p>Bounded research · checkpoints you review · findings you can export or act on.</p>
      </header>

      <ResearchMissionComposer
        familiarId={context.activeFamiliar.id}
        daemonRunning={context.runtimeState.daemonRunning}
        initialMode={initialMode}
        attachedLinks={attachedChips}
        onRemoveAttached={(id) => setAttached((current) => current.filter((entry) => entry.id !== id))}
        angleSeeds={angleSeeds}
        onOpenResources={() => onNavigate("resources")}
        onStart={async (input) => {
          const result = await research.start(input);
          if (result.ok) {
            // Attach the selected quick saves as candidate sources — the same
            // attach-source action the evidence ledger uses. A failed attach is
            // non-fatal: the mission exists and the ledger can attach later.
            for (const link of attached) {
              await research.act(result.mission.id, {
                action: "attach-source",
                source: {
                  id: `link-${link.id}`,
                  title: link.title,
                  url: link.url,
                  sourceType: "web",
                  status: "candidate",
                },
              });
            }
            setAttached([]);
            // A freshly started mission lives on the Desk — follow it there.
            onNavigate("desk", { missionId: result.mission.id });
          }
          return result;
        }}
      />

      <section className="research-quick-saves" aria-label="Quick saves">
        <div className="research-quick-saves__head">
          <Icon name="ph:link" width={14} height={14} aria-hidden />
          <strong>Quick saves</strong>
          <span className="research-quick-saves__count">
            {links.links.length} · attach as related context for this investigation
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saves…"
            aria-label="Search saves"
            className="research-quick-saves__search"
          />
          <button
            type="button"
            className="research-quick-saves__all"
            onClick={() => onNavigate("resources")}
          >
            All in Resources →
          </button>
        </div>

        {links.error ? (
          <p className="research-mission-error" role="alert">{links.error}</p>
        ) : links.loading ? (
          <p className="research-quick-saves__empty">Loading saves…</p>
        ) : links.links.length === 0 ? (
          <p className="research-quick-saves__empty">No saves yet.</p>
        ) : visibleLinks.length === 0 ? (
          <p className="research-quick-saves__empty">No saves match “{query}”.</p>
        ) : (
          <ul className="research-quick-saves__list">
            {visibleLinks.map((link) => {
              const isAttached = attached.some((entry) => entry.id === link.id);
              return (
                <li key={link.id}>
                  <button
                    type="button"
                    className="research-quick-saves__row"
                    aria-pressed={isAttached}
                    onClick={() => toggleAttach(link)}
                  >
                    <span className="research-quick-saves__chip" data-category={link.category}>
                      <Icon name={LINK_CATEGORY_META[link.category].icon} width={11} height={11} aria-hidden />
                      {LINK_CATEGORY_META[link.category].label}
                    </span>
                    <span className="research-quick-saves__title">{link.title}</span>
                    <time dateTime={link.addedAt}>{relativeTime(link.addedAt) || "just now"}</time>
                    <span className="research-quick-saves__mark" data-attached={isAttached}>
                      {isAttached ? "✓ added" : "+ attach"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="research-quick-saves__hint">
          Type <code>/save</code> in any chat to collect links — they land here and in Resources.
        </p>
      </section>
    </div>
  );
}
