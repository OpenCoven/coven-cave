import { Button, IconButton, SearchInput, ViewHeader } from "coven-cave";
import { useState } from "react";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  );
}

export const BoardHeader = () => {
  const [query, setQuery] = useState("");
  return (
    <Surface>
      <ViewHeader
        eyebrow="Board"
        title="Work queue"
        search={
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            placeholder="Search tasks…"
          />
        }
        filters={
          <Button variant="ghost" size="sm" leadingIcon="funnel">
            Filters
          </Button>
        }
        actions={
          <>
            <IconButton icon="arrows-clockwise" aria-label="Refresh board" />
            <Button variant="primary" size="sm" leadingIcon="plus">
              New task
            </Button>
          </>
        }
      />
    </Surface>
  );
};

export const SimpleTitle = () => (
  <Surface>
    <ViewHeader
      title="Grimoire"
      actions={
        <Button variant="secondary" size="sm" leadingIcon="plus">
          New entry
        </Button>
      }
    />
  </Surface>
);

export const AnalyticsHeader = () => (
  <Surface>
    <ViewHeader
      eyebrow="Analytics"
      title="The pulse"
      filters={
        <>
          <Button variant="ghost" size="sm" leadingIcon="calendar-blank">
            Last 14 days
          </Button>
          <Button variant="ghost" size="sm" leadingIcon="funnel">
            All familiars
          </Button>
        </>
      }
      actions={<IconButton icon="gear-six" aria-label="Analytics settings" />}
    />
  </Surface>
);
