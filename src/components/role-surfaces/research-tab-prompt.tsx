"use client";

/**
 * Prompt tab — the handoff's "New research" screen.
 *
 * Hero line, the intake engine (research-mission-composer.tsx: slash palette,
 * ✦ Improve, prompt builder, strength meter, angle chips, mode cards, bounds
 * disclosure), and the Quick saves drawer docked to the bottom of the surface.
 *
 * The drawer is collapsed by default and lifts over the intake when opened —
 * the frame's shape, and the reason the intake itself no longer has to compete
 * with a permanently-open list. Rows toggle an attach state that renders as
 * "Related context" chips inside the composer card. On Start research the
 * mission is created first, then every attached link is added as a `candidate`
 * source through the same attach-source action the evidence ledger uses, and
 * the desk opens on the new mission.
 *
 * Grouping is REAL data only: a "✦ Suggested for this prompt" group matched
 * against the live draft, then one group per saved-link category, then the
 * remainder. Suggested-angle seeds and recommendations are likewise derived
 * from real mission and link titles — with neither, those affordances simply
 * do not render.
 */

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { linkCategoryMeta, type SavedLink } from "@/lib/link-organizer";
import type { ResearchMissionMode } from "@/lib/research-missions";
import { promptRecommendations } from "@/lib/research-prompt-brief";
import { relativeTime } from "@/lib/relative-time";
import { matchSavedLinks, type QuickSaveGroup } from "./research-quick-saves";
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
  const { announce } = useAnnouncer();
  const [attached, setAttached] = useState<SavedLink[]>([]);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");

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

  const recommendations = useMemo(
    () => promptRecommendations(research.missions),
    [research.missions],
  );

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

  const groups: QuickSaveGroup[] = useMemo(
    () => matchSavedLinks(visibleLinks, draft),
    [visibleLinks, draft],
  );

  const onDraftChange = useCallback((next: string) => setDraft(next), []);

  return (
    <div className="research-intake" data-drawer-open={drawerOpen}>
      <div className="research-intake__scroll">
        <div className="research-intake__column">
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
            recommendations={recommendations}
            onDraftChange={onDraftChange}
            onOpenResources={() => onNavigate("resources")}
            onStart={async (input) => {
              const result = await research.start(input);
              if (result.ok) {
                // Attach the selected quick saves as candidate sources — the same
                // attach-source action the evidence ledger uses. A failed attach is
                // non-fatal: the mission exists (and its spend is committed), so
                // failures are collected — never aborting the loop or the desk
                // hand-off, which would invite a duplicate-spend retry.
                let failedAttaches = 0;
                for (const link of attached) {
                  const attach = await research.act(result.mission.id, {
                    action: "attach-source",
                    source: {
                      id: `link-${link.id}`,
                      title: link.title,
                      url: link.url,
                      sourceType: "web",
                      status: "candidate",
                    },
                  }).catch(() => ({ ok: false as const }));
                  if (!attach.ok) failedAttaches += 1;
                }
                setAttached([]);
                if (failedAttaches > 0) {
                  announce(`Mission started — ${failedAttaches} link${failedAttaches === 1 ? "" : "s"} failed to attach.`);
                }
                // A freshly started mission lives on the Desk — follow it there.
                onNavigate("desk", { missionId: result.mission.id });
              }
              return result;
            }}
          />
        </div>
      </div>

      {drawerOpen ? (
        <section className="research-quick-saves__sheet" aria-label="Quick saves">
          <div className="research-quick-saves__head">
            <strong>Quick saves</strong>
            <span className="research-quick-saves__count">
              tap to attach as context for this investigation
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
              className="research-quick-saves__all focus-ring"
              onClick={() => onNavigate("resources")}
            >
              All in Resources →
            </button>
          </div>

          <div className="research-quick-saves__body">
            {links.error ? (
              <p className="research-mission-error" role="alert">{links.error}</p>
            ) : links.loading ? (
              <p className="research-quick-saves__empty">Loading saves…</p>
            ) : links.links.length === 0 ? (
              <p className="research-quick-saves__empty">
                No saves yet. Type <code>/save</code> in any chat to collect links.
              </p>
            ) : groups.length === 0 ? (
              <p className="research-quick-saves__empty">
                No saves match “{query}” —{" "}
                <button type="button" className="research-quick-saves__inline" onClick={() => onNavigate("resources")}>
                  search all Resources →
                </button>
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="research-quick-saves__group">
                  <div className="research-quick-saves__group-head" data-suggested={group.suggested}>
                    <span className="research-quick-saves__group-label">{group.label}</span>
                    <span className="research-quick-saves__group-count">{group.links.length}</span>
                    <span className="research-quick-saves__rule" aria-hidden />
                    {group.hint ? (
                      <span className="research-quick-saves__group-hint">{group.hint}</span>
                    ) : null}
                  </div>
                  <ul className="research-quick-saves__list">
                    {group.links.map((entry) => {
                      const isAttached = attached.some((item) => item.id === entry.link.id);
                      const meta = linkCategoryMeta(entry.link.category);
                      return (
                        <li key={entry.link.id}>
                          <button
                            type="button"
                            className="research-quick-saves__row focus-ring"
                            aria-pressed={isAttached}
                            title={entry.why ? `${meta.label} · suggested: ${entry.why}` : meta.label}
                            onClick={() => toggleAttach(entry.link)}
                          >
                            <span className="research-quick-saves__chip" data-category={entry.link.category}>
                              <Icon name={meta.icon} width={11} height={11} aria-hidden />
                            </span>
                            <span className="research-quick-saves__title">{entry.link.title}</span>
                            {entry.why ? (
                              <span className="research-quick-saves__why">{entry.why}</span>
                            ) : null}
                            <time dateTime={entry.link.addedAt}>
                              {relativeTime(entry.link.addedAt) || "just now"}
                            </time>
                            <span className="research-quick-saves__mark" data-attached={isAttached}>
                              {isAttached ? "✓ attached" : "+ attach"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <div className="research-quick-saves__bar">
        <button
          type="button"
          className="research-quick-saves__toggle focus-ring"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <Icon name="ph:link" width={13} height={13} aria-hidden />
          Quick saves
          <span className="research-quick-saves__pill">{links.links.length}</span>
          <span className="research-quick-saves__chev" data-open={drawerOpen} aria-hidden>▴</span>
        </button>
        {attached.length > 0 ? (
          <span className="research-quick-saves__attached">
            {attached.length} attached to this run
          </span>
        ) : null}
        <span className="research-quick-saves__origin">
          saved from chat sessions and the browser extension
        </span>
      </div>
    </div>
  );
}
