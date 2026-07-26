import { PulseBars } from "coven-cave";

function Surface({ children, width = 280 }: { children: React.ReactNode; width?: number }) {
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

const week = [
  { key: "2026-07-13", label: "Mon Jul 13", count: 4 },
  { key: "2026-07-14", label: "Tue Jul 14", count: 7 },
  { key: "2026-07-15", label: "Wed Jul 15", count: 2 },
  { key: "2026-07-16", label: "Thu Jul 16", count: 9 },
  { key: "2026-07-17", label: "Fri Jul 17", count: 6 },
  { key: "2026-07-18", label: "Sat Jul 18", count: 0 },
  { key: "2026-07-19", label: "Sun Jul 19", count: 3 },
];

export const WeeklyPulse = () => (
  <Surface>
    <div style={{ width: 150 }}>
      <PulseBars pulse={week} label="31 sessions this week, busiest Thursday" showTips />
    </div>
  </Surface>
);

// The bars grid sizes off its container (grid-auto-columns: 1fr), so each
// instance gets an explicit width when laid out in a flex row.
export const Sizes = () => (
  <Surface width={520}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
      <div style={{ width: 90 }}>
        <PulseBars pulse={week} size="sm" label="Small pulse" />
      </div>
      <div style={{ width: 130 }}>
        <PulseBars pulse={week} size="md" label="Medium pulse" />
      </div>
      <div style={{ width: 190 }}>
        <PulseBars pulse={week} size="lg" label="Large pulse" />
      </div>
    </div>
  </Surface>
);

export const DayPicker = () => (
  <Surface>
    <PulseBars
      pulse={week}
      size="lg"
      label="Daily session counts"
      onSelectDay={() => {}}
      selectedKey="2026-07-16"
    />
  </Surface>
);
