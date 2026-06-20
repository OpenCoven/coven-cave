import { Icon } from "@/lib/icon";
import { greeting, longDateLabel, relativeTime } from "@/lib/daily-report";

/** Adaptive hero: greeting + "All caught up" vs "N things need you". */
export function DashboardHero({ now, needsCount }: { now: Date; needsCount: number }) {
  const caughtUp = needsCount === 0;
  const hour = now.getHours();
  const greetIcon = hour < 6 || hour >= 19 ? "ph:moon" : "ph:sun";
  const title = caughtUp
    ? "All caught up"
    : `${needsCount} ${needsCount === 1 ? "thing needs" : "things need"} you`;
  return (
    <header className="dr-hero">
      <p className="dr-eyebrow">
        <Icon name={greetIcon} className="dr-eyebrow__icon" aria-hidden />
        {greeting(now)}
      </p>
      <h1 className="dr-title">{title}</h1>
      <p className="dr-subtitle">
        {caughtUp ? "Nothing needs you right now." : "Clear these and you're done for the day."}{" "}
        {longDateLabel(now)}.
      </p>
      <div className="dr-meta-row">
        <span className="dr-meta-row__item">
          <Icon name="ph:clock" aria-hidden />
          Updated {relativeTime(now.toISOString(), now) || "just now"}
        </span>
        <span className="dr-meta-row__item">
          <Icon name={caughtUp ? "ph:check-circle" : "ph:warning-circle"} aria-hidden />
          {caughtUp
            ? "All caught up"
            : `${needsCount} ${needsCount === 1 ? "item needs" : "items need"} attention`}
        </span>
      </div>
    </header>
  );
}
