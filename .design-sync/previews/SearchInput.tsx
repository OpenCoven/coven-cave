import { useState } from "react";
import { SearchInput } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxWidth: 360,
      }}
    >
      {children}
    </div>
  );
}

export const Empty = () => {
  const [query, setQuery] = useState("");
  return (
    <Surface>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search grimoire…"
      />
    </Surface>
  );
};

export const WithQuery = () => {
  const [query, setQuery] = useState("summoning circle");
  return (
    <Surface>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        onClear={() => setQuery("")}
        placeholder="Search grimoire…"
      />
    </Surface>
  );
};

export const CustomIconAndHint = () => {
  const [query, setQuery] = useState("");
  return (
    <Surface>
      <SearchInput
        value={query}
        onValueChange={setQuery}
        leadingIcon="ph:book-open"
        placeholder="Search wards…"
        hint={
          <span>
            Try <code>owner:nova</code> or <code>kind:ward</code>
          </span>
        }
      />
    </Surface>
  );
};
