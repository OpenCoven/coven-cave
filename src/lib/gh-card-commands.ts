/**
 * Slash-command palette for the inline GitHub card composer
 * (design: `Final Card Components.dc.html` §01, docs/chat-github-integration.md §3).
 *
 * Two pure pieces, both unit-tested without a DOM:
 *   - `buildCommandTree(ctx)` — the groups a given card can actually offer.
 *     A capability the card cannot fire is never listed, so the palette can
 *     never propose an action that 404s or 422s.
 *   - `resolveSlash(text, tree)` — what the palette shows for the current
 *     draft: the group level, the subcommand level, the ghost completion Tab
 *     fills in, and the no-match row.
 *
 * `parseCommand` turns a settled command string back into the typed action the
 * composer dispatches, so the palette and the keyboard path share one decoder.
 */

export type GhCommandSub = {
  name: string;
  desc: string;
  /** Overrides the "↵ run" affordance — e.g. "body required", "default". */
  hint?: string;
};

export type GhCommandGroup = { name: string; desc: string; subs: GhCommandSub[] };

export type GhCommandContext = {
  repo: string;
  number: number;
  isPull: boolean;
  /** GitHub's own `state` string — "open" or "closed". */
  state: string;
  merged: boolean;
  draft: boolean;
  checks: { passed: number; failed: number; pending: number; total: number } | null;
  unresolvedThreads: number;
  /** Path of the first unresolved thread, for the /thread resolve blurb. */
  threadPath: string | null;
  assignable: { login: string; role: string }[];
  /** Repo label palette, with whether this item already carries each one. */
  labelPalette: { name: string; applied: boolean }[];
  familiars: { id: string; name: string }[];
  commitCount: number | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The groups this card can actually fire, in palette order. */
export function buildCommandTree(ctx: GhCommandContext): GhCommandGroup[] {
  const groups: GhCommandGroup[] = [];
  const open = ctx.state === "open" && !ctx.merged;
  const mergeable = ctx.isPull && open;

  if (mergeable) {
    groups.push({
      name: "review",
      desc: `submit a review on #${ctx.number}`,
      subs: [
        { name: "approve", desc: "approve with no changes requested" },
        { name: "request-changes", desc: "blocks merge until resolved", hint: "body required" },
        { name: "comment", desc: "review comment, no verdict" },
      ],
    });
    groups.push({
      name: "merge",
      desc: "merge into the base branch",
      subs: [
        {
          name: "--squash",
          desc: ctx.commitCount ? "one commit onto the base" : "one commit onto the base",
          hint: "default",
        },
        {
          name: "--merge",
          desc: ctx.commitCount ? `merge commit, keeps all ${ctx.commitCount}` : "merge commit, keeps every commit",
        },
        { name: "--rebase", desc: "rebase then fast-forward" },
      ],
    });
  }

  if (ctx.isPull && ctx.checks && ctx.checks.total > 0) {
    const failedOrPending = ctx.checks.failed + ctx.checks.pending;
    groups.push({
      name: "checks",
      desc: "CI on this head",
      subs: [
        { name: "rerun", desc: `re-run all ${plural(ctx.checks.total, "check", "checks")}` },
        {
          name: "rerun-failed",
          desc: failedOrPending
            ? `re-run only the ${plural(failedOrPending, "unfinished job", "unfinished jobs")}`
            : "nothing failing to re-run",
        },
        { name: "logs", desc: "open the job log on GitHub" },
      ],
    });
  }

  if (ctx.isPull && ctx.unresolvedThreads > 0) {
    groups.push({
      name: "thread",
      desc: `${plural(ctx.unresolvedThreads, "unresolved thread", "unresolved threads")}`,
      subs: [
        { name: "resolve", desc: ctx.threadPath ? `resolve ${ctx.threadPath}` : "resolve the first open thread" },
      ],
    });
  }

  if (ctx.assignable.length) {
    groups.push({
      name: "assign",
      desc: "assign people or familiars",
      subs: ctx.assignable.map((p) => ({ name: p.login, desc: p.role })),
    });
  }

  if (ctx.labelPalette.length) {
    groups.push({
      name: "label",
      desc: "add or remove labels",
      subs: ctx.labelPalette.map((l) => ({ name: l.name, desc: l.applied ? "applied — removes it" : "add" })),
    });
  }

  if (ctx.familiars.length) {
    groups.push({
      name: "draft",
      desc: "let a familiar write the reply",
      subs: ctx.familiars.map((f) => ({ name: f.name, desc: "reads the diff + open threads" })),
    });
  }

  // Issue lifecycle keeps the capability the flat action row used to carry.
  if (!ctx.isPull) {
    groups.push({
      name: open ? "close" : "reopen",
      desc: open ? `close #${ctx.number}` : `reopen #${ctx.number}`,
      subs: [{ name: "confirm", desc: open ? "closes the issue" : "reopens the issue" }],
    });
  }

  return groups;
}

export type GhSlashRow = {
  label: string;
  desc: string;
  hint: string;
  /** Full command text this row resolves to. */
  command: string;
  /** Group rows only fill the input; subcommand rows fire. */
  isGroup: boolean;
};

export type GhSlashState = {
  active: boolean;
  level: "groups" | "subs";
  /** "/merge" while browsing that group's subcommands, "" at the group level. */
  crumb: string;
  rows: GhSlashRow[];
  /** What Tab / → completes the draft to. Empty when there is nothing to fill. */
  ghost: string;
  noMatch: boolean;
};

const INERT: GhSlashState = {
  active: false,
  level: "groups",
  crumb: "",
  rows: [],
  ghost: "",
  noMatch: false,
};

/**
 * The palette for the current draft. Only ever active while the draft starts
 * with "/" — a body that merely contains a slash stays prose.
 */
export function resolveSlash(text: string, tree: GhCommandGroup[]): GhSlashState {
  if (!text.startsWith("/")) return INERT;
  const parts = text.slice(1).split(/\s+/);
  const head = (parts[0] ?? "").toLowerCase();
  // A trailing space means the user committed to the group and wants its subs.
  const settled = parts.length > 1 || /\s$/.test(text);
  const group = tree.find((g) => g.name.toLowerCase() === head);

  if (group && settled) {
    const q = (parts[1] ?? "").toLowerCase();
    const subs = group.subs.filter((s) => s.name.toLowerCase().startsWith(q));
    return {
      active: true,
      level: "subs",
      crumb: `/${group.name}`,
      rows: subs.map((s, i) => ({
        label: s.name,
        desc: s.desc,
        hint: s.hint ?? (i === 0 ? "↵ run" : ""),
        command: `/${group.name} ${s.name}`,
        isGroup: false,
      })),
      ghost: subs[0] ? `/${group.name} ${subs[0].name}` : "",
      noMatch: subs.length === 0,
    };
  }

  const groups = tree.filter((g) => g.name.toLowerCase().startsWith(head));
  return {
    active: true,
    level: "groups",
    crumb: "",
    rows: groups.map((g) => ({
      label: `/${g.name}`,
      desc: g.desc,
      hint: `${plural(g.subs.length, "subcommand", "subcommands")} →`,
      command: `/${g.name} `,
      isGroup: true,
    })),
    ghost: groups[0] ? `/${groups[0].name} ` : "",
    noMatch: groups.length === 0,
  };
}

export type GhCommandAction =
  | { kind: "review"; event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" }
  | { kind: "merge"; method: "squash" | "merge" | "rebase" }
  | { kind: "checks"; op: "rerun" | "rerun-failed" | "logs" }
  | { kind: "thread"; op: "resolve" }
  | { kind: "assign"; login: string }
  | { kind: "label"; name: string }
  | { kind: "draft"; familiar: string }
  | { kind: "state"; state: "open" | "closed" };

/**
 * Decode a settled "/group sub" string. Returns null for anything the tree
 * does not offer, so an unknown command stays prose instead of firing.
 */
export function parseCommand(command: string, tree: GhCommandGroup[]): GhCommandAction | null {
  const parts = command.trim().replace(/^\//, "").split(/\s+/);
  const head = (parts[0] ?? "").toLowerCase();
  const arg = parts.slice(1).join(" ");
  const group = tree.find((g) => g.name.toLowerCase() === head);
  if (!group) return null;
  const sub = group.subs.find((s) => s.name.toLowerCase() === arg.toLowerCase());
  if (!sub) return null;

  switch (head) {
    case "review":
      return {
        kind: "review",
        event: sub.name === "approve" ? "APPROVE" : sub.name === "request-changes" ? "REQUEST_CHANGES" : "COMMENT",
      };
    case "merge":
      return { kind: "merge", method: sub.name === "--merge" ? "merge" : sub.name === "--rebase" ? "rebase" : "squash" };
    case "checks":
      return { kind: "checks", op: sub.name as "rerun" | "rerun-failed" | "logs" };
    case "thread":
      return { kind: "thread", op: "resolve" };
    case "assign":
      return { kind: "assign", login: sub.name };
    case "label":
      return { kind: "label", name: sub.name };
    case "draft":
      return { kind: "draft", familiar: sub.name };
    case "close":
      return { kind: "state", state: "closed" };
    case "reopen":
      return { kind: "state", state: "open" };
    default:
      return null;
  }
}
