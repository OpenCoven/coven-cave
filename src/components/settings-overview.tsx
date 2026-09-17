import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  SECTION_HIGHLIGHTS,
  getSectionMeta,
  type Section,
} from "@/components/settings-sections";
import { settingsGroupId } from "@/components/ui/settings-group";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useGeneralSettingsData } from "./settings-general-data";
import {
  resolveGeneralSummaryState,
} from "@/lib/settings-general-summary";

function useGeneralSummary() {
  const data = useGeneralSettingsData();
  if (!data) return { summary: {}, status: "loading" as const, retry: () => {} };
  const { workspace, sync } = data;
  const current = {
    status: "loading" as const,
    summary: {
      workspacePath: workspace.value?.workspacePath,
      syncEnabled: sync.value?.config.enabled,
    },
  };
  const state = resolveGeneralSummaryState(current, {
    config: { ok: workspace.status === "ready", value: workspace.value },
    sync: { ok: sync.status === "ready", value: sync.value },
  });
  return {
    ...state,
    status: workspace.status === "loading" || sync.status === "loading" ? "loading" as const : state.status,
    retry: data.refresh,
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
  } = useGeneralSummary();

  if (variant === "control-sheet") {
    const anchors = [
      { label: "Workspace", id: settingsGroupId("Workspace") },
      { label: "Backup", id: settingsGroupId("Backup") },
      { label: "Chat", id: settingsGroupId("Chat") },
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
