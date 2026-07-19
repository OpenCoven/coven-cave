import { Heatmap } from "coven-cave";

function Surface({ children, width = 420 }: { children: React.ReactNode; width?: number }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        width,
      }}
    >
      {children}
    </div>
  );
}

// Deterministic pseudo-random so captures are stable run to run.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = ["6a", "8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];

const rand = seeded(7);
const activityCells = WEEKDAYS.flatMap((row, ri) =>
  HOURS.map((col, ci) => {
    // Weekdays + working hours run hotter; weekends cool off.
    const weekend = ri >= 5 ? 0.3 : 1;
    const midday = ci >= 2 && ci <= 6 ? 1 : 0.4;
    return { row, col, value: Math.round(rand() * 9 * weekend * midday) };
  }),
);

const rampFor = (max: number) => (value: number) =>
  value === 0
    ? "var(--bg-raised)"
    : `color-mix(in oklch, var(--accent-presence) ${Math.round(18 + (value / max) * 82)}%, transparent)`;

export const ActivityByWeekdayHour = () => (
  <Surface>
    <Heatmap
      rows={WEEKDAYS}
      cols={HOURS}
      cells={activityCells}
      colorFor={rampFor(9)}
      height={180}
      ariaLabel="Session activity by weekday and hour, busiest midday Tuesday through Thursday"
      cellTitle={(c) => `${c.row} ${c.col}: ${c.value} sessions`}
    />
  </Surface>
);

const FAMILIARS = ["Nova", "Sage", "Ember", "Wisp"];
const rand2 = seeded(23);
const loadCells = FAMILIARS.flatMap((row) =>
  WEEKDAYS.map((col) => ({ row, col, value: Math.round(rand2() * 12) })),
);

export const FamiliarLoadByDay = () => (
  <Surface width={360}>
    <Heatmap
      rows={FAMILIARS}
      cols={WEEKDAYS}
      cells={loadCells}
      colorFor={rampFor(12)}
      height={120}
      ariaLabel="Sessions per familiar per weekday over the last week"
    />
  </Surface>
);

export const SuccessRamp = () => (
  <Surface width={360}>
    <Heatmap
      rows={["Completed", "Failed"]}
      cols={["W1", "W2", "W3", "W4", "W5", "W6"]}
      cells={[
        { row: "Completed", col: "W1", value: 18 },
        { row: "Completed", col: "W2", value: 24 },
        { row: "Completed", col: "W3", value: 21 },
        { row: "Completed", col: "W4", value: 30 },
        { row: "Completed", col: "W5", value: 27 },
        { row: "Completed", col: "W6", value: 33 },
        { row: "Failed", col: "W1", value: 4 },
        { row: "Failed", col: "W2", value: 2 },
        { row: "Failed", col: "W3", value: 5 },
        { row: "Failed", col: "W4", value: 1 },
        { row: "Failed", col: "W5", value: 2 },
        { row: "Failed", col: "W6", value: 0 },
      ]}
      colorFor={(v) =>
        v === 0
          ? "var(--bg-raised)"
          : `color-mix(in oklch, var(--color-success) ${Math.round(20 + (v / 33) * 80)}%, transparent)`
      }
      height={72}
    />
  </Surface>
);
