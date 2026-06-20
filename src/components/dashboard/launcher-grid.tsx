import { SectionHead, QuickLink } from "@/components/daily-report-ui";
import type { IconName } from "@/lib/icon";

const LINKS: { href: string; icon: IconName; label: string; sub: string }[] = [
  { href: "/", icon: "ph:house-bold", label: "Home", sub: "Your cave" },
  { href: "/#card-", icon: "ph:kanban-bold", label: "Board", sub: "Cards & tasks" },
  { href: "/", icon: "ph:calendar-bold", label: "Calendar", sub: "Reminders & agenda" },
  { href: "/", icon: "ph:books-bold", label: "Library", sub: "Saved knowledge" },
  { href: "/dashboard/retro", icon: "ph:arrows-clockwise-bold", label: "Retro Runs", sub: "Eval-loop history" },
  { href: "/settings", icon: "ph:gear-six", label: "Settings", sub: "Preferences" },
  { href: "/aesthetic", icon: "ph:paint-brush", label: "Aesthetic", sub: "Design tokens" },
];

/** "full" = caught-up state (subtitles, multi-row). "compact" = busy state (dense row). */
export function LauncherGrid({ variant }: { variant: "full" | "compact" }) {
  const full = variant === "full";
  return (
    <section className="dr-section" aria-label="Workspaces">
      <SectionHead icon="ph:squares-four" title={full ? "Jump back in" : "Workspaces"} />
      <div className={`dr-quicklinks${full ? "" : " dash-launcher--compact"}`}>
        {LINKS.map((l) => (
          <QuickLink key={l.label} href={l.href} icon={l.icon} label={l.label} sub={full ? l.sub : undefined} />
        ))}
      </div>
    </section>
  );
}
