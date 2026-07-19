import { BarChart } from "coven-cave";

function Surface({ children, width = 360 }: { children: React.ReactNode; width?: number }) {
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

const sessionsPerFamiliar = [
  { label: "Nova", value: 34 },
  { label: "Sage", value: 21 },
  { label: "Ember", value: 27 },
  { label: "Wisp", value: 12 },
];

export const SessionsPerFamiliar = () => (
  <Surface>
    <BarChart data={sessionsPerFamiliar} height={160} />
  </Surface>
);

export const OutcomeColors = () => (
  <Surface>
    <BarChart
      height={140}
      data={[
        { label: "Completed", value: 48, color: "var(--color-success)" },
        { label: "Running", value: 9, color: "var(--accent-presence)" },
        { label: "Interrupted", value: 6, color: "var(--color-warning)" },
        { label: "Failed", value: 4, color: "var(--color-danger)" },
      ]}
    />
  </Surface>
);

export const CompactWeek = () => (
  <Surface width={280}>
    <BarChart
      height={90}
      data={[
        { label: "Mon", value: 8 },
        { label: "Tue", value: 12 },
        { label: "Wed", value: 5 },
        { label: "Thu", value: 15 },
        { label: "Fri", value: 11 },
        { label: "Sat", value: 3 },
        { label: "Sun", value: 6 },
      ]}
    />
  </Surface>
);
