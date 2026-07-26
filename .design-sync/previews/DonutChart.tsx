import { DonutChart } from "coven-cave";

function Surface({ children, width = 240 }: { children: React.ReactNode; width?: number }) {
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

export const SessionOutcomes = () => (
  <Surface>
    <DonutChart
      size={160}
      data={[
        { label: "Completed", value: 48, color: "var(--color-success)" },
        { label: "Running", value: 9, color: "var(--accent-presence)" },
        { label: "Failed", value: 5, color: "var(--color-danger)" },
      ]}
      ariaLabel="Session outcomes: 48 completed, 9 running, 5 failed"
    />
  </Surface>
);

export const TokensByFamiliar = () => (
  <Surface>
    <DonutChart
      size={160}
      thickness={22}
      data={[
        { label: "Nova", value: 412, color: "var(--accent-presence)" },
        {
          label: "Sage",
          value: 268,
          color: "color-mix(in oklch, var(--accent-presence) 65%, transparent)",
        },
        {
          label: "Ember",
          value: 190,
          color: "color-mix(in oklch, var(--accent-presence) 40%, transparent)",
        },
        {
          label: "Wisp",
          value: 84,
          color: "color-mix(in oklch, var(--accent-presence) 22%, transparent)",
        },
      ]}
      ariaLabel="Tokens spent by familiar (thousands): Nova 412, Sage 268, Ember 190, Wisp 84"
    />
  </Surface>
);

export const ThickRing = () => (
  <Surface width={200}>
    <DonutChart
      size={120}
      thickness={44}
      data={[
        { label: "Read", value: 31, color: "var(--accent-presence)" },
        { label: "To read", value: 12, color: "var(--color-warning)" },
      ]}
    />
  </Surface>
);
