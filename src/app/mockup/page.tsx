"use client";

// mockup: clean-room demonstration of a multica-style desktop aesthetic
// applied to coven-cave surfaces. Token + component primitives live in
// `./mockup.css` (scoped by the `.multica-theme` class on the root) so
// the rest of the app is unaffected.
//
// Three view modes via the top-center switcher:
//   1. autopilot — main sidebar + content with a 6-card template grid
//   2. settings  — three-pane layout (main sidebar + sub-sidebar + content)
//   3. agent     — autopilot view with the "Create Agent" modal open
//
// Phosphor icons come straight from @iconify/react with the `ph`
// collection registered via the existing helper in `lib/icon.tsx`.
// We bypass the typed `ICON_NAMES` whitelist here because the mockup
// uses ~30 icons that aren't part of the production allowlist yet —
// we can promote them once the aesthetic ships.

import { Icon as IconifyIcon, addCollection } from "@iconify/react";
import phCollection from "@iconify-json/ph/icons.json";
import { useEffect, useState } from "react";
import "./mockup.css";

let registered = false;
function ensurePhRegistered() {
  if (registered) return;
  addCollection(phCollection as Parameters<typeof addCollection>[0]);
  registered = true;
}

type IconProps = { name: string; width?: number | string; className?: string; style?: React.CSSProperties };
function Icon({ name, width = "1em", className, style }: IconProps) {
  ensurePhRegistered();
  return <IconifyIcon icon={name} width={width} height={width} className={className} style={style} aria-hidden />;
}

type View = "autopilot" | "settings" | "agent";

const TEMPLATES = [
  { icon: "ph:newspaper", title: "Daily news digest", subtitle: "Search and summarize today's news for the team" },
  { icon: "ph:git-pull-request", title: "PR review reminder", subtitle: "Flag stale pull requests that need review" },
  { icon: "ph:bug", title: "Bug triage", subtitle: "Assess and prioritize new bug reports" },
  { icon: "ph:chart-bar", title: "Weekly progress report", subtitle: "Compile a weekly summary of team progress" },
  { icon: "ph:shield-check", title: "Dependency audit", subtitle: "Scan for security vulnerabilities and outdated packages" },
  { icon: "ph:file-text", title: "Documentation check", subtitle: "Review recent changes for documentation gaps" },
];

const SIDEBAR_NAV = [
  { id: "inbox", label: "Inbox", icon: "ph:tray" },
  { id: "issues", label: "My Issues", icon: "ph:ticket" },
];

const WORKSPACE_NAV: Array<{ id: string; label: string; icon: string; view?: View }> = [
  { id: "issues-ws", label: "Issues", icon: "ph:kanban" },
  { id: "projects", label: "Projects", icon: "ph:folder" },
  { id: "autopilot", label: "Autopilot", icon: "ph:lightning", view: "autopilot" },
  { id: "agents", label: "Agents", icon: "ph:robot" },
  { id: "squads", label: "Squads", icon: "ph:users-three" },
  { id: "usage", label: "Usage", icon: "ph:chart-bar" },
];

const CONFIGURE_NAV: Array<{ id: string; label: string; icon: string; view?: View }> = [
  { id: "runtimes", label: "Runtimes", icon: "ph:desktop-tower" },
  { id: "skills", label: "Skills", icon: "ph:book" },
  { id: "settings", label: "Settings", icon: "ph:gear-six", view: "settings" },
];

const SETTINGS_NAV: Array<{ group: string; items: Array<{ id: string; label: string; icon: string; active?: boolean }> }> = [
  {
    group: "My Account",
    items: [
      { id: "profile", label: "Profile", icon: "ph:user" },
      { id: "preferences", label: "Preferences", icon: "ph:sliders" },
      { id: "notifications", label: "Notifications", icon: "ph:bell" },
      { id: "api-tokens", label: "API Tokens", icon: "ph:key" },
    ],
  },
  {
    group: "OpenMeow",
    items: [
      { id: "general", label: "General", icon: "ph:gear-six" },
      { id: "repositories", label: "Repositories", icon: "ph:git-branch", active: true },
      { id: "github", label: "GitHub", icon: "ph:github-logo" },
      { id: "integrations", label: "Integrations", icon: "ph:plug" },
      { id: "labs", label: "Labs", icon: "ph:flask" },
      { id: "members", label: "Members", icon: "ph:users-three" },
    ],
  },
];

function MainSidebar({ activeView, onView }: { activeView: View; onView: (v: View) => void }) {
  return (
    <aside className="multica-sidebar">
      <button className="multica-sidebar-org">
        <span className="multica-sidebar-org-avatar">C</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>CovenCave</span>
        <Icon name="ph:caret-down" width={12} style={{ marginLeft: "auto", color: "var(--muted-foreground)" }} />
      </button>
      <button className="multica-sidebar-item">
        <span className="multica-sidebar-item-icon"><Icon name="ph:magnifying-glass" width={14} /></span>
        Search…
        <span className="multica-sidebar-item-kbd">⌘K</span>
      </button>
      <button className="multica-sidebar-item">
        <span className="multica-sidebar-item-icon"><Icon name="ph:note-pencil" width={14} /></span>
        New Issue
        <span className="multica-sidebar-item-kbd">C</span>
      </button>

      <div style={{ height: 8 }} />

      {SIDEBAR_NAV.map((item) => (
        <button key={item.id} className="multica-sidebar-item">
          <span className="multica-sidebar-item-icon"><Icon name={item.icon} width={14} /></span>
          {item.label}
        </button>
      ))}

      <div className="multica-sidebar-eyebrow">Workspace</div>
      {WORKSPACE_NAV.map((item) => {
        const isActive = item.view === activeView;
        return (
          <button
            key={item.id}
            className={`multica-sidebar-item${isActive ? " multica-sidebar-item--active" : ""}`}
            onClick={() => item.view && onView(item.view)}
          >
            <span className="multica-sidebar-item-icon"><Icon name={item.icon} width={14} /></span>
            {item.label}
          </button>
        );
      })}

      <div className="multica-sidebar-eyebrow">Configure</div>
      {CONFIGURE_NAV.map((item) => {
        const isActive = item.view === activeView;
        return (
          <button
            key={item.id}
            className={`multica-sidebar-item${isActive ? " multica-sidebar-item--active" : ""}`}
            onClick={() => item.view && onView(item.view)}
          >
            <span className="multica-sidebar-item-icon"><Icon name={item.icon} width={14} /></span>
            {item.label}
          </button>
        );
      })}
    </aside>
  );
}

function ViewSwitcher({ view, onView }: { view: View; onView: (v: View) => void }) {
  const opts: Array<{ id: View; label: string }> = [
    { id: "autopilot", label: "Autopilot" },
    { id: "settings", label: "Settings" },
    { id: "agent", label: "Create Agent" },
  ];
  return (
    <div className="multica-view-switcher">
      {opts.map((o) => (
        <button
          key={o.id}
          className={`multica-view-switcher-btn${view === o.id ? " multica-view-switcher-btn--active" : ""}`}
          onClick={() => onView(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AutopilotView() {
  return (
    <main className="multica-content">
      <div className="multica-content-header">
        <Icon name="ph:lightning" width={14} className="multica-content-header-icon" />
        Autopilot
        <div className="multica-content-action">
          <button className="multica-btn">
            <Icon name="ph:plus" width={12} />
            New autopilot
          </button>
        </div>
      </div>

      <div className="multica-content-empty">
        <div className="multica-content-empty-icon">
          <Icon name="ph:lightning" width={40} />
        </div>
        <div className="multica-content-empty-title">No autopilots yet</div>
        <div className="multica-content-empty-subtitle">
          Schedule recurring tasks for your AI agents. Pick a template or start from scratch.
        </div>
      </div>

      <div className="multica-card-grid">
        {TEMPLATES.map((t) => (
          <button key={t.title} className="multica-card">
            <Icon name={t.icon} width={18} className="multica-card-icon" />
            <div>
              <div className="multica-card-title">{t.title}</div>
              <div className="multica-card-subtitle">{t.subtitle}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="multica-card-grid-footer">
        <button className="multica-btn">
          <Icon name="ph:plus" width={12} />
          Start from scratch
        </button>
      </div>
    </main>
  );
}

function SettingsView() {
  return (
    <>
      <aside className="multica-subsidebar">
        <div className="multica-subsidebar-title">Settings</div>
        {SETTINGS_NAV.map((group) => (
          <div key={group.group}>
            <div className="multica-sidebar-eyebrow" style={{ margin: "12px 12px 6px" }}>{group.group}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`multica-subsidebar-item${item.active ? " multica-subsidebar-item--active" : ""}`}
              >
                <span className="multica-sidebar-item-icon"><Icon name={item.icon} width={14} /></span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="multica-content">
        <div className="multica-content-header">Repositories</div>

        <div className="multica-settings-card">
          <div className="multica-settings-card-header">
            <div>
              <div className="multica-settings-card-description">
                Git repositories associated with this workspace. Agents use these to clone and work on code.
              </div>
            </div>
            <button className="multica-btn multica-btn--ghost" style={{ padding: "6px 10px" }}>
              <Icon name="ph:floppy-disk" width={13} />
              Save
            </button>
          </div>
          <div className="multica-settings-card-empty">No repositories yet.</div>
          <button className="multica-btn">
            <Icon name="ph:plus" width={12} />
            Add repository
          </button>
        </div>
      </main>
    </>
  );
}

function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const [visibility, setVisibility] = useState<"workspace" | "personal">("workspace");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="multica-modal-backdrop" onClick={onClose}>
      <div className="multica-modal" onClick={(e) => e.stopPropagation()}>
        <div className="multica-modal-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div className="multica-modal-title">Create Agent</div>
              <div className="multica-modal-description">Create a new AI agent for your workspace.</div>
            </div>
            <button className="multica-btn multica-btn--ghost" onClick={onClose} aria-label="Close">
              <Icon name="ph:x" width={14} />
            </button>
          </div>
        </div>

        <div className="multica-modal-body">
          <div style={{ display: "flex", gap: 20 }}>
            <button
              style={{
                width: 72,
                height: 72,
                borderRadius: "var(--radius-md)",
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--muted-foreground)",
                cursor: "pointer",
              }}
              aria-label="Upload avatar"
            >
              <Icon name="ph:image-square" width={20} />
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="multica-field">
                <label className="multica-field-label">Name</label>
                <input className="multica-field-input" placeholder="e.g. Deep Research Agent" />
              </div>
              <div className="multica-field">
                <label className="multica-field-label">Description</label>
                <input className="multica-field-input" placeholder="What does this agent do?" />
                <div style={{ alignSelf: "flex-end", fontSize: 11, color: "var(--muted-foreground)" }}>0 / 255</div>
              </div>
            </div>
          </div>

          <div className="multica-field">
            <label className="multica-field-label">Visibility</label>
            <div className="multica-field-visibility">
              <button
                className={`multica-visibility-option${visibility === "workspace" ? " multica-visibility-option--active" : ""}`}
                onClick={() => setVisibility("workspace")}
              >
                <Icon name="ph:globe" width={16} />
                <div>
                  <div className="multica-visibility-title">Workspace</div>
                  <div className="multica-visibility-subtitle">All members can assign</div>
                </div>
              </button>
              <button
                className={`multica-visibility-option${visibility === "personal" ? " multica-visibility-option--active" : ""}`}
                onClick={() => setVisibility("personal")}
              >
                <Icon name="ph:lock-simple" width={16} />
                <div>
                  <div className="multica-visibility-title">Personal</div>
                  <div className="multica-visibility-subtitle">Only you and workspace admins can assign</div>
                </div>
              </button>
            </div>
          </div>

          <div className="multica-field">
            <label className="multica-field-label">Runtime</label>
            <select className="multica-field-select" defaultValue=""><option value="">No runtime available</option></select>
          </div>

          <div className="multica-field">
            <label className="multica-field-label">Model</label>
            <select className="multica-field-select" defaultValue=""><option value="">Select a runtime first</option></select>
          </div>

          <div className="multica-field">
            <label className="multica-field-label" style={{ textTransform: "uppercase", fontSize: 11, letterSpacing: "0.04em" }}>Instructions</label>
            <textarea className="multica-field-textarea" placeholder="Click to write instructions…" />
          </div>

          <div className="multica-field">
            <label className="multica-field-label" style={{ textTransform: "uppercase", fontSize: 11, letterSpacing: "0.04em" }}>Skills</label>
            <button className="multica-btn multica-btn--ghost" style={{ justifyContent: "flex-start", border: "1px solid var(--border)" }}>
              <Icon name="ph:plus" width={12} />
              Add skills from workspace
            </button>
          </div>
        </div>

        <div className="multica-modal-footer">
          <button className="multica-btn multica-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="multica-btn multica-btn--primary">Create</button>
        </div>
      </div>
    </div>
  );
}

function ChatPanel() {
  return (
    <div className="multica-chat-panel">
      <div className="multica-chat-panel-header">
        <Icon name="ph:plus" width={12} />
        New chat
        <Icon name="ph:caret-down" width={10} style={{ marginLeft: 4, color: "var(--muted-foreground)" }} />
      </div>
      <div className="multica-chat-panel-body">
        <div className="multica-chat-panel-body-title">Chat with your agents</div>
        <div style={{ fontSize: 12, marginBottom: 16 }}>
          ✨ They know your workspace — <span style={{ color: "var(--foreground)" }}>issues, projects, skills</span>.
        </div>
        <div style={{ fontSize: 12 }}>Ask for a summary, plan your day, or hand off a quick task.</div>
      </div>
      <div className="multica-chat-panel-input-row">
        <Icon name="ph:robot" width={14} style={{ color: "var(--muted-foreground)" }} />
        <input className="multica-chat-panel-input" placeholder="Tell me what to do…" />
        <button className="multica-btn multica-btn--ghost" style={{ padding: "4px 6px" }} aria-label="Send">
          <Icon name="ph:paper-plane-tilt" width={14} />
        </button>
      </div>
    </div>
  );
}

export default function MockupPage() {
  const [view, setView] = useState<View>("autopilot");
  const showSubsidebar = view === "settings";

  return (
    <div className={`multica-theme multica-layout${showSubsidebar ? "" : " multica-layout--two-pane"}`}>
      <MainSidebar activeView={view} onView={setView} />
      {view === "settings" && <SettingsView />}
      {view === "autopilot" && <AutopilotView />}
      {view === "agent" && (
        <>
          <AutopilotView />
          <CreateAgentModal onClose={() => setView("autopilot")} />
        </>
      )}
      <ViewSwitcher view={view} onView={setView} />
      {view !== "agent" && <ChatPanel />}
    </div>
  );
}
