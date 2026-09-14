"use client";

/**
 * review-mobile-tabs — the narrow-width pane switcher.
 *
 * It is a sibling of the layout, never a child of one pane. It used to render
 * inside the workspace header, which lives in `.rd-main` — and the narrow-width
 * rules hide `.rd-main` whenever the chosen view is not the diff. Switching to
 * Queue therefore hid the control that switches back, stranding a narrow
 * reader in one pane with no way out. Nothing in a source-text test can see
 * that; driving the surface at 820px can.
 */

export type ReviewMobileView = "queue" | "files" | "evidence";

const TABS: readonly { id: ReviewMobileView; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "files", label: "Diff" },
  { id: "evidence", label: "Inspector" },
];

export function ReviewMobileTabs({
  view,
  onView,
}: {
  view: ReviewMobileView;
  onView: (view: ReviewMobileView) => void;
}) {
  return (
    <div className="rd-mobile-tabs" role="tablist" aria-label="Review Deck views">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="rd-mobile-tab focus-ring"
          aria-selected={view === tab.id}
          tabIndex={view === tab.id ? 0 : -1}
          onClick={() => onView(tab.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const index = TABS.findIndex((item) => item.id === tab.id);
            const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
            event.preventDefault();
            onView(TABS[next].id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
