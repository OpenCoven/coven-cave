/**
 * demo-seed.ts — fixture data for the Open Coven weekly demo.
 *
 * Gated behind the local demo-mode helpers. Zero effect on normal installs.
 */

import type { Familiar } from "@/lib/types";
import type { Escalation } from "@/lib/escalations-types";
import type { Card } from "@/lib/cave-board-types";
import { DEMO_MODE_ENV } from "@/lib/demo-mode";

export const DEMO_MODE = DEMO_MODE_ENV;

// ─── helpers ───────────────────────────────────────────────────────────────

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// ─── familiars ──────────────────────────────────────────────────────────────

export const DEMO_FAMILIARS: Familiar[] = [
  {
    id: "nova",
    display_name: "Nova",
    role: "Orchestrator",
    status: "active",
    active_sessions: 3,
    icon: "ph:sparkle-fill",
    note: "Coordinating weekly call prep",
  },
  {
    id: "cody",
    display_name: "Cody",
    role: "Code Familiar",
    status: "active",
    active_sessions: 1,
    icon: "ph:code-fill",
    note: "Working on Hexes Phase 2A",
  },
  {
    id: "sage",
    display_name: "Sage",
    role: "Research Familiar",
    status: "active",
    active_sessions: 2,
    icon: "ph:book-open-fill",
    note: "On OpenAI fallback model",
  },
  {
    id: "echo",
    display_name: "Echo",
    role: "Interface Familiar",
    status: "idle",
    active_sessions: 0,
    icon: "ph:paint-brush-fill",
    note: "Awaiting design review",
  },
  {
    id: "kitty",
    display_name: "Kitty",
    role: "Systems Familiar",
    status: "idle",
    active_sessions: 0,
    icon: "ph:terminal-window-fill",
    note: "Needs input on memory archive",
  },
  {
    id: "charm",
    display_name: "Charm",
    role: "Creative Familiar",
    status: "idle",
    active_sessions: 0,
    icon: "ph:palette-fill",
    note: "Slide deck ready",
  },
  {
    id: "astra",
    display_name: "Astra",
    role: "Ops Familiar",
    status: "offline",
    active_sessions: 0,
    icon: "ph:gear-six-fill",
    note: "Escalated: gateway auth failure",
  },
];

// ─── Inbox escalations ────────────────────────────────────────────────

export const DEMO_ESCALATIONS: Escalation[] = [
  {
    id: "demo-esc-1",
    createdAt: ago(8),
    updatedAt: ago(8),
    origin: "gateway",
    fromFamiliar: "astra",
    title: "Gateway lost OpenAI auth — Sage on fallback model",
    excerpt:
      "Connection to OpenAI API returned 401. Sage automatically switched to anthropic/claude-opus-4 fallback. Resume when API key is rotated or re-authorised in Settings → Integrations.",
    severity: "critical",
    state: "new",
    decisionRequired: false,
  },
  {
    id: "demo-esc-2",
    createdAt: ago(14),
    updatedAt: ago(14),
    origin: "task",
    fromFamiliar: "cody",
    title: "coven-cave#36 needs merge method decision before I can close",
    excerpt:
      "PR is green and CI passed. Waiting on: (1) squash vs merge commit, (2) patch vs minor bump. I'll merge the moment you decide.",
    severity: "critical",
    state: "new",
    decisionRequired: true,
    severityReason: "Blocks the demo branch from merging before the call",
    actions: [
      {
        id: "open-pr",
        label: "Open PR",
        kind: "link",
        target: "https://github.com/OpenCoven/coven-cave/pulls",
      },
    ],
  },
  {
    id: "demo-esc-3",
    createdAt: ago(31),
    updatedAt: ago(22),
    origin: "cron",
    title: "Thursday async memory update — silent 22 min past expected window",
    excerpt:
      "Scheduled run at 14:00 CDT did not fire. No error in cron logs. Likely a daemon restart edge case. May be safe to dismiss if nothing is missing from today's memory.",
    severity: "warn",
    state: "acknowledged",
    decisionRequired: false,
  },
  {
    id: "demo-esc-4",
    createdAt: ago(47),
    updatedAt: ago(47),
    origin: "mention",
    fromFamiliar: "sage",
    aboutFamiliar: "cody",
    title: "PR #36 AgentPanel missing snapshot test for slide-in animation",
    excerpt:
      "The AgentPanel CSS transition is untested. Not a blocker — animation looks correct in local dev — but worth a fast snapshot before this merges to main.",
    severity: "info",
    state: "new",
    decisionRequired: false,
  },
  {
    id: "demo-esc-5",
    createdAt: ago(72),
    updatedAt: ago(72),
    origin: "chat",
    fromFamiliar: "kitty",
    title: "Should I auto-archive memory/2026-04-* or keep for April retro?",
    excerpt:
      "14 daily memory files from April haven't been referenced in 30 days. Safe to archive to cold storage, or do you want them on hand for the retrospective next week?",
    severity: "info",
    state: "new",
    decisionRequired: true,
  },
];

// ─── board cards ─────────────────────────────────────────────────────────────

export const DEMO_BOARD_CARDS: Card[] = [
  {
    id: "demo-card-1",
    title: "Inbox — humans-only escalation surface (#16)",
    notes: "Full spec implemented. On main.",
    status: "review",
    priority: "high",
    familiarId: "cody",
    sessionId: null,
    cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven",
    links: ["https://github.com/OpenCoven/coven/issues/16"],
    github: [],
    labels: ["shipped"],
    createdAt: ago(180),
    updatedAt: ago(60),
    lifecycle: "completed",
    lifecycleAt: ago(60),
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  },
  {
    id: "demo-card-2",
    title: "Health strip in daemon bar (#15)",
    notes: "Colored dots per surface — daemon, familiars, gateway.",
    status: "review",
    priority: "medium",
    familiarId: "cody",
    sessionId: null,
    cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven",
    links: ["https://github.com/OpenCoven/coven/issues/15"],
    github: [],
    labels: ["shipped"],
    createdAt: ago(240),
    updatedAt: ago(90),
    lifecycle: "completed",
    lifecycleAt: ago(90),
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  },
  {
    id: "demo-card-3",
    title: "coven-relay scaffold — Hexes Phase 2A",
    notes: "PR #152 open. Axum WS skeleton + fly.toml. Typecheck clean.",
    status: "running",
    priority: "high",
    familiarId: "cody",
    sessionId: null,
    cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven",
    links: ["https://github.com/OpenCoven/coven/pull/152"],
    github: [],
    labels: ["hexes"],
    createdAt: ago(120),
    updatedAt: ago(30),
    lifecycle: "review",
    lifecycleAt: ago(30),
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  },
  {
    id: "demo-card-4",
    title: "Hexes Phase 2B — auth + peer routing",
    notes: "Waiting for 2A merge. Bearer auth + host/client fanout.",
    status: "inbox",
    priority: "high",
    familiarId: "cody",
    sessionId: null,
    cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven",
    links: [],
    github: [],
    labels: ["hexes"],
    createdAt: ago(30),
    updatedAt: ago(30),
    lifecycle: "queued",
    lifecycleAt: ago(30),
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  },
  {
    id: "demo-card-5",
    title: "Inbox keyboard shortcuts follow-up (#16.1)",
    notes: "j/k/e/r/s/x/o + g-i global jump. Filed as follow-up to #16.",
    status: "inbox",
    priority: "medium",
    familiarId: null,
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    labels: [],
    createdAt: ago(20),
    updatedAt: ago(20),
    lifecycle: "queued",
    lifecycleAt: ago(20),
    retryCount: 0,
    maxRetries: 2,
    steps: [],
  },
];

// ─── demo chat turns ─────────────────────────────────────────────────────────

export type DemoChatTurn = { role: "user" | "assistant"; content: string };

export const DEMO_CHAT_TURNS: Record<string, DemoChatTurn[]> = {
  cody: [
    {
      role: "user",
      content:
        "Can you check if the escalations API handles concurrent writes safely?",
    },
    {
      role: "assistant",
      content:
        "Checked `src/lib/escalations.ts` — it uses a `globalThis.__escalationsWriteChain` mutex that serialises all read-modify-write sequences. Two concurrent POSTs can't race each other. Same pattern as the reminders inbox. Safe.",
    },
    {
      role: "user",
      content: "Good. What's left on 2A before we can merge the relay PR?",
    },
    {
      role: "assistant",
      content:
        "PR #152 is open and CI is green. Scaffold compiles, workspace tests pass (4/4). `fly.toml` is wired to `relay.opencoven.dev` / `ord`. Nothing blocking — ready to merge when you are. 2B (auth + peer routing) is queued.",
    },
  ],
};
