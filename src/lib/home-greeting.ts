// Pure time-of-day greeting for the home hero's eyebrow. Deterministic on the
// hour so it unit-tests exactly; the component samples the local clock after
// mount (client-only) to avoid SSR hydration drift.

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Deep night in the cave";
}
