"use client";

/**
 * NavSectionTabs — the global Home / Chat switcher.
 */

import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { NAV_SECTIONS, type NavSection } from "@/lib/nav-section";

export function NavSectionTabs({
  section,
  onSectionChange,
  variant = "rail",
}: {
  section: NavSection;
  onSectionChange: (section: NavSection) => void;
  variant?: "rail" | "titlebar";
}) {
  return (
    <div className={`nav-sections nav-sections--${variant}`} role="tablist" aria-label="Workspace sections">
      {NAV_SECTIONS.map((entry) => {
        const active = entry.id === section;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`nav-section-tab-${entry.id}`}
            aria-selected={active}
            aria-controls={`nav-section-panel-${entry.id}`}
            tabIndex={active ? 0 : -1}
            title={`${entry.label} — ${entry.description} (${entry.kbd})`}
            className={`nav-sections__tab focus-ring${active ? " is-active" : ""}`}
            onClick={() => onSectionChange(entry.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const index = NAV_SECTIONS.findIndex((s) => s.id === section);
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = NAV_SECTIONS[(index + delta + NAV_SECTIONS.length) % NAV_SECTIONS.length]!;
              onSectionChange(next.id);
              document.getElementById(`nav-section-tab-${next.id}`)?.focus();
            }}
          >
            <Icon
              name={entry.iconName}
              width={CAVE_ICON_SIZE.sidePanelNav}
              height={CAVE_ICON_SIZE.sidePanelNav}
              className="nav-sections__icon"
              aria-hidden
            />
            <span className="nav-sections__label">{entry.label}</span>
          </button>
        );
      })}
    </div>
  );
}
