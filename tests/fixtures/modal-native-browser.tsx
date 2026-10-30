// Manual native qualification fixture. Bundle with esbuild and the production
// styles into an isolated local origin; never mount this in the user workspace.
// BrowserPane uses the real Tauri bridge. The child page must be local and must
// expose a counter so hide/show can be distinguished from a reload.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserPane } from "../../src/components/browser-pane";
import { Modal } from "../../src/components/ui/modal";
import { WorkspaceSurfacePreferencesProvider } from "../../src/lib/surface-preferences";
import { useTauriPlatform } from "../../src/lib/tauri-platform";

const childUrl = new URL("./child.html", window.location.href).href;
localStorage.setItem("cave.browser.pinnedTabs.v1", JSON.stringify([
  { id: "fixture", url: childUrl, title: "Native child fixture", pinned: true, kind: "pinned" },
]));
localStorage.setItem("cave.browser.railPinned.v1", "0");
localStorage.setItem("cave:surface-preferences:v1", JSON.stringify({
  version: 1,
  values: { "browser.activeTabId": "fixture", "browser.address": childUrl },
}));

function Fixture() {
  const platform = useTauriPlatform();
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [retained, setRetained] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  return <WorkspaceSurfacePreferencesProvider>
    <main style={{ height: "100vh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", paddingTop: 40 }}>
      <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
        <span>Native modal qualification: {platform}</span>
        <button className="ui-button" onClick={() => setOpen(true)}>Open standard</button>
        <button className="ui-button" onClick={() => setRetained(true)}>Open retained</button>
        <button className="ui-button" disabled={scheduled} onClick={() => {
          setScheduled(true);
          window.setTimeout(() => { setRetained(true); setScheduled(false); }, 1500);
        }}>Open delayed retained</button>
      </div>
      <div style={{ minHeight: 0, position: "relative" }}><BrowserPane label="modal6200" /></div>
    </main>
    {open && <Modal open title="Native parent dialog" busy={busy} onClose={() => setOpen(false)}>
      <label>Parent draft<input className="ui-input" aria-label="Parent draft" /></label>
      <button className="ui-button" onClick={() => setNested(true)}>Open nested</button>
      <button className="ui-button" onClick={() => setBusy(value => !value)}>{busy ? "Finish pending action" : "Start pending action"}</button>
      <p>{busy ? "Pending action; dismissal must remain blocked." : "Native child must remain hidden while this dialog is open."}</p>
      {nested && <Modal open title="Native nested dialog" onClose={() => setNested(false)}><p>Closing this dialog must keep the native child hidden behind its parent.</p></Modal>}
    </Modal>}
    <Modal keepMounted open={retained} title="Retained native cover" onClose={() => setRetained(false)}>
      <label>Retained draft<input className="ui-input" aria-label="Retained draft" /></label>
      <p>The closed retained layer must not hide the native child.</p>
    </Modal>
  </WorkspaceSurfacePreferencesProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
