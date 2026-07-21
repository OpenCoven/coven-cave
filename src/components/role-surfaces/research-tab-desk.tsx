"use client";

/**
 * Desk tab — the mission workspace (cave-dl74 B2): query/command bar, runs
 * rail, mission detail (center column + evidence rail), and the load-error
 * banner.
 *
 * Command-bar contract: only commands with REAL destinations exist.
 *   /brief /sweep /paper — Prompt tab with that mode preselected
 *   /deep               — Prompt tab with the deep loop ("autoresearch")
 *   /save               — Resources tab
 *   /find <query>       — live-filters the runs rail by the remainder
 *   /chat               — opens the selected mission's latest session
 *                         (offered only when that session actually exists)
 * There is no /task — no board-create destination is reachable from here.
 *
 * Plain text is kept as a live runs filter (the Prompt tab contract carries a
 * mode, not a draft, so navigating cannot take the text along). A hint row
 * offers "Open in Prompt" explicitly and says the question is not carried
 * over — user text is never dropped silently.
 */

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { ResearchMissionDetail } from "./research-mission-detail";
import { ResearchMissionList } from "./research-mission-list";
import type { ResearchTabProps } from "./researcher-surface";

type DeskCommand = {
  cmd: string;
  label: string;
  hint: string;
  run(): void;
  /** /find keeps the bar text (the query is the filter); others clear it. */
  keepsQuery?: boolean;
};

export function ResearchTabDesk({ research, context, onNavigate }: ResearchTabProps) {
  const [query, setQuery] = useState("");

  const selectedSessionId = research.selected?.iterations.at(-1)?.sessionId;
  const openMissionSession = (sessionId: string) => {
    context.openSession(sessionId, context.activeFamiliar.id);
  };

  // Rebuilt per render (cheap, tiny list) so every closure sees live context.
  const commands: DeskCommand[] = [
    { cmd: "/brief", label: "Quick brief", hint: "Prompt · brief mode", run: () => onNavigate("prompt", { mode: "brief" }) },
    { cmd: "/sweep", label: "Landscape sweep", hint: "Prompt · sweep mode", run: () => onNavigate("prompt", { mode: "sweep" }) },
    { cmd: "/paper", label: "Deep paper", hint: "Prompt · paper mode", run: () => onNavigate("prompt", { mode: "paper" }) },
    { cmd: "/deep", label: "Deep research loop", hint: "Prompt · deep loop", run: () => onNavigate("prompt", { mode: "autoresearch" }) },
    { cmd: "/save", label: "Saved resources", hint: "Resources tab", run: () => onNavigate("resources") },
    {
      cmd: "/find",
      label: "Filter runs",
      hint: "/find <query>",
      keepsQuery: true,
      run: () => setQuery("/find "),
    },
    // /chat only exists while it has a real destination: the selected
    // mission's latest iteration session.
    ...(selectedSessionId ? [{
      cmd: "/chat",
      label: "Discuss selected run in chat",
      hint: research.selected?.title ?? "",
      run: () => openMissionSession(selectedSessionId),
    }] : []),
  ];

  // "/find rest-of-text" and plain text both live-filter the runs rail.
  const isCommandText = query.startsWith("/");
  const findMatch = /^\/find\s+(.*)$/i.exec(query);
  const listFilter = findMatch ? findMatch[1] : isCommandText ? "" : query;
  const commandsOpen = isCommandText && !findMatch;
  const commandToken = commandsOpen ? query.slice(1).split(/\s+/)[0].toLowerCase() : "";
  const visibleCommands = commandsOpen
    ? commands.filter((command) => command.cmd.slice(1).startsWith(commandToken))
    : [];

  const runCommand = (command: DeskCommand) => {
    command.run();
    if (!command.keepsQuery) setQuery("");
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (event.key === "Enter" && commandsOpen && visibleCommands.length > 0) {
      event.preventDefault();
      runCommand(visibleCommands[0]);
    }
  };

  return (
    <div className="research-desk-tab">
      <div className="research-desk-querybar">
        <div className="research-desk-querybar__field">
          <Icon name="ph:magnifying-glass" width={13} height={13} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder="Ask a new research question — type / for commands"
            aria-label="Search runs or type a desk command"
            aria-expanded={commandsOpen}
            aria-controls={commandsOpen ? "research-desk-commands" : undefined}
            spellCheck={false}
          />
          <span className="research-desk-querybar__affordance" aria-hidden>/ commands</span>
        </div>
        {commandsOpen ? (
          <div
            id="research-desk-commands"
            className="research-desk-querybar__popover"
            role="menu"
            aria-label="Desk commands"
          >
            {visibleCommands.length === 0 ? (
              <p className="research-desk-querybar__none">No matching command</p>
            ) : (
              visibleCommands.map((command) => (
                <button
                  key={command.cmd}
                  type="button"
                  role="menuitem"
                  className="research-desk-querybar__command"
                  onClick={() => runCommand(command)}
                >
                  <code>{command.cmd}</code>
                  <span>{command.label}</span>
                  <em>{command.hint}</em>
                </button>
              ))
            )}
          </div>
        ) : null}
        {listFilter.trim() && !isCommandText ? (
          <p className="research-desk-querybar__filter-hint" role="status">
            Filtering runs by “{listFilter.trim()}”.
            <Button size="xs" variant="ghost" onClick={() => onNavigate("prompt")}>
              Open in Prompt ↗
            </Button>
            <span>Your question isn’t carried over — the Prompt tab opens fresh.</span>
          </p>
        ) : null}
      </div>

      <div className="research-desk__workspace">
        <ResearchMissionList
          missions={research.missions}
          selectedId={research.selectedId}
          loading={research.loading}
          onSelect={research.select}
          filter={listFilter}
        />
        <main className="research-desk__main">
          {research.error ? (
            <div className="research-desk__error" role="alert">
              <span>{research.error}</span>
              <Button size="xs" variant="ghost" onClick={() => void research.load()}>
                Try again
              </Button>
            </div>
          ) : null}
          <ResearchMissionDetail
            mission={research.selected}
            onOpenSession={(sessionId) => {
              context.openSession(sessionId, context.activeFamiliar.id);
            }}
            onOpenUrl={context.openUrl}
            onShowResources={() => onNavigate("resources")}
            onAction={(input) => research.selected
              ? research.act(research.selected.id, input)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onSchedule={(rrule) => research.selected
              ? research.schedule(research.selected.id, rrule)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
            onAutomationAction={(automationId, action) => research.selected
              ? research.controlAutomation(research.selected.id, automationId, action)
              : Promise.resolve({ ok: false, error: "No research mission selected" })}
          />
        </main>
      </div>
    </div>
  );
}
