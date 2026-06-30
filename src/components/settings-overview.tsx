import { Icon } from "@/lib/icon";
import {
  SECTION_HIGHLIGHTS,
  getSectionMeta,
  type Section,
} from "@/components/settings-sections";

/**
 * Rich per-section header for a settings page: an accent-marked icon, a
 * "Settings / <Section>" breadcrumb kicker, the section title + one-line
 * description, and a short "what's in here" highlight strip. Replaces the plain
 * <h1>/description block so each settings section opens with a clearer sense of
 * place.
 */
export function SettingsOverview({ section }: { section: Section }) {
  const meta = getSectionMeta(section);
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
