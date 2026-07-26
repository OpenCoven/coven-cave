import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  SECTION_HIGHLIGHTS,
  getSectionMeta,
  type Section,
} from "@/components/settings-sections";
import { settingsGroupId } from "@/components/ui/settings-group";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

type GeneralSummary = {
  workspacePath?: string;
  readyVoices?: number;
  totalVoices?: number;
  syncEnabled?: boolean;
};

function useGeneralSummary(active: boolean): GeneralSummary | null {
  const [summary, setSummary] = useState<GeneralSummary | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const read = async (request: Promise<Response>): Promise<Record<string, unknown> | null> => {
      try {
        const response = await request;
        if (!response.ok) return null;
        return await response.json() as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    void Promise.all([
      read(fetch("/api/daemon/status", { cache: "no-store", signal: controller.signal })),
      read(fetch("/api/voice/engines", { cache: "no-store", signal: controller.signal })),
      read(fetch("/api/backup/sync", { cache: "no-store", signal: controller.signal })),
    ]).then(([daemon, voice, sync]) => {
      if (controller.signal.aborted) return;
      const models = Array.isArray(voice?.tts) ? voice.tts : null;
      const syncConfig = sync?.config && typeof sync.config === "object"
        ? sync.config as Record<string, unknown>
        : null;
      setSummary({
        workspacePath:
          typeof daemon?.workspacePath === "string" ? daemon.workspacePath : undefined,
        readyVoices: models
          ? models.filter((model) => {
              if (!model || typeof model !== "object") return false;
              const item = model as Record<string, unknown>;
              return item.ready === true && item.verified === true;
            }).length
          : undefined,
        totalVoices: models?.length,
        syncEnabled:
          typeof syncConfig?.enabled === "boolean" ? syncConfig.enabled : undefined,
      });
    });

    return () => controller.abort();
  }, [active]);

  return summary;
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
  const summary = useGeneralSummary(variant === "control-sheet");

  if (variant === "control-sheet") {
    const anchors = [
      { label: "Workspace", id: settingsGroupId("Workspace") },
      { label: "Backup", id: settingsGroupId("Backup") },
      { label: "Startup", id: settingsGroupId("Startup") },
    ] as const;
    const summaryParts = [
      summary?.workspacePath,
      typeof summary?.readyVoices === "number" &&
      typeof summary?.totalVoices === "number"
        ? `${summary.readyVoices} of ${summary.totalVoices} voices ready`
        : null,
      typeof summary?.syncEnabled === "boolean"
        ? `sync ${summary.syncEnabled ? "on" : "off"}`
        : null,
    ].filter((part): part is string => Boolean(part));

    const jumpTo = (id: string) => {
      document.getElementById(id)?.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
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
            <p className="settings-overview__description" role="status">
              {summaryParts.length > 0
                ? summaryParts.join(" · ")
                : "Loading General settings summary…"}
            </p>
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
