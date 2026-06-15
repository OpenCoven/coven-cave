import { EnvironmentInspector } from "./EnvironmentInspector";
import { FamiliarChatTranscript } from "./FamiliarChatTranscript";
import { FollowUpComposer } from "./FollowUpComposer";
import { SourcesList } from "./SourcesList";
import { SubagentsList } from "./SubagentsList";
import {
  mockEnvironment,
  mockSources,
  mockSubagents,
  type EnvironmentInspectorData,
  type SourceData,
  type SubagentData,
} from "./mockInspector";
import { mockTranscript, type TranscriptEntry } from "./mockTranscript";
import styles from "./styles.module.css";

type Props = {
  title?: string;
  showLeftSidebar?: boolean;
  entries?: TranscriptEntry[];
  environment?: EnvironmentInspectorData;
  subagents?: SubagentData[];
  sources?: SourceData[];
};

export function FamiliarChatoutCodexSurface({
  title = "create a Codex-style familiar chatout scaffold",
  showLeftSidebar = false,
  entries = mockTranscript,
  environment = mockEnvironment,
  subagents = mockSubagents,
  sources = mockSources,
}: Props) {
  const shellClass = showLeftSidebar ? styles.shell : `${styles.shell} ${styles.shellNoLeft}`;

  return (
    <div className={styles["cv-codex"]}>
      <div className={shellClass}>
        {showLeftSidebar ? <FauxLeftSidebar /> : null}
        <main className={styles.mainColumn}>
          <header className={styles.topBar}>
            <div className={styles.topTitle}>{title}</div>
            <div className={styles.topActions} aria-hidden>
              <span>▣</span>
              <span>☷</span>
              <span>⋯</span>
            </div>
          </header>
          <FamiliarChatTranscript entries={entries} />
          <FollowUpComposer />
        </main>
        <aside className={styles.inspector}>
          <div className={styles.inspectorPanel}>
            <EnvironmentInspector environment={environment} />
            <SubagentsList subagents={subagents} />
            <SourcesList sources={sources} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function FauxLeftSidebar() {
  return (
    <aside className={styles.leftSidebar} aria-label="Mock chat navigation">
      <div className={styles.sidebarIconRow}>
        <span>▢</span>
        <span>‹</span>
        <span>›</span>
      </div>
      <nav className={styles.sidebarNav}>
        <div className={styles.sidebarRow}>✎ <span>New chat</span></div>
        <div className={styles.sidebarRow}>⌕ <span>Search</span></div>
        <div className={styles.sidebarRow}>◌ <span>Plugins</span></div>
        <div className={styles.sidebarRow}>◷ <span>Automations</span></div>
      </nav>
      <div className={styles.sidebarSection}>opencoven</div>
      <div className={`${styles.sidebarRow} ${styles.sidebarRowActive}`}>
        <span>create a Codex-style famil...</span>
        <span>1w</span>
      </div>
      <div className={styles.sidebarProject}><span>Review PR 75776</span><span>2w</span></div>
      <div className={styles.sidebarProject}><span>macOS Application Pri...</span><span>5d</span></div>
      <div className={styles.sidebarSection}>Projects</div>
      <div className={styles.sidebarProject}><span>coven-code</span><span>⌁</span></div>
      <div className={styles.sidebarProject}><span>open-sesame</span><span>⌁</span></div>
      <div className={styles.sidebarProject}><span>cast-codes</span><span>⌁</span></div>
      <div className={styles.sidebarProject}><span>coven-dashboard</span><span>⌁</span></div>
    </aside>
  );
}
