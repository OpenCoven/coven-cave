import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  SECTION_HIGHLIGHTS,
  getSectionMeta,
  type Section,
} from "@/components/settings-sections";
import { settingsGroupId } from "@/components/ui/settings-group";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  createGeneralSummaryLoader,
  resolveGeneralSummaryState,
  type GeneralSummaryState,
} from "@/lib/settings-general-summary";

function useGeneralSummary(active: boolean) {
  const [state, setState] = useState<GeneralSummaryState>({
    status: "loading",
    summary: {},
  });
  const summaryLoaderRef = useRef<ReturnType<typeof createGeneralSummaryLoader> | null>(null);

  const loadSummary = useCallback(async (showLoading = false) => {
    if (!active) return;
    if (showLoading) {
      setState((current) => ({ ...current, status: "loading" }));
    }
    if (!summaryLoaderRef.current) {
      summaryLoaderRef.current = createGeneralSummaryLoader();
    }
    const sources = await summaryLoaderRef.current.load();
    if (!sources) return;
    setState((current) => resolveGeneralSummaryState(current, sources));
  }, [active]);

  useEffect(() => {
    if (!active) {
      summaryLoaderRef.current?.dispose();
      summaryLoaderRef.current = null;
      return;
    }
    void loadSummary(true);
    const refreshSummary = () => { void loadSummary(); };
    window.addEventListener("cave:backup-sync-refresh", refreshSummary);
    return () => {
      window.removeEventListener("cave:backup-sync-refresh", refreshSummary);
      summaryLoaderRef.current?.dispose();
      summaryLoaderRef.current = null;
    };
  }, [active, loadSummary]);

  usePausablePoll(() => {
    void loadSummary();
  }, 30_000, {
    enabled: active,
    pauseWhileInputActive: true,
  });

  return {
    ...state,
    retry: () => { void loadSummary(true); },
  };
}

/**
 * Rich per-section header for a settings page: an accent-marked icon, a
 * "Settings / <Section>" breadcrumb kicker, the section title + one-line
 * description, and a short "what's in here" highlight strip. Replaces the plain
 * <h1>/description block so each settings section opens with a clearer sense of
 * place.
 */
export function SettingsOverview({
  section,
  variant = "default",
}: {
  section: Section;
  variant?: "default" | "control-sheet";
}) {
  const meta = getSectionMeta(section);
  const {
    summary,
    status: summaryStatus,
    retry: retrySummary,
  } = useGeneralSummary(variant === "control-sheet");

  if (variant === "control-sheet") {
    const anchors = [
      { label: "Workspace", id: settingsGroupId("Workspace") },
      { label: "Backup", id: settingsGroupId("Backup") },
      { label: "Startup", id: settingsGroupId("Startup") },
    ] as const;
    const summaryParts = [
      summary?.workspacePath,
      typeof summary?.syncEnabled === "boolean"
        ? `sync ${summary.syncEnabled ? "on" : "off"}`
        : null,
    ].filter((part): part is string => Boolean(part));

    const summaryHasProblem =
      summaryStatus === "partial" || summaryStatus === "error";
    const summaryMessage =
      summaryStatus === "partial"
        ? `${summaryParts.join(" · ")} · Some General settings details couldn't refresh.`
        : summaryStatus === "error"
        ? summaryParts.length > 0
          ? `${summaryParts.join(" · ")} · Couldn't refresh General settings summary.`
          : "Couldn't load General settings summary."
        : summaryParts.length > 0
          ? summaryParts.join(" · ")
          : "Loading General settings summary…";

    const jumpTo = (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      target.focus({ preventScroll: true });
    };

    return (
      <header
        className="settings-overview settings-overview--control-sheet"
        aria-label={`${meta.label} settings`}
      >
        <div className="settings-overview__title-row">
          <span className="settings-overview__mark" aria-hidden="true">
            <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} width={18} />
          </span>
          <div className="min-w-0">
            <p className="settings-overview__kicker">Settings · {meta.label}</p>
            <h1 className="settings-overview__title">{meta.label}</h1>
            <div
              className="settings-overview__summary"
              role={summaryHasProblem ? "alert" : "status"}
            >
              <span>{summaryMessage}</span>
              {summaryHasProblem ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="settings-overview__summary-retry"
                  onClick={retrySummary}
                  leadingIcon="ph:arrows-clockwise"
                >
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <nav className="settings-overview-anchors" aria-label="General settings sections">
          {anchors.map(({ label, id }, index) => (
            <button
              key={label}
              type="button"
              className="settings-overview-anchor focus-ring"
              onClick={() => jumpTo(id)}
            >
              <span
                className={`settings-overview-anchor__dot${index === 0 ? " is-accent" : ""}`}
                aria-hidden="true"
              />
              {label}
            </button>
          ))}
        </nav>
      </header>
    );
  }

  return (
    <header className="settings-overview" aria-label={`${meta.label} settings`}>
      <div className="settings-overview__title-row">
        <span
          className="settings-overview__mark"
          style={{
            backgroundColor: `color-mix(in oklch, ${meta.accent} 18%, transparent)`,
            color: meta.accent,
          }}
          aria-hidden="true"
        >
          <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} width={18} />
        </span>
        <div className="min-w-0">
          <p className="settings-overview__kicker">Settings · {meta.label}</p>
          <h1 className="settings-overview__title">{meta.label}</h1>
          <p className="settings-overview__description">{meta.description}</p>
        </div>
      </div>
      <ul className="settings-overview-strip" aria-label="In this section">
        {SECTION_HIGHLIGHTS[section].map((label) => (
          <li key={label} className="settings-overview-strip__item">
            <Icon name="ph:check-circle" width={12} className="settings-overview-strip__icon" />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </header>
  );
}
