import { Sparkline } from "coven-cave";

function Surface({ children, width = 260 }: { children: React.ReactNode; width?: number }) {
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

const tokensSpent = [
  { label: "Jul 6", value: 42 },
  { label: "Jul 7", value: 58 },
  { label: "Jul 8", value: 51 },
  { label: "Jul 9", value: 74 },
  { label: "Jul 10", value: 66 },
  { label: "Jul 11", value: 39 },
  { label: "Jul 12", value: 47 },
  { label: "Jul 13", value: 62 },
  { label: "Jul 14", value: 81 },
  { label: "Jul 15", value: 77 },
  { label: "Jul 16", value: 93 },
  { label: "Jul 17", value: 88 },
  { label: "Jul 18", value: 104 },
  { label: "Jul 19", value: 97 },
];

export const TokensSpent = () => (
  <Surface>
    <Sparkline points={tokensSpent} color="var(--accent-presence)" />
  </Surface>
);

const sessionsPerDay = [
  { label: "Mon", value: 4 },
  { label: "Tue", value: 7 },
  { label: "Wed", value: 6 },
  { label: "Thu", value: 9 },
  { label: "Fri", value: 8 },
  { label: "Sat", value: 2 },
  { label: "Sun", value: 5 },
];

export const TallSessions = () => (
  <Surface>
    <Sparkline points={sessionsPerDay} color="var(--color-success)" height={44} />
  </Surface>
);

// Days with no telemetry come through as null — the line skips them.
const withGaps = [
  { label: "Jul 8", value: 12 },
  { label: "Jul 9", value: 18 },
  { label: "Jul 10", value: null },
  { label: "Jul 11", value: 15 },
  { label: "Jul 12", value: 22 },
  { label: "Jul 13", value: null },
  { label: "Jul 14", value: 19 },
  { label: "Jul 15", value: 26 },
];

export const MissingDays = () => (
  <Surface>
    <Sparkline points={withGaps} color="var(--color-warning)" height={32} />
  </Surface>
);
