import { Icon } from "@/lib/icon";

/** Calm one-liner that replaces the old three zero stat-cards. */
export function CaughtUpStrip() {
  return (
    <div className="dash-strip" role="status">
      <Icon name="ph:check-circle" aria-hidden />
      <span>Reminders, replies and familiar updates are all handled.</span>
    </div>
  );
}
