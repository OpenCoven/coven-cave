import { Icon } from "@/lib/icon";
import { SECTION_HIGHLIGHTS, getSectionMeta, type Section } from "./settings-sections";

export function SettingsOverview({ section }: { section: Section }) {
  const meta = getSectionMeta(section);
  return (
    <section className="settings-overview" aria-label={`${meta.label} settings overview`}>
      <div className="settings-overview__title-row">
        <div
          className="settings-overview__mark"
          style={{ backgroundColor: meta.accent }}
          aria-hidden="true"
        >
          <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} width={18} />
        </div>
        <div className="min-w-0">
          <p className="settings-overview__kicker">Settings / {meta.label}</p>
          <h1 className="settings-overview__title">{meta.label}</h1>
          <p className="settings-overview__description">{meta.description}</p>
        </div>
      </div>
      <div className="settings-overview-strip">
        {SECTION_HIGHLIGHTS[section].map((label) => (
          <div key={label} className="settings-overview-strip__item">
            <Icon name="ph:check-circle" width={13} className="settings-overview-strip__icon" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
