import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspacePanePage } from "@/components/workspace-pane-page";

const PRIVATE_DIAGNOSTIC =
  "token=sk-pane-secret /Users/operator/private.env https://internal.example.test/pane-debug";

let mountSequence = 0;

function CrashableContent({ shouldCrash, onCrash }: { shouldCrash: boolean; onCrash: () => void }) {
  const [mountId] = useState(() => ++mountSequence);
  if (shouldCrash) throw new Error(PRIVATE_DIAGNOSTIC);

  return (
    <div data-testid="ready-child" data-mount-id={mountId}>
      <p>Ready pane content</p>
      <button type="button" onClick={onCrash}>Crash pane</button>
    </div>
  );
}

function WorkspacePanePageHarness() {
  const [instanceId, setInstanceId] = useState("pane:group");
  const [mode, setMode] = useState<"ready" | "loading" | "unavailable">("ready");
  const [shouldCrash, setShouldCrash] = useState(false);
  const [resetSequence, setResetSequence] = useState(0);
  const [recoveries, setRecoveries] = useState(0);

  const showReady = () => {
    setShouldCrash(false);
    setMode("ready");
  };

  return (
    <main>
      <div aria-label="Harness controls">
        <button type="button">Sibling survives</button>
        <button type="button" onClick={() => setShouldCrash(false)}>Prepare successful retry</button>
        <button
          type="button"
          onClick={() => {
            const next = resetSequence + 1;
            setResetSequence(next);
            setShouldCrash(false);
            setMode("ready");
            setInstanceId(`pane-reset-${next}`);
          }}
        >
          Reset identity successfully
        </button>
        <button type="button" onClick={() => setMode("loading")}>Show loading</button>
        <button type="button" onClick={() => setMode("unavailable")}>Show unavailable</button>
        <button type="button" onClick={showReady}>Show ready</button>
        <output aria-label="Recovery count">{recoveries}</output>
      </div>

      {mode === "loading" ? (
        <WorkspacePanePage instanceId={instanceId} landmark="Board pane" status="loading" />
      ) : mode === "unavailable" ? (
        <WorkspacePanePage
          instanceId={instanceId}
          landmark="Board pane"
          unavailable={{
            reason: "The board is temporarily offline.",
            recoveryLabel: "Recover pane",
            onRecover: () => {
              setRecoveries((count) => count + 1);
              showReady();
            },
          }}
        />
      ) : (
        <WorkspacePanePage instanceId={instanceId} landmark="Board pane">
          <CrashableContent shouldCrash={shouldCrash} onCrash={() => setShouldCrash(true)} />
        </WorkspacePanePage>
      )}
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing workspace pane harness root");

createRoot(rootElement).render(
  <StrictMode>
    <WorkspacePanePageHarness />
  </StrictMode>,
);
