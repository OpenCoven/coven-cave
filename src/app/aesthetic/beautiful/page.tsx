// Beautiful UI gallery — the sibling of /aesthetic's token reference.
//
// /aesthetic answers "what are our tokens?"; this answers "what did we vendor,
// and does it survive our palettes?". Every component below renders through the
// adapter in src/styles/beautiful-ui.css, so switching theme or mode with the
// app's own controls repaints the whole page. That is the check this route
// exists for: upstream ships two modes, Cave ships twelve palettes across two
// modes, and a component that hardcoded a colour shows up here immediately.
//
// The stylesheet is imported HERE rather than from globals.css on purpose — it
// is its own Tailwind entry point, so the vendored set's utilities are paid for
// by this route alone. See the header of that file.
//
// These are upstream's SHOWCASE compositions, so most take no props and render
// their own fixture data (ice cream, in upstream's telling). Read them as
// reference implementations, not drop-in primitives — see docs/beautiful-ui.md.

import type { ReactNode } from "react";

import {
  ApprovalCard,
  ChatComposer,
  CodeBlock,
  ContextCards,
  DiffTable,
  FilterTable,
  FineTuneCard,
  InsightCards,
  LoadingState,
  PromptBar,
  RecommendationCard,
  RecordsTable,
  SearchList,
  SelectionActions,
  SidebarNav,
  StreamingText,
  TaskRows,
  ThinkingState,
  ToolChips,
} from "@/components/ui/beautiful";

import { ClientOnly } from "./client-only";

import "@/styles/beautiful-ui.css";

export const metadata = {
  title: "Beautiful UI — Coven Cave",
};

type Entry = {
  id: string;
  name: string;
  note: string;
  render: () => ReactNode;
};

const ENTRIES: Entry[] = [
  {
    id: "loading-state",
    name: "Loading state",
    note: "Pixel-grid loader with a shimmering label and a live elapsed timer. Three wavefront variants.",
    render: () => (
      <div className="flex flex-col gap-3">
        <LoadingState label="Churning" variant="Drive" />
        <LoadingState label="Reducing" variant="Dots" />
        <LoadingState label="Folding" variant="Orbit" />
      </div>
    ),
  },
  {
    id: "thinking-state",
    name: "Thinking",
    note: "Expandable agent trace. Cave already ships a compact ThinkingIndicator; this is the expandable-trace end of the same idea.",
    render: () => <ThinkingState variant="Steps" />,
  },
  {
    id: "streaming-text",
    name: "Streaming text",
    note: "Words resolve out of blur, with inline citations and follow-up prompts.",
    render: () => <StreamingText />,
  },
  {
    id: "approval-card",
    name: "Approval card",
    note: "A permission/approval prompt with a question queue.",
    render: () => <ApprovalCard />,
  },
  {
    id: "tool-chips",
    name: "Tool chips",
    note: "Tool-call rows with expandable arguments and diffs.",
    render: () => <ToolChips />,
  },
  {
    id: "task-rows",
    name: "Task rows",
    note: "Agent task list with progress rings. Two variants.",
    render: () => <TaskRows variant="Capsules" />,
  },
  {
    id: "chat-composer",
    name: "Chat composer",
    note: "Threaded panel with tabs, replies and a composer.",
    render: () => <ChatComposer />,
  },
  {
    id: "prompt-bar",
    name: "Prompt bar",
    note: "Composer with attachments, @ sources, / commands, a model picker and dictation. The flagship-model flourish is a Cave accent pulse, not upstream's WebGL sweep.",
    render: () => <PromptBar variant="Rounded" />,
  },
  {
    id: "recommendation-card",
    name: "Recommendation card",
    note: "Ranked options with a rationale.",
    render: () => <RecommendationCard />,
  },
  {
    id: "context-cards",
    name: "Context cards",
    note: "Retrieved chunks cascading in, each badged by source.",
    render: () => <ContextCards />,
  },
  {
    id: "diff-table",
    name: "Diff table",
    note: "Field-level before/after with accept and reject.",
    render: () => <DiffTable />,
  },
  {
    id: "records-table",
    name: "Records table",
    note: "Compact CRM grid with tag colours and inline editing.",
    render: () => <RecordsTable />,
  },
  {
    id: "filter-table",
    name: "Filter table",
    note: "Faceted filtering over a dense row set.",
    render: () => <FilterTable />,
  },
  {
    id: "sidebar-nav",
    name: "Sidebar nav",
    note: "Grouped navigation with counts.",
    render: () => <SidebarNav />,
  },
  {
    id: "search",
    name: "Search",
    note: "Command search with live filtering.",
    render: () => <SearchList />,
  },
  {
    id: "insight-cards",
    name: "Insight cards",
    note: "Carousel of mini-visualizations. Charts are drawn by Cave's own visx TrendChart, not upstream's charting dependency.",
    render: () => <InsightCards />,
  },
  {
    id: "code-block",
    name: "Code block",
    note: "Syntax-tinted block with copy.",
    render: () => <CodeBlock />,
  },
  {
    id: "fine-tune-card",
    name: "Fine-tune card",
    note: "Compact interactive inspector over segments.",
    render: () => <FineTuneCard />,
  },
  {
    id: "selection-actions",
    name: "Selection actions",
    note: "Contextual AI bar beneath a text selection. Glyphs are Cave's Phosphor set, not upstream's icon package.",
    render: () => <SelectionActions />,
  },
];

export default function BeautifulUiGallery() {
  return (
    // h-dvh + overflow-y-auto: globals.css keeps the app shell viewport-locked
    // with `overflow: hidden` on html/body, so the window never scrolls and a
    // long reference page must own its own scrolling — same as /aesthetic.
    <main className="mx-auto flex h-dvh max-w-[900px] flex-col gap-8 overflow-y-auto bg-bui-canvas p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--text-xl)] font-semibold text-bui-ink">
          Beautiful UI
        </h1>
        <p className="max-w-[64ch] text-[length:var(--text-base)] text-bui-ink-2">
          {ENTRIES.length} AI-native primitives vendored from{" "}
          <a
            className="text-bui-accent-ink underline underline-offset-2"
            href="https://www.beautifului.dev"
            target="_blank"
            rel="noreferrer"
          >
            beautifului.dev
          </a>{" "}
          (MIT, by Turbo), mapped onto Cave tokens. Switch palette or mode to
          check every one of them at once.
        </p>
        <p className="max-w-[64ch] text-[length:var(--text-sm)] text-bui-ink-3">
          Most render upstream&rsquo;s own fixture data and take no props. Treat
          them as reference implementations: parameterize one before putting it
          on a real surface.
        </p>
      </header>

      {ENTRIES.map((entry) => (
        <section key={entry.id} id={entry.id} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[length:var(--text-md)] font-medium text-bui-ink">
              {entry.name}
            </h2>
            <p className="max-w-[64ch] text-[length:var(--text-sm)] text-bui-ink-3">
              {entry.note}
            </p>
          </div>
          {/* Client-only: these are animation-driven showcases and are not
              server-renderable as upstream ships them. See client-only.tsx. */}
          <div className="min-h-[80px] rounded-bui-card border border-bui-line bg-bui-canvas p-4">
            <ClientOnly>{entry.render()}</ClientOnly>
          </div>
        </section>
      ))}
    </main>
  );
}
