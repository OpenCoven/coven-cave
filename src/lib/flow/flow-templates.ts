// Flow templates — pre-built FlowDoc graphs that seed the Flow editor.
//
// Each template is a complete FlowDoc (minus id/createdAt/updatedAt, which are
// stamped at instantiation time). They demonstrate real Coven patterns so
// builders have a working starting point rather than a blank canvas.
//
// Adding a new template: add a FlowTemplate entry to FLOW_TEMPLATES; the
// gallery in FlowLibrary picks it up automatically.

import type { FlowDoc } from "./flow-doc.ts";

export type FlowTemplate = {
  /** Short slug — used to seed the flow id. */
  id: string;
  name: string;
  /** One-sentence pitch shown in the gallery card. */
  description: string;
  /** Category badge. */
  category: "research" | "automation" | "review" | "notification" | "data" | "chat";
  /** Phosphor icon name. */
  icon: string;
  /** Warm accent colour for the gallery card. */
  accent: string;
  /** The graph. Ids, timestamps, and schema are stamped at instantiation. */
  graph: Pick<FlowDoc, "nodes" | "edges">;
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  // ── 1. Daily Briefing ─────────────────────────────────────────────────────
  {
    id: "daily-briefing",
    name: "Daily Briefing",
    description: "A research familiar reads your calendar and email each morning and sends a summary to your preferred channel.",
    category: "notification",
    icon: "ph:sun",
    accent: "#d98b3f",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.schedule",
          name: "Every morning",
          position: { x: 80, y: 160 },
          params: { mode: "cron", cron: "0 8 * * *" },
        },
        {
          id: "briefing",
          type: "familiar",
          name: "Research familiar - gather briefing",
          position: { x: 380, y: 160 },
          params: {
            familiar: "",
            prompt:
              "Check today's calendar events and any urgent unread emails. Produce a concise morning briefing: upcoming events with times, action items from email, and one weather note if relevant. Be brief — this is for a morning read.",
          },
        },
        {
          id: "delivery",
          type: "familiar",
          name: "Delivery familiar - send to channel",
          position: { x: 680, y: 160 },
          params: {
            familiar: "",
            prompt:
              "Take this briefing text and send it to Val's preferred channel (Telegram direct). Format it cleanly for mobile reading.",
          },
        },
        {
          id: "out",
          type: "data.output",
          name: "Done",
          position: { x: 960, y: 160 },
          params: { label: "briefing sent" },
        },
      ],
      edges: [
        {
          id: "trigger:main->briefing:in",
          source: "trigger",
          sourceHandle: "main",
          target: "briefing",
          targetHandle: "in",
        },
        {
          id: "briefing:main->delivery:in",
          source: "briefing",
          sourceHandle: "main",
          target: "delivery",
          targetHandle: "in",
        },
        {
          id: "delivery:main->out:in",
          source: "delivery",
          sourceHandle: "main",
          target: "out",
          targetHandle: "in",
        },
      ],
    },
  },

  // ── 2. Deep Research Report ───────────────────────────────────────────────
  {
    id: "deep-research",
    name: "Deep Research Report",
    description: "Given a topic, a research familiar searches, synthesizes, and drops a structured brief into your inbox.",
    category: "research",
    icon: "ph:magnifying-glass",
    accent: "#9a8ecd",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.manual",
          name: "Start research",
          position: { x: 80, y: 180 },
          params: {},
        },
        {
          id: "topic",
          type: "input.text",
          name: "Research topic",
          position: { x: 320, y: 180 },
          params: { label: "Research topic", value: "" },
          requiredParams: ["value"],
        },
        {
          id: "research-plan",
          type: "familiar",
          name: "Research familiar - plan queries",
          position: { x: 600, y: 180 },
          params: {
            familiar: "",
            prompt:
              "You are planning a deep research sweep. Given the topic in the input, produce 4–6 focused web search queries that together would give comprehensive coverage. Return them as a JSON array of strings.",
          },
        },
        {
          id: "research-search",
          type: "familiar",
          name: "Research familiar - search & collect",
          position: { x: 880, y: 180 },
          params: {
            familiar: "",
            prompt:
              "Run each query from the input using web_search. For each result, note the source URL, title, and a 1-2 sentence summary of the relevant content. Return a structured list of all sources found.",
          },
        },
        {
          id: "research-synthesize",
          type: "familiar",
          name: "Research familiar - synthesize",
          position: { x: 1160, y: 180 },
          params: {
            familiar: "",
            prompt:
              "Synthesize the collected sources into a structured research brief. Include: executive summary, key findings (with citations), open questions, and recommended next steps. Be precise — distinguish evidence from speculation.",
          },
        },
        {
          id: "approval",
          type: "human.gate",
          name: "Review before sending",
          position: { x: 1440, y: 180 },
          params: { prompt: "Review the research brief. Approve to send, or reject to discard." },
        },
        {
          id: "delivery",
          type: "familiar",
          name: "Delivery familiar - deliver",
          position: { x: 1720, y: 120 },
          params: {
            familiar: "",
            prompt: "Send this research brief to Val via Telegram. Use clean formatting suitable for mobile.",
          },
        },
        {
          id: "out",
          type: "data.output",
          name: "Done",
          position: { x: 1960, y: 120 },
          params: { label: "brief sent" },
        },
        {
          id: "discarded",
          type: "data.output",
          name: "Discarded",
          position: { x: 1720, y: 280 },
          params: { label: "discarded" },
        },
      ],
      edges: [
        { id: "trigger:main->topic:in", source: "trigger", sourceHandle: "main", target: "topic", targetHandle: "in" },
        { id: "topic:main->research-plan:in", source: "topic", sourceHandle: "main", target: "research-plan", targetHandle: "in" },
        { id: "research-plan:main->research-search:in", source: "research-plan", sourceHandle: "main", target: "research-search", targetHandle: "in" },
        { id: "research-search:main->research-synthesize:in", source: "research-search", sourceHandle: "main", target: "research-synthesize", targetHandle: "in" },
        { id: "research-synthesize:main->approval:in", source: "research-synthesize", sourceHandle: "main", target: "approval", targetHandle: "in" },
        { id: "approval:approved->delivery:in", source: "approval", sourceHandle: "approved", target: "delivery", targetHandle: "in" },
        { id: "approval:rejected->discarded:in", source: "approval", sourceHandle: "rejected", target: "discarded", targetHandle: "in" },
        { id: "delivery:main->out:in", source: "delivery", sourceHandle: "main", target: "out", targetHandle: "in" },
      ],
    },
  },

  // ── 3. PR Review Notifier ─────────────────────────────────────────────────
  {
    id: "pr-review",
    name: "PR Review Notifier",
    description: "Watches for new GitHub pull requests, has a review familiar inspect them, and pings you with a summary.",
    category: "review",
    icon: "ph:git-pull-request",
    accent: "#6b8fbf",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.webhook",
          name: "GitHub webhook",
          position: { x: 80, y: 180 },
          params: { method: "POST", path: "/hook/github-pr" },
          notes: "Point your GitHub repo webhook here (pull_request events).",
        },
        {
          id: "filter",
          type: "logic.if",
          name: "Only opened/reopened",
          position: { x: 360, y: 180 },
          params: { condition: "{{ $json.action }} == 'opened' || {{ $json.action }} == 'reopened'" },
        },
        {
          id: "review",
          type: "familiar",
          name: "Review familiar - review PR",
          position: { x: 640, y: 120 },
          params: {
            familiar: "",
            prompt:
              "A new pull request has been opened. Based on the PR title, description, and diff (from the input), provide a concise code review summary: what the change does, potential issues, and an overall verdict (looks good / needs changes / needs discussion).",
          },
        },
        {
          id: "delivery",
          type: "familiar",
          name: "Delivery familiar - notify",
          position: { x: 920, y: 120 },
          params: {
            familiar: "",
            prompt:
              "Send this PR review summary to Val via Telegram. Include the PR title and link from the input. Keep it scannable.",
          },
        },
        {
          id: "out",
          type: "data.output",
          name: "Done",
          position: { x: 1160, y: 120 },
          params: { label: "notified" },
        },
        {
          id: "skip",
          type: "data.output",
          name: "Skipped",
          position: { x: 640, y: 280 },
          params: { label: "skipped" },
        },
      ],
      edges: [
        { id: "trigger:main->filter:in", source: "trigger", sourceHandle: "main", target: "filter", targetHandle: "in" },
        { id: "filter:true->review:in", source: "filter", sourceHandle: "true", target: "review", targetHandle: "in" },
        { id: "filter:false->skip:in", source: "filter", sourceHandle: "false", target: "skip", targetHandle: "in" },
        { id: "review:main->delivery:in", source: "review", sourceHandle: "main", target: "delivery", targetHandle: "in" },
        { id: "delivery:main->out:in", source: "delivery", sourceHandle: "main", target: "out", targetHandle: "in" },
      ],
    },
  },

  // ── 4. Familiar Chat Router ───────────────────────────────────────────────
  {
    id: "chat-router",
    name: "Familiar Chat Router",
    description: "Classifies incoming chat messages and routes them to the right familiar role: research, code, or general.",
    category: "chat",
    icon: "ph:chats-circle",
    accent: "#9a8ecd",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.chat",
          name: "Incoming message",
          position: { x: 80, y: 220 },
          params: { familiar: "" },
        },
        {
          id: "classify",
          type: "ai.classify",
          name: "Route intent",
          position: { x: 360, y: 220 },
          params: {
            familiar: "",
            categories: "research\ncode\ngeneral",
          },
        },
        {
          id: "research",
          type: "familiar",
          name: "Research familiar",
          position: { x: 640, y: 80 },
          params: {
            familiar: "",
            prompt: "Handle this research question. Cite your sources.",
          },
        },
        {
          id: "code",
          type: "familiar",
          name: "Code familiar",
          position: { x: 640, y: 220 },
          params: {
            familiar: "",
            prompt: "Handle this coding question or task.",
          },
        },
        {
          id: "general",
          type: "familiar",
          name: "General familiar",
          position: { x: 640, y: 360 },
          params: {
            familiar: "",
            prompt: "Handle this general request helpfully.",
          },
        },
        {
          id: "merge",
          type: "logic.merge",
          name: "Collect reply",
          position: { x: 920, y: 220 },
          params: { mode: "append" },
        },
        {
          id: "out",
          type: "data.output",
          name: "Reply sent",
          position: { x: 1160, y: 220 },
          params: { label: "replied" },
        },
      ],
      edges: [
        { id: "trigger:main->classify:in", source: "trigger", sourceHandle: "main", target: "classify", targetHandle: "in" },
        { id: "classify:a->research:in", source: "classify", sourceHandle: "a", target: "research", targetHandle: "in" },
        { id: "classify:b->code:in", source: "classify", sourceHandle: "b", target: "code", targetHandle: "in" },
        { id: "classify:c->general:in", source: "classify", sourceHandle: "c", target: "general", targetHandle: "in" },
        { id: "research:main->merge:in-0", source: "research", sourceHandle: "main", target: "merge", targetHandle: "in-0" },
        { id: "code:main->merge:in-0", source: "code", sourceHandle: "main", target: "merge", targetHandle: "in-0" },
        { id: "general:main->merge:in-0", source: "general", sourceHandle: "main", target: "merge", targetHandle: "in-0" },
        { id: "merge:main->out:in", source: "merge", sourceHandle: "main", target: "out", targetHandle: "in" },
      ],
    },
  },

  // ── 5. Webhook → Familiar → Slack ─────────────────────────────────────────
  {
    id: "webhook-to-familiar",
    name: "Webhook to Familiar",
    description: "A minimal webhook receiver that passes the payload to a familiar for processing and posts the result externally.",
    category: "automation",
    icon: "ph:link",
    accent: "#6b8fbf",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.webhook",
          name: "Inbound webhook",
          position: { x: 80, y: 180 },
          params: { method: "POST", path: "/hook/process" },
        },
        {
          id: "familiar",
          type: "familiar",
          name: "Process payload",
          position: { x: 380, y: 180 },
          params: {
            familiar: "",
            prompt: "Process the incoming webhook payload and produce a structured summary or action.",
          },
        },
        {
          id: "http",
          type: "http",
          name: "POST result",
          position: { x: 680, y: 180 },
          params: {
            method: "POST",
            url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
            headers: JSON.stringify({ "Content-Type": "application/json" }),
            body: JSON.stringify({ text: "{{ $json.result }}" }),
          },
          notes: "Replace the URL with your Slack (or any HTTP) endpoint.",
        },
        {
          id: "out",
          type: "data.output",
          name: "Done",
          position: { x: 960, y: 180 },
          params: { label: "posted" },
        },
      ],
      edges: [
        { id: "trigger:main->familiar:in", source: "trigger", sourceHandle: "main", target: "familiar", targetHandle: "in" },
        { id: "familiar:main->http:in", source: "familiar", sourceHandle: "main", target: "http", targetHandle: "in" },
        { id: "http:main->out:in", source: "http", sourceHandle: "main", target: "out", targetHandle: "in" },
      ],
    },
  },

  // ── 6. Memory Maintenance ─────────────────────────────────────────────────
  {
    id: "memory-maintenance",
    name: "Memory Maintenance",
    description: "A reflection familiar reviews recent daily notes, distills what matters, and updates long-term memory weekly.",
    category: "automation",
    icon: "ph:brain",
    accent: "#7c9b70",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.schedule",
          name: "Weekly — Sunday night",
          position: { x: 80, y: 180 },
          params: { mode: "cron", cron: "0 22 * * 0" },
        },
        {
          id: "reflection-read",
          type: "familiar",
          name: "Reflection familiar - gather this week",
          position: { x: 360, y: 180 },
          params: {
            familiar: "",
            prompt:
              "Read the last 7 daily note files from the memory/ directory. List the significant events, decisions, lessons learned, and recurring themes across all familiars this week.",
          },
        },
        {
          id: "reflection-distill",
          type: "familiar",
          name: "Reflection familiar - distill to MEMORY.md",
          position: { x: 660, y: 180 },
          params: {
            familiar: "",
            prompt:
              "Given this week's summary from the previous step, update MEMORY.md with distilled long-term memories. Remove outdated entries. Add new learnings. Keep MEMORY.md concise — it's curated wisdom, not a log.",
          },
        },
        {
          id: "approval",
          type: "human.gate",
          name: "Review memory changes",
          position: { x: 940, y: 180 },
          params: { prompt: "The reflection familiar has proposed memory updates. Review the diff and approve to apply." },
        },
        {
          id: "reflection-commit",
          type: "familiar",
          name: "Reflection familiar - commit changes",
          position: { x: 1220, y: 120 },
          params: {
            familiar: "",
            prompt: "Commit the MEMORY.md changes with a descriptive message: 'memory: weekly distillation YYYY-MM-DD'.",
          },
        },
        {
          id: "out",
          type: "data.output",
          name: "Done",
          position: { x: 1460, y: 120 },
          params: { label: "memory updated" },
        },
        {
          id: "skipped",
          type: "data.output",
          name: "Skipped",
          position: { x: 1220, y: 280 },
          params: { label: "skipped" },
        },
      ],
      edges: [
        { id: "trigger:main->reflection-read:in", source: "trigger", sourceHandle: "main", target: "reflection-read", targetHandle: "in" },
        { id: "reflection-read:main->reflection-distill:in", source: "reflection-read", sourceHandle: "main", target: "reflection-distill", targetHandle: "in" },
        { id: "reflection-distill:main->approval:in", source: "reflection-distill", sourceHandle: "main", target: "approval", targetHandle: "in" },
        { id: "approval:approved->reflection-commit:in", source: "approval", sourceHandle: "approved", target: "reflection-commit", targetHandle: "in" },
        { id: "approval:rejected->skipped:in", source: "approval", sourceHandle: "rejected", target: "skipped", targetHandle: "in" },
        { id: "reflection-commit:main->out:in", source: "reflection-commit", sourceHandle: "main", target: "out", targetHandle: "in" },
      ],
    },
  },
];

/** Materialise a template as a saveable FlowDoc stub (no id/timestamps yet). */
export function instantiateTemplate(
  template: FlowTemplate,
  id: string,
  now: string,
): FlowDoc {
  return {
    id,
    name: template.name,
    active: false,
    nodes: template.graph.nodes,
    edges: template.graph.edges,
    createdAt: now,
    updatedAt: now,
    schema: 1,
  };
}
