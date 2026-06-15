export type TranscriptEditFile = {
  path: string;
  additions: number;
  deletions: number;
};

export type SingleEditCard = {
  kind: "single";
  path: string;
  fileType: string;
  additions: number;
  deletions: number;
  status?: string;
};

export type AggregateEditCard = {
  kind: "aggregate";
  label: string;
  fileCount: number;
  additions: number;
  deletions: number;
  files: TranscriptEditFile[];
  initiallyVisible?: number;
  status?: string;
};

export type TranscriptCardData = SingleEditCard | AggregateEditCard;

export type TranscriptEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; tone?: "normal" | "muted" }
  | { id: string; kind: "pill"; text: string }
  | { id: string; kind: "card"; card: TranscriptCardData }
  | { id: string; kind: "runtime"; label: string }
  | { id: string; kind: "retry" };

export const mockTranscript: TranscriptEntry[] = [
  {
    id: "user-1",
    kind: "user",
    text: "Build the first pass of the Codex-style familiar chatout. Keep it behind a flag, add a mockup route, and make the scaffold feel close to the reference before we wire real data.",
  },
  {
    id: "assistant-1",
    kind: "assistant",
    text: "I’ll keep this to visual scaffolding: stub data, isolated components, a preview route, and a default-off flag so the existing familiar chat stays unchanged unless explicitly enabled.",
  },
  {
    id: "assistant-2",
    kind: "assistant",
    tone: "muted",
    text: "Read the spec, opened the Codex reference, and checked Cave’s mockup convention. The layout wants a quiet three-column shell with a status-log transcript rather than bubble chat.",
  },
  {
    id: "assistant-3",
    kind: "assistant",
    text: "I found the existing familiar avatar component and will reuse it in the Subagents section so uploaded familiar images still win over glyph fallback.",
  },
  {
    id: "card-1",
    kind: "card",
    card: {
      kind: "single",
      path: "src/components/chat-router.tsx",
      fileType: "TypeScript React",
      additions: 18,
      deletions: 4,
      status: "Flag swap point",
    },
  },
  {
    id: "assistant-4",
    kind: "assistant",
    text: "Next I shaped the transcript primitives: user prompt, prose rows, centered directive pills, file cards, retry controls, and the run-time chip.",
  },
  {
    id: "card-2",
    kind: "card",
    card: {
      kind: "single",
      path: "src/components/familiar-chatout-codex/FamiliarChatTranscript.tsx",
      fileType: "TypeScript React",
      additions: 54,
      deletions: 0,
      status: "New component",
    },
  },
  {
    id: "assistant-5",
    kind: "assistant",
    tone: "muted",
    text: "The right inspector is stub-only for Phase 1: environment rows, familiar subagents, and an empty sources state. No live git, source, or agent wiring yet.",
  },
  {
    id: "assistant-6",
    kind: "assistant",
    text: "I added a preview route at `/mockup/familiar-chatout-codex` so Val can review the new surface without flipping the global flag.",
  },
  {
    id: "pill-1",
    kind: "pill",
    text: "commit and publish after we confirm this is the optimal and safe solution",
  },
  {
    id: "runtime-1",
    kind: "runtime",
    label: "Worked for 12m 04s",
  },
  {
    id: "assistant-7",
    kind: "assistant",
    text: "The package is ready for review. The feature flag remains off by default, and the mock route always renders the new scaffold for design review.",
  },
  {
    id: "card-3",
    kind: "card",
    card: {
      kind: "aggregate",
      label: "Edited 9 files",
      fileCount: 9,
      additions: 121,
      deletions: 107,
      initiallyVisible: 3,
      status: "Reviewed",
      files: [
        { path: "src/components/familiar-chatout-codex/mockTranscript.ts", additions: 83, deletions: 0 },
        { path: "src/components/familiar-chatout-codex/styles.module.css", additions: 186, deletions: 12 },
        { path: "src/app/mockup/familiar-chatout-codex/page.tsx", additions: 91, deletions: 0 },
        { path: "src/components/familiar-chatout-codex/TranscriptCard.tsx", additions: 88, deletions: 6 },
        { path: "src/components/familiar-chatout-codex/EnvironmentInspector.tsx", additions: 42, deletions: 0 },
        { path: "src/components/familiar-chatout-codex/SubagentsList.tsx", additions: 47, deletions: 3 },
        { path: "src/components/familiar-chatout-codex/FollowUpComposer.tsx", additions: 45, deletions: 4 },
        { path: "src/lib/feature-flags.ts", additions: 12, deletions: 0 },
        { path: "src/components/chat-router.tsx", additions: 8, deletions: 82 },
      ],
    },
  },
  {
    id: "retry-1",
    kind: "retry",
  },
];
