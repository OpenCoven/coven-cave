import { NextResponse } from "next/server";

/**
 * Salem docs API — Ask Molty pattern adapted for CovenCave.
 *
 * v0: static knowledge + keyword routing.
 * v1: will fetch https://docs.coven.ai/llms-full.txt + embed via Upstash Vector
 *     (same pipeline as OpenKnots/openclaw-chat-api).
 */

const DOCS_BASE = "https://docs.coven.ai";

const STATIC_KNOWLEDGE: Array<{ patterns: string[]; reply: string }> = [
  {
    patterns: ["familiar", "agent", "what is a familiar"],
    reply: `A **familiar** is a persistent AI agent with its own identity, memory, skills, and roles in Coven. Each familiar lives in a workspace directory and has a \`SOUL.md\`, \`IDENTITY.md\`, and optional \`MEMORY.md\`.\n\n→ [Familiars docs](${DOCS_BASE}/familiars)`,
  },
  {
    patterns: ["role", "roles", "what is a role"],
    reply: `A **Role** is a composition bundle that tells a familiar *what it's being* for a class of work — identity context, skills, tools, workflows, plugins, and permission declarations. Roles live in \`~/.coven/roles/familiars/<familiar>/<role>/\` and are activated per-familiar in Cave config.\n\n→ [Roles docs](${DOCS_BASE}/roles)`,
  },
  {
    patterns: ["skill", "skills"],
    reply: `A **Skill** is a focused SKILL.md procedure that teaches a familiar *how to do* one specific capability. Skills live in \`~/.coven/skills/\` or per-familiar workspace skill directories.\n\n→ [Skills docs](${DOCS_BASE}/skills)`,
  },
  {
    patterns: ["plugin", "plugins", "marketplace", "mcp"],
    reply: `CovenCave has a first-party **Plugin Marketplace** seeded with integrations like GitHub, Gmail, Google Calendar, Linear, Vercel, Canva, and core MCP servers (Filesystem, Git, Fetch, Memory, Sequential Thinking, Time). Each plugin can bundle MCP server config, Skills, and role-affinity metadata.\n\n→ Settings → Plugins to browse & install.`,
  },
  {
    patterns: ["salem", "who are you", "what are you"],
    reply: `I'm **Salem** 🐱 — your Coven docs familiar. I live in the bottom-right of CovenCave and answer questions about the Coven ecosystem: familiars, roles, skills, plugins, the marketplace, Cave features, and the Coven daemon.\n\nI'm powered by the Coven docs corpus and get smarter over time.`,
  },
  {
    patterns: ["daemon", "coven daemon", "coven.sock"],
    reply: `The **Coven Daemon** is the local substrate that manages familiars, sessions, memory, and tool execution. It communicates over \`~/.coven/coven.sock\` using the \`coven.daemon.v1\` protocol. Cave shows daemon status in the familiar rail header.\n\n→ [Daemon docs](${DOCS_BASE}/daemon)`,
  },
  {
    patterns: ["memory", "memory tab", "constellation"],
    reply: `Each familiar has a **Memory** tab in Cave that shows curated memory files (\`MEMORY.md\` + \`memory/*.md\`). The Memory Constellation view renders a 3D graph of familiar hubs connected to memory entry nodes.\n\n→ [Memory docs](${DOCS_BASE}/memory)`,
  },
  {
    patterns: ["install", "setup", "getting started", "how do i start"],
    reply: `To get started with Coven:\n1. Install the Coven daemon: \`brew install opencoven/tap/coven\`\n2. Open CovenCave and complete the onboarding.\n3. Connect or create your first familiar.\n4. Browse the Plugin Marketplace under Settings → Plugins.\n\n→ [Getting Started](${DOCS_BASE}/getting-started)`,
  },
  {
    patterns: ["cave", "coven cave", "what is cave"],
    reply: `**CovenCave** is the desktop-web UI for the Coven ecosystem — your workspace for familiar chat, memory inspection, task management, sessions, tools, roles, and the plugin marketplace.\n\n→ [CovenCave docs](${DOCS_BASE}/cave)`,
  },
];

function findReply(message: string): string | null {
  const lower = message.toLowerCase();
  for (const entry of STATIC_KNOWLEDGE) {
    if (entry.patterns.some((p) => lower.includes(p))) {
      return entry.reply;
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message?: string };
    const message = (body.message ?? "").trim();

    if (!message) {
      return NextResponse.json({ error: "No message provided." }, { status: 400 });
    }

    const reply = findReply(message);
    if (reply) {
      return NextResponse.json({ reply });
    }

    // Fallback — graceful until v1 vector retrieval lands
    return NextResponse.json({
      reply: `I don't have a confident answer for that yet 🐱 — try the full docs at **${DOCS_BASE}** or ask me about familiars, roles, skills, plugins, the daemon, or how Cave works.`,
    });
  } catch {
    return NextResponse.json({ error: "Salem had a hairball moment 😅" }, { status: 500 });
  }
}
