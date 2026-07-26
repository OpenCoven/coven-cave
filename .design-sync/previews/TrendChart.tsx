import { TrendChart } from "coven-cave";

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

// Daily active sessions over the last 14 days (x = day index).
const dailyActive = [6, 9, 8, 12, 14, 11, 7, 10, 15, 18, 16, 13, 19, 22].map((y, x) => ({ x, y }));

export const DailyActiveSessions = () => (
  <Surface>
    <TrendChart
      height={160}
      series={[
        {
          id: "active",
          label: "Active sessions",
          color: "var(--accent-presence)",
          points: dailyActive,
        },
      ]}
      ariaLabel="Daily active sessions over the last 14 days, trending up from 6 to 22"
    />
  </Surface>
);

const completed = [14, 17, 15, 19, 22, 20, 24, 23, 26, 25, 28, 27, 30, 32].map((y, x) => ({ x, y }));
const failed = [3, 2, 4, 2, 1, 3, 2, 1, 2, 1, 1, 2, 1, 0].map((y, x) => ({ x, y }));

export const CompletedVsFailed = () => (
  <Surface>
    <TrendChart
      height={160}
      series={[
        { id: "completed", label: "Completed", color: "var(--color-success)", points: completed },
        { id: "failed", label: "Failed", color: "var(--color-danger)", points: failed },
      ]}
      ariaLabel="Completed versus failed sessions per day over two weeks"
    />
  </Surface>
);

// Work-queue depth against the alert threshold of 12 open tasks.
const queueDepth = [3, 5, 4, 7, 9, 8, 11, 13, 10, 8, 12, 14, 9, 6].map((y, x) => ({ x, y }));

export const QueueDepthWithThreshold = () => (
  <Surface>
    <TrendChart
      height={140}
      threshold={12}
      fill={false}
      series={[
        { id: "queue", label: "Queue depth", color: "var(--accent-presence)", points: queueDepth },
      ]}
      ariaLabel="Open tasks in the work queue over two weeks against an alert threshold of 12; two days breach it"
    />
  </Surface>
);
