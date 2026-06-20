import { Icon } from "@/lib/icon";
import { longDateLabel, relativeTime } from "@/lib/daily-report";

/** Adaptive hero: "All caught up" vs "N things need you". */
export function DashboardHero({ now, needsCount }: { now: Date; needsCount: number }) {
  const caughtUp = needsCount === 0;
  const title = caughtUp
    ? "All caught up"
    : `${needsCount} ${needsCount === 1 ? "thing needs" : "things need"} you`;
  return (
    <header className="dr-hero">
      <p className="dr-eyebrow">
        <span className="dr-eyebrow__dot" aria-hidden />
        Dashboard
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
