"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@/styles/journal.css";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { CanvasList } from "./canvas-list";
import { JournalEntries } from "./journal-entries";
import type { Familiar } from "@/lib/types";

const TABS = [
  { id: "journal", label: "Journal" },
  { id: "canvas", label: "Canvas" },
] as const;
type JournalTab = (typeof TABS)[number]["id"];

const TAB_KEY = "cave:journal:tab";

function isTab(v: unknown): v is JournalTab {
  return v === "journal" || v === "canvas";
}

export function JournalView({
  familiars,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  const [tab, setTab] = useState<JournalTab>("journal");
  const tablistRef = useRef<HTMLElement | null>(null);
  useRovingTabIndex({ containerRef: tablistRef, itemSelector: '[role="tab"]', orientation: "horizontal" });

  // Persist only on an explicit choice (click / deep-link event). We deliberately
  // do NOT persist in a `[tab]` effect: that would write the default "journal" on
  // mount and clobber a deep-linked tab before the adopt-effect below settles
  // (visible under React StrictMode's double-invoked mount effects).
  const selectTab = useCallback((next: JournalTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  // Adopt the persisted/requested tab after mount (hydration-safe). Read-only —
  // it never writes, so re-invoking it can't clobber the deep-link.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (isTab(saved)) setTab(saved);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  // Switch tabs in response to a request fired while already mounted.
  useEffect(() => {
    const onSet = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (isTab(t)) selectTab(t);
    };
    window.addEventListener("cave:journal-set-tab", onSet as EventListener);
    return () => window.removeEventListener("cave:journal-set-tab", onSet as EventListener);
  }, [selectTab]);

  return (
    <div className="journal-view">
      <header className="journal-view__head">
        <h1 className="journal-view__title">Journal</h1>
        <nav ref={tablistRef} role="tablist" aria-label="Journal sections" className="journal-tabs">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`journal-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`journal-panel-${t.id}`}
                className={`journal-tab${active ? " is-active" : ""}`}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>
      <div
        role="tabpanel"
        id={`journal-panel-${tab}`}
        aria-labelledby={`journal-tab-${tab}`}
        className="journal-view__panel"
      >
        {tab === "canvas" ? (
          <CanvasList familiars={familiars} activeFamiliarId={activeFamiliarId} />
        ) : (
          <JournalEntries familiars={familiars} activeFamiliarId={activeFamiliarId} />
        )}
      </div>
    </div>
  );
}
