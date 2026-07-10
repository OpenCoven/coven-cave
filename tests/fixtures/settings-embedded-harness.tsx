import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsShell } from "@/components/settings-shell";

function SettingsEmbeddedHarness() {
  const [embedded, setEmbedded] = useState(true);

  return (
    <main>
      <button type="button" onClick={() => setEmbedded((current) => !current)}>
        Toggle settings embedding
      </button>
      <div className="shell-frame">
        <section className="workspace-pane-page" aria-label="Settings pane" tabIndex={-1}>
          <SettingsShell embedded={embedded} />
        </section>
      </div>
      <section className="workspace-pane-page" aria-label="Sibling pane" tabIndex={-1}>
        <button type="button">Sibling pane control</button>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing Settings embedded harness root");

createRoot(rootElement).render(
  <StrictMode>
    <SettingsEmbeddedHarness />
  </StrictMode>,
);
