import { RelativeTime } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 18,
        flexWrap: "wrap",
        color: "var(--text-primary, #e8e6f0)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RecentActivity = () => (
  <Surface>
    <span>
      Nova replied <RelativeTime iso={new Date(Date.now() - 30_000).toISOString()} />
    </span>
    <span>
      Scout summoned <RelativeTime iso={new Date(Date.now() - 5 * MIN).toISOString()} />
    </span>
    <span>
      Board card moved <RelativeTime iso={new Date(Date.now() - 3 * HOUR).toISOString()} />
    </span>
  </Surface>
);

export const OlderTimestamps = () => (
  <Surface>
    <span>
      Grimoire entry <RelativeTime iso={new Date(Date.now() - 2 * DAY).toISOString()} />
    </span>
    <span>
      Coven founded <RelativeTime iso={new Date(Date.now() - 6 * DAY).toISOString()} />
    </span>
    <span>
      First summon <RelativeTime iso={new Date(Date.now() - 30 * DAY).toISOString()} />
    </span>
  </Surface>
);

export const MutedStyling = () => (
  <Surface>
    <RelativeTime
      iso={new Date(Date.now() - 12 * MIN).toISOString()}
      className=""
    />
    <span style={{ color: "var(--text-muted)" }}>
      Last heartbeat <RelativeTime iso={new Date(Date.now() - 90 * MIN).toISOString()} />
    </span>
  </Surface>
);

export const NeverRanFallback = () => (
  <Surface>
    <span>
      Last run: <RelativeTime iso={null} fallback="never" />
    </span>
    <span>
      Last memory scan: <RelativeTime iso={undefined} fallback="not yet" />
    </span>
  </Surface>
);
