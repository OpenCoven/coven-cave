"use client";

/**
 * The gated cockpit — every write action a GitHub issue/PR card can fire, in
 * one bottom-anchored composer. Design: `Final Card Components.dc.html` §01
 * (Claude Design handoff, 2026-07-29); protocol: docs/chat-github-integration.md §3.
 *
 * Two invariants hold the whole thing together:
 *
 *  1. THE CARD'S FOOTPRINT NEVER CHANGES. `.ghc-slot` is a constant-height
 *     reply row in every phase; each expanded phase paints into `.ghc-sheet`,
 *     absolutely positioned against the card's bottom edge so it grows UPWARD
 *     over the transcript. Opening a section or the palette therefore cannot
 *     reflow the chat below the card — which is the thing that made the old
 *     flat action row unusable mid-conversation.
 *
 *  2. AT MOST ONE SECTION IS OPEN, by construction rather than by cleanup:
 *     `sec` is a single slot and `toggleSec` either sets it or clears it.
 *
 * Tier discipline from the design of record is preserved and tightened: merge
 * is the one irreversible verb, so its CTA stays inert until the user types
 * "merge" into the arm field. The familiar's draft is never sent — it lands in
 * the textarea for the user to edit, and only their own submit writes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { MarkdownBlock } from "@/components/message-bubble";
import {
  buildCommandTree,
  parseCommand,
  resolveSlash,
  type GhCommandAction,
} from "@/lib/gh-card-commands";
import { clearDraft, readDraft, writeDraft } from "@/lib/gh-card-draft";
import { generateReviewDraft, type GhDraftScopes } from "@/lib/gh-review-draft";
import "@/styles/gh-card-composer.css";

export type GhComposerItem = {
  repo: string;
  number: number;
  title: string;
  body: string;
  isPull: boolean;
  state: string;
  merged: boolean;
  author: string | null;
  assignees: string[];
  labels: { name: string; color: string }[];
  pull: {
    headRef: string | null;
    baseRef: string | null;
    commits: number | null;
    reviews: { approved: number; changesRequested: number } | null;
  } | null;
};

export type GhComposerCheckRun = { name: string; status: string; conclusion: string | null; detailsUrl: string | null };

export type GhComposerChecks = {
  counts: { passed: number; failed: number; pending: number; total: number };
  runs: GhComposerCheckRun[];
} | null;

export type GhComposerThread = {
  id: string;
  path: string | null;
  isResolved: boolean;
  excerpt: string;
  author: string | null;
};

type Phase = "rest" | "open" | "sending" | "error" | "merged";
type Section = "" | "gate" | "merge" | "meta" | "fam";
type Mode = "comment" | "approve" | "request" | "merge";
type Method = "squash" | "merge" | "rebase";

type Reaction = { content: string; count: number; mine: number | null };

/** GitHub's eight reaction contents, in the order its own UI shows them. */
const REACTION_EMOJI: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

const VERB: Record<Mode, string> = {
  comment: "Comment",
  approve: "Approve",
  request: "Request changes",
  merge: "Merge",
};

const METHOD_LABEL: Record<Method, string> = { squash: "squash", merge: "merge commit", rebase: "rebase" };

/** Markdown toolbar: three clusters — emphasis · blocks · refs. */
type Tool = {
  title: string;
  glyph?: string;
  icon?: IconName;
  cls?: string;
  sep?: boolean;
  wrap?: [string, string];
  prefix?: string;
};

const TOOLS: Tool[] = [
  { title: "Bold — **text**", glyph: "B", cls: "ghc-tool--bold", wrap: ["**", "**"] },
  { title: "Italic — _text_", glyph: "I", cls: "ghc-tool--italic", wrap: ["_", "_"] },
  { title: "Inline code — `code`", icon: "ph:code", sep: true, wrap: ["`", "`"] },
  { title: "Bullet list — - item", icon: "ph:list-bullets", prefix: "- " },
  { title: "Quote — > text", glyph: ">", prefix: "> " },
  { title: "Mention — @login", icon: "ph:at", sep: true, wrap: ["@", ""] },
  { title: "Link — [text](url)", icon: "ph:link", wrap: ["[", "](https://)"] },
  { title: "Attach a file reference", icon: "ph:paperclip", wrap: ["![", "](url)"] },
];

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok && data?.ok === true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function GitHubCardComposer({
  item,
  checks,
  threads,
  familiar,
  onMutated,
  onMerged,
  onRefreshChecks,
  onRefreshThreads,
  onOpenUrl,
}: {
  item: GhComposerItem;
  checks: GhComposerChecks;
  threads: GhComposerThread[] | null;
  /** The chat's familiar, for the draft section. Absent → no draft section. */
  familiar?: { id: string; name: string } | null;
  onMutated: () => void;
  onMerged?: () => void;
  onRefreshChecks?: () => void;
  onRefreshThreads?: () => void;
  onOpenUrl?: (url: string) => void;
}) {
  const { announce } = useAnnouncer();
  const { repo, number } = item;

  const [phase, setPhase] = useState<Phase>("rest");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [text, setText] = useState("");
  const [sec, setSec] = useState<Section>("");
  const [mode, setMode] = useState<Mode>("comment");
  const [method, setMethod] = useState<Method>("squash");
  const [delBranch, setDelBranch] = useState(true);
  const [arm, setArm] = useState("");
  const [people, setPeople] = useState<string[]>(item.assignees);
  const [labels, setLabels] = useState<string[]>(item.labels.map((l) => l.name));
  const [pick, setPick] = useState<"" | "people" | "labels">("");
  const [nudge, setNudge] = useState<"" | "arm" | "body">("");
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [merged, setMerged] = useState<{ sha: string | null; branchDeleted: boolean } | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [palette, setPalette] = useState<{ name: string; color: string }[]>([]);
  const [scopes, setScopes] = useState<GhDraftScopes>({ files: true, threads: true, checks: false });
  const [drafting, setDrafting] = useState(false);
  const [famDraft, setFamDraft] = useState<string | null>(null);
  const [famError, setFamError] = useState<string | null>(null);
  /** Measured height cap: the room the sheet actually has above the card. */
  const [room, setRoom] = useState<number | null>(null);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const armRef = useRef<HTMLInputElement | null>(null);
  const draftAbort = useRef<AbortController | null>(null);

  const open = item.state === "open" && !item.merged;
  const mergeable = item.isPull && open;
  const unresolved = (threads ?? []).filter((t) => !t.isResolved);

  // ── draft persistence ─────────────────────────────────────────────────────

  useEffect(() => {
    const saved = readDraft(repo, number);
    if (saved) {
      setText(saved);
      setRestored(true);
    }
  }, [repo, number]);

  const commitText = useCallback(
    (next: string) => {
      setText(next);
      setNudge("");
      setRestored(false);
      writeDraft(repo, number, next);
    },
    [repo, number],
  );

  /** The textarea grows with its content to a 220px cap, then scrolls. */
  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 220)}px`;
  }, []);

  useEffect(() => {
    grow();
  }, [text, tab, phase, grow]);

  /**
   * Make the sheet fit inside the transcript's scroll viewport.
   *
   * `.cave-chat-transcript` is `overflow-y: auto`, so a sheet taller than the
   * gap between the card's bottom and that viewport's top edge gets its HEADER
   * clipped — tabs, toolbar and textarea vanish with no way to scroll to them.
   *
   * The fix keeps the design's single direction. Growing downward instead was
   * the obvious alternative and it is wrong: the sheet then overlaps whatever
   * follows the card, and in a transcript that is the turn's own action row,
   * which swallows the clicks aimed at the composer's footer. So instead we
   * scroll the transcript to MAKE room above (less scrollTop moves the card
   * down the screen), and cap the height for the residue when the transcript is
   * already at its top and there is nowhere left to go.
   *
   * Safe against feedback loops: the sheet is absolutely positioned, so nothing
   * measured here can change the flow that produced the measurement, and the
   * setter bails when the result is materially unchanged.
   */
  useEffect(() => {
    if (phase !== "open") {
      setRoom(null);
      return;
    }
    const sheet = sheetRef.current;
    const card = sheet?.offsetParent as HTMLElement | null;
    if (!sheet || !card) return;
    let scroller: HTMLElement | null = card.parentElement;
    while (scroller && scroller !== document.body) {
      if (/auto|scroll/.test(getComputedStyle(scroller).overflowY)) break;
      scroller = scroller.parentElement;
    }
    // GUTTER keeps the sheet's own border off the viewport edge.
    const GUTTER = 8;
    const roomAbove = () => {
      const top = scroller && scroller !== document.body ? scroller.getBoundingClientRect().top : 0;
      return Math.max(0, card.getBoundingClientRect().bottom - top - GUTTER);
    };
    let above = roomAbove();
    const shortfall = sheet.scrollHeight - above;
    if (shortfall > 0 && scroller && scroller.scrollTop > 0) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - (shortfall + GUTTER));
      above = roomAbove();
    }
    // MIN_ROOM: below this the sheet is unusable either way, so stop shrinking
    // and let it scroll internally rather than collapse to a sliver.
    const next = Math.max(160, Math.round(above));
    setRoom((prev) => (prev != null && Math.abs(prev - next) < 4 ? prev : next));
  }, [phase, sec, tab, text, famDraft, pick]);

  useEffect(
    () => () => {
      draftAbort.current?.abort();
    },
    [],
  );

  // Server truth wins whenever the card re-hydrates, except while the user is
  // mid-edit in a picker — clobbering their pending chips would lose intent.
  useEffect(() => {
    if (pick === "") setPeople(item.assignees);
  }, [item.assignees, pick]);
  useEffect(() => {
    if (pick === "") setLabels(item.labels.map((l) => l.name));
  }, [item.labels, pick]);

  // ── reactions + label palette, fetched once the composer is reachable ─────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/github/reactions?repo=${encodeURIComponent(repo)}&number=${number}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as { ok?: boolean; reactions?: Reaction[] } | null;
        if (!cancelled && res.ok && data?.ok && Array.isArray(data.reactions)) setReactions(data.reactions);
      } catch {
        /* reactions are decoration — a failure leaves the row empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, number]);

  // The label palette is only needed once the user opens the picker.
  useEffect(() => {
    if (pick !== "labels" || palette.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/github/labels?repo=${encodeURIComponent(repo)}`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; labels?: { name: string; color: string }[] }
          | null;
        if (!cancelled && res.ok && data?.ok && Array.isArray(data.labels)) setPalette(data.labels);
      } catch {
        /* fall back to the labels already on the item */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pick, palette.length, repo]);

  // ── command palette ───────────────────────────────────────────────────────

  const tree = useMemo(
    () =>
      buildCommandTree({
        repo,
        number,
        isPull: item.isPull,
        state: item.state,
        merged: item.merged,
        draft: false,
        checks: checks?.counts ?? null,
        unresolvedThreads: unresolved.length,
        threadPath: unresolved[0]?.path ?? null,
        assignable: Array.from(new Set([item.author, ...item.assignees].filter((v): v is string => Boolean(v)))).map(
          (login) => ({ login, role: login === item.author ? "author" : "assigned" }),
        ),
        labelPalette: (palette.length ? palette.map((l) => l.name) : item.labels.map((l) => l.name)).map((name) => ({
          name,
          applied: labels.includes(name),
        })),
        familiars: familiar ? [{ id: familiar.id, name: familiar.name }] : [],
        commitCount: item.pull?.commits ?? null,
      }),
    [repo, number, item, checks, unresolved, palette, labels, familiar],
  );

  const slash = useMemo(() => resolveSlash(text, tree), [text, tree]);
  const mention = !text.startsWith("/") && text.endsWith("@");
  const mentionRoster = useMemo(
    () =>
      Array.from(new Set([item.author, ...item.assignees].filter((v): v is string => Boolean(v)))).map((login) => ({
        login,
        role: login === item.author ? "author" : "assigned",
      })),
    [item.author, item.assignees],
  );

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const toggleSec = (key: Exclude<Section, "">) => setSec((cur) => (cur === key ? "" : key));

  // ── textarea formatting ───────────────────────────────────────────────────

  const wrapSelection = (before: string, after: string) => {
    const el = inputRef.current;
    const s = el ? el.selectionStart : text.length;
    const e = el ? el.selectionEnd : s;
    const selected = text.slice(s, e);
    commitText(text.slice(0, s) + before + selected + after + text.slice(e));
    setTab("write");
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = selected ? s + before.length + selected.length + after.length : s + before.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const prefixLine = (prefix: string) => {
    const el = inputRef.current;
    const s = el ? el.selectionStart : text.length;
    const start = text.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    commitText(text.slice(0, start) + prefix + text.slice(start));
    setTab("write");
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  };

  // ── mutations ─────────────────────────────────────────────────────────────

  const patchIssue = async (patch: { assignees?: string[]; labels?: string[]; state?: "open" | "closed" }) => {
    setBusy("meta");
    try {
      const res = await fetch("/api/github/issue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, number, ...patch }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setFailure({ code: String(res.status), message: data?.error ?? "update failed" });
        setPhase("error");
        return false;
      }
      onMutated();
      return true;
    } catch {
      setFailure({ code: "0", message: "network error" });
      setPhase("error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const togglePerson = (login: string) => {
    const next = people.includes(login) ? people.filter((p) => p !== login) : [...people, login];
    setPeople(next);
    void patchIssue({ assignees: next });
  };

  const toggleLabel = (name: string) => {
    const next = labels.includes(name) ? labels.filter((l) => l !== name) : [...labels, name];
    setLabels(next);
    void patchIssue({ labels: next });
  };

  const rerunChecks = async (failedOnly: boolean) => {
    setBusy("checks");
    const { ok, status, data } = await postJson("/api/github/rerun", { repo, number, failedOnly });
    setBusy(null);
    if (!ok) {
      setFailure({ code: String(status), message: (data?.error as string) ?? "re-run failed" });
      setPhase("error");
      return;
    }
    announce(`Re-running checks on ${repo}#${number}.`);
    onRefreshChecks?.();
  };

  const resolveThread = async (threadId: string) => {
    setBusy(threadId);
    const { ok, status, data } = await postJson("/api/github/resolve-thread", { threadId, resolved: true });
    setBusy(null);
    if (!ok) {
      setFailure({ code: String(status), message: (data?.error as string) ?? "resolve failed" });
      setPhase("error");
      return;
    }
    announce("Review thread resolved.");
    onRefreshThreads?.();
  };

  const rereadReactions = async () => {
    try {
      const r = await fetch(`/api/github/reactions?repo=${encodeURIComponent(repo)}&number=${number}`, {
        cache: "no-store",
      });
      const data = (await r.json().catch(() => null)) as { ok?: boolean; reactions?: Reaction[] } | null;
      if (data?.ok && Array.isArray(data.reactions)) setReactions(data.reactions);
    } catch {
      /* leave the optimistic state; the next mount corrects it */
    }
  };

  const toggleReaction = async (content: string) => {
    const existing = reactions.find((r) => r.content === content);
    const removing = existing?.mine != null;
    // Optimistic: the chip is a toggle and a round-trip would make it feel dead.
    setReactions((prev) =>
      prev.map((r) =>
        r.content === content ? { ...r, count: Math.max(0, r.count + (removing ? -1 : 1)), mine: null } : r,
      ),
    );
    const res = removing
      ? await fetch("/api/github/reactions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, number, reactionId: existing?.mine }),
        }).then(
          (r) => ({ ok: r.ok }),
          () => ({ ok: false }),
        )
      : await postJson("/api/github/reactions", { repo, number, content });
    // Always re-read, success or failure. On success the optimistic row has no
    // reaction id yet, so a second tap could not find one to DELETE and would
    // add again; on failure the optimistic flip was simply wrong.
    await rereadReactions();
    if (!res.ok) announce("That reaction did not stick.");
  };

  const send = async (asComment: boolean) => {
    const body = text.trim();
    if (mode === "merge" && !asComment) {
      if (arm.trim().toLowerCase() !== "merge") {
        setSec("merge");
        setNudge("arm");
        requestAnimationFrame(() => armRef.current?.focus());
        return;
      }
      setPhase("sending");
      const { ok, status, data } = await postJson("/api/github/merge", {
        repo,
        number,
        method,
        // Intentionally no headRef: the route reads the branch back from GitHub
        // rather than trusting a caller to name it. We only say whether to tidy.
        ...(delBranch && item.pull?.headRef ? { deleteBranch: true } : {}),
      });
      if (!ok) {
        setFailure({ code: String(status), message: (data?.error as string) ?? "merge failed" });
        setPhase("error");
        return;
      }
      announce(`Merged ${repo}#${number}.`);
      setMerged({ sha: (data?.sha as string) ?? null, branchDeleted: data?.branchDeleted === true });
      setPhase("merged");
      setSec("");
      setArm("");
      onMerged?.();
      onMutated();
      return;
    }

    const effective: Mode = asComment ? "comment" : mode;
    // GitHub rejects an empty comment and an empty request-changes review;
    // approve is the only verb that can fire with nothing typed.
    if (effective !== "approve" && !body) {
      setNudge("body");
      setTab("write");
      setPhase("open");
      requestAnimationFrame(focusInput);
      return;
    }

    setPhase("sending");
    const result =
      effective === "comment"
        ? await postJson("/api/github/comment", { repo, number, body })
        : await postJson("/api/github/review", {
            repo,
            number,
            event: effective === "approve" ? "APPROVE" : "REQUEST_CHANGES",
            body,
          });

    if (!result.ok) {
      setFailure({ code: String(result.status), message: (result.data?.error as string) ?? "send failed" });
      setPhase("error");
      return;
    }
    announce(`${VERB[effective]} posted on ${repo}#${number}.`);
    clearDraft(repo, number);
    setText("");
    setFailure(null);
    if (asComment) setMode("comment");
    setPhase("open");
    onMutated();
  };

  // ── slash command dispatch ────────────────────────────────────────────────

  const runAction = (action: GhCommandAction | null) => {
    commitText("");
    if (!action) return;
    switch (action.kind) {
      case "review":
        setMode(action.event === "APPROVE" ? "approve" : action.event === "REQUEST_CHANGES" ? "request" : "comment");
        break;
      case "merge":
        setMode("merge");
        setMethod(action.method);
        setSec("merge");
        break;
      case "checks":
        setSec("gate");
        if (action.op === "rerun") void rerunChecks(false);
        else if (action.op === "rerun-failed") void rerunChecks(true);
        else {
          const url = checks?.runs.find((r) => r.detailsUrl)?.detailsUrl;
          if (url) (onOpenUrl ?? ((u: string) => window.open(u, "_blank", "noopener,noreferrer")))(url);
        }
        break;
      case "thread":
        setSec("gate");
        if (unresolved[0]) void resolveThread(unresolved[0].id);
        break;
      case "assign":
        setSec("meta");
        togglePerson(action.login);
        break;
      case "label":
        setSec("meta");
        toggleLabel(action.name);
        break;
      case "draft":
        setSec("fam");
        void draftWithFamiliar();
        break;
      case "state":
        void patchIssue({ state: action.state });
        break;
    }
    requestAnimationFrame(focusInput);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.active && (e.key === "Tab" || e.key === "ArrowRight")) {
      if (slash.ghost && slash.ghost !== text) {
        e.preventDefault();
        commitText(slash.ghost);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Esc cascades outward: drop the slash, then close the section, then rest.
      if (slash.active) {
        commitText(text.replace(/^\/+/, ""));
        return;
      }
      if (sec) {
        setSec("");
        setPick("");
        return;
      }
      setPhase("rest");
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(false);
      return;
    }
    if (e.key === "Enter" && slash.active && slash.rows.length) {
      e.preventDefault();
      const row = slash.rows[0];
      if (row.isGroup) {
        commitText(row.command);
        focusInput();
      } else {
        runAction(parseCommand(row.command, tree));
      }
    }
  };

  // ── familiar draft ────────────────────────────────────────────────────────

  const draftWithFamiliar = useCallback(async () => {
    if (!familiar) return;
    draftAbort.current?.abort();
    const controller = new AbortController();
    draftAbort.current = controller;
    setDrafting(true);
    setFamError(null);
    setFamDraft("");
    try {
      let files: { filename: string; status: string; additions: number; deletions: number; patch: string | null }[] = [];
      if (scopes.files && item.isPull) {
        const res = await fetch(
          `/api/github/diff?repo=${encodeURIComponent(repo)}&number=${number}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await res.json().catch(() => null)) as { ok?: boolean; files?: typeof files } | null;
        if (data?.ok && Array.isArray(data.files)) files = data.files;
      }
      const { text: draftText, error } = await generateReviewDraft({
        familiarId: familiar.id,
        signal: controller.signal,
        onText: (partial) => setFamDraft(partial),
        input: {
          repo,
          number,
          title: item.title,
          body: item.body,
          author: item.author,
          verb: mode === "approve" ? "approve" : mode === "request" ? "request" : "comment",
          scopes,
          files,
          threads: threads ?? [],
          checks: checks?.runs ?? [],
        },
      });
      if (controller.signal.aborted) return;
      if (error) {
        setFamError(error);
        setFamDraft(null);
        return;
      }
      setFamDraft(draftText);
    } catch {
      if (!controller.signal.aborted) {
        setFamError("draft failed");
        setFamDraft(null);
      }
    } finally {
      if (!controller.signal.aborted) setDrafting(false);
    }
  }, [familiar, scopes, item, repo, number, mode, threads, checks]);

  // ── derived labels ────────────────────────────────────────────────────────

  const body = text.trim();
  const armed = arm.trim().toLowerCase() === "merge";
  const isMergeVerb = mode === "merge";
  const ready = mode === "approve" ? true : body.length > 0;
  const gateOk = unresolved.length === 0 && (checks ? checks.counts.failed === 0 && checks.counts.pending === 0 : true);
  const reviews = item.pull?.reviews ?? null;

  const checksLabel = checks
    ? [
        checks.counts.passed > 0 ? `✓ ${checks.counts.passed}` : null,
        checks.counts.failed > 0 ? `✕ ${checks.counts.failed}` : null,
        checks.counts.pending > 0 ? `○ ${checks.counts.pending}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "no checks";
  const reviewLabel = reviews
    ? reviews.changesRequested > 0
      ? `${reviews.changesRequested} requesting changes`
      : reviews.approved > 0
        ? `${reviews.approved} approved`
        : "no reviews"
    : "";
  const threadLabel =
    unresolved.length === 0
      ? "all threads resolved"
      : `${unresolved.length} unresolved thread${unresolved.length === 1 ? "" : "s"}`;

  const baseRef = item.pull?.baseRef ?? "the base branch";
  const commits = item.pull?.commits ?? null;
  const commitSummary =
    method === "squash"
      ? "1 commit onto the base"
      : method === "merge"
        ? commits
          ? `${commits} + a merge commit`
          : "a merge commit"
        : commits
          ? `${commits} commits replayed`
          : "commits replayed";

  const draftStateLabel = restored ? "draft restored" : body.length ? "draft saved" : "no draft";
  const draftStateCls = restored ? " ghc-draftstate--restored" : body.length ? " ghc-draftstate--saved" : "";

  const seg = (on: boolean) => `ghc-seg__item focus-ring${on ? " ghc-seg__item--on" : ""}`;
  const segTight = (on: boolean) => `ghc-seg__item ghc-seg__item--tight focus-ring${on ? " ghc-seg__item--on" : ""}`;

  // ── phases that replace the sheet entirely ────────────────────────────────

  if (phase === "sending") {
    return (
      <div className="ghc-root">
        <div className="ghc-slot" />
        <div className="ghc-sheet ghc-sheet--status ghc-sheet--sending" role="status" aria-live="polite">
          <span aria-hidden className="ghc-status__icon ghc-spin">
            <Icon name="ph:circle-notch-bold" width={12} />
          </span>
          <div className="ghc-status__body">
            <div className="ghc-status__title">Sending {VERB[mode].toLowerCase()}…</div>
            {body ? <div className="ghc-status__excerpt">{body.slice(0, 120)}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "error" && failure) {
    return (
      <div className="ghc-root">
        <div className="ghc-slot" />
        <div className="ghc-sheet ghc-sheet--status ghc-sheet--error" role="alert">
          <span aria-hidden className="ghc-status__icon ghc-sec__warn">
            <Icon name="ph:warning-circle" width={13} />
          </span>
          <span className="ghc-status__msg">
            <span className="ghc-status__code">{failure.code}</span> {failure.message}
          </span>
          {mode !== "comment" ? (
            <button type="button" className="ghc-mini focus-ring" onClick={() => void send(true)}>
              Send as comment instead
            </button>
          ) : null}
          <button
            type="button"
            className="ghc-mini focus-ring"
            onClick={() => {
              setFailure(null);
              setPhase("open");
              requestAnimationFrame(focusInput);
            }}
          >
            Back to draft
          </button>
        </div>
      </div>
    );
  }

  if (phase === "merged" && merged) {
    return (
      <div className="ghc-root">
        <div className="ghc-slot" />
        <div className="ghc-sheet ghc-sheet--status ghc-sheet--merged" role="status" aria-live="polite">
          <span aria-hidden className="ghc-status__icon ghc-sec__ok">
            <Icon name="ph:seal-check" width={16} />
          </span>
          <div className="ghc-status__body">
            <div className="ghc-status__title">
              {method === "squash" ? "Squashed and merged" : method === "rebase" ? "Rebased and merged" : "Merged"} into{" "}
              {baseRef}
            </div>
            <div className="ghc-status__meta">
              {merged.sha ? <span className="ghc-sec__mono">{merged.sha.slice(0, 7)}</span> : null}
              {commits ? <span>{commits === 1 ? "1 commit" : `${commits} commits`}</span> : null}
              {item.pull?.headRef ? (
                <span>
                  {item.pull.headRef} {merged.branchDeleted ? "deleted" : "kept"}
                </span>
              ) : null}
            </div>
          </div>
          {merged.sha ? (
            <button
              type="button"
              className="ghc-mini focus-ring"
              onClick={() => {
                void navigator.clipboard?.writeText(merged.sha ?? "");
                announce("Commit sha copied.");
              }}
            >
              <Icon name="ph:copy" width={11} aria-hidden />
              Copy sha
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── rest ──────────────────────────────────────────────────────────────────

  if (phase === "rest") {
    return (
      <div className="ghc-root">
        <div className="ghc-slot">
          <button
            type="button"
            className="ghc-rest-pill focus-ring"
            onClick={() => {
              setPhase("open");
              requestAnimationFrame(focusInput);
            }}
            aria-label={`Reply to ${repo}#${number}`}
          >
            <span aria-hidden className="ghc-rest-pill__icon">
              <Icon name="ph:arrow-bend-up-left" width={12} />
            </span>
            <span className="ghc-rest-pill__label">
              Reply to #{number}, or <span className="ghc-kbd">/</span> for actions…
            </span>
          </button>
          {reactions
            .filter((r) => r.count > 0)
            .slice(0, 3)
            .map((r) => (
              <button
                key={r.content}
                type="button"
                className={`ghc-reaction focus-ring${r.mine ? " ghc-reaction--mine" : ""}`}
                onClick={() => void toggleReaction(r.content)}
                aria-pressed={Boolean(r.mine)}
                aria-label={`${r.content} reaction, ${r.count}`}
              >
                <span aria-hidden>{REACTION_EMOJI[r.content] ?? r.content}</span>
                {r.count}
              </button>
            ))}
          {mergeable && !gateOk ? (
            <span className="ghc-gatechip">
              <span aria-hidden className="ghc-dot" />
              {unresolved.length > 0 ? threadLabel : checksLabel}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // ── open ──────────────────────────────────────────────────────────────────

  return (
    <div className="ghc-root">
      <div className="ghc-slot" />
      <div
        ref={sheetRef}
        className="ghc-sheet"
        style={room != null ? ({ "--ghc-room": `${room}px` } as React.CSSProperties) : undefined}
      >
        <div className="ghc-head">
          <div className="ghc-seg" role="tablist" aria-label="Composer mode">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "write"}
              className={seg(tab === "write")}
              onClick={() => setTab("write")}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "preview"}
              className={seg(tab === "preview")}
              onClick={() => setTab("preview")}
            >
              Preview
            </button>
          </div>
          <span className="ghc-ctx">
            <span aria-hidden className="ghc-ctx__icon">
              <Icon name={item.isPull ? "ph:git-pull-request" : "ph:circle"} width={11} />
            </span>
            <span className="ghc-ctx__repo">{repo}</span>
            <span className="ghc-ctx__num">#{number}</span>
          </span>
          <span className="ghc-tools" role="toolbar" aria-label="Markdown formatting">
            {TOOLS.map((t) => (
              <span key={t.title} className="ghc-tools__group">
                {t.sep ? <span aria-hidden className="ghc-tools__sep" /> : null}
                <button
                  type="button"
                  className={`ghc-tool focus-ring${t.cls ? ` ${t.cls}` : ""}`}
                  title={t.title}
                  aria-label={t.title}
                  onClick={() => (t.wrap ? wrapSelection(t.wrap[0], t.wrap[1]) : prefixLine(t.prefix ?? ""))}
                >
                  {t.icon ? <Icon name={t.icon} width={12} aria-hidden /> : t.glyph}
                </button>
              </span>
            ))}
          </span>
        </div>

        {tab === "write" ? (
          <>
            <textarea
              ref={inputRef}
              className="ghc-input focus-ring"
              value={text}
              onChange={(e) => commitText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              placeholder={`Reply to #${number}, or / for actions…`}
              aria-label={`Reply to ${repo}#${number}`}
            />
            {slash.active ? (
              <div className="ghc-pal">
                {slash.level === "groups" ? (
                  <div className="ghc-pal__label">COMMANDS</div>
                ) : (
                  <div className="ghc-pal__crumb">
                    <span className="ghc-pal__crumb-cmd">{slash.crumb}</span>
                    <span aria-hidden className="ghc-sec__caret">
                      <Icon name="ph:caret-right" width={9} />
                    </span>
                    <span className="ghc-pal__label">SUBCOMMAND</span>
                  </div>
                )}
                <div className="ghc-pal__rows">
                  {slash.rows.map((row, i) => (
                    <button
                      key={row.command}
                      type="button"
                      className={`ghc-pal__row focus-ring${i === 0 ? " ghc-pal__row--active" : ""}`}
                      onClick={() => {
                        if (row.isGroup) {
                          commitText(row.command);
                          focusInput();
                        } else {
                          runAction(parseCommand(row.command, tree));
                        }
                      }}
                    >
                      <span className="ghc-pal__cmd">{row.label}</span>
                      <span className="ghc-pal__desc">{row.desc}</span>
                      <span className="ghc-pal__hint">{row.hint}</span>
                    </button>
                  ))}
                  {slash.noMatch ? (
                    <div className="ghc-pal__nomatch">
                      no command matches — <span className="ghc-kbd">esc</span> keeps it as prose
                    </div>
                  ) : null}
                </div>
                <div className="ghc-pal__foot">
                  <span>
                    <span className="ghc-pal__foot-key">⇥</span> autofill{" "}
                    <span className="ghc-pal__ghost">{slash.ghost}</span>
                  </span>
                  <span className="ghc-pal__hint">
                    <span className="ghc-pal__foot-key">↵</span> run ·{" "}
                    <span className="ghc-pal__foot-key">esc</span> prose
                  </span>
                </div>
              </div>
            ) : null}
            {mention && mentionRoster.length ? (
              <div className="ghc-pal">
                <div className="ghc-pal__label">MENTION</div>
                <div className="ghc-pal__rows">
                  {mentionRoster.map((p, i) => (
                    <button
                      key={p.login}
                      type="button"
                      className={`ghc-pal__row ghc-pal__row--person focus-ring${i === 0 ? " ghc-pal__row--active" : ""}`}
                      onClick={() => {
                        commitText(`${text}${p.login} `);
                        focusInput();
                      }}
                    >
                      <span aria-hidden className="ghc-avatar">
                        {p.login.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="ghc-pal__name">{p.login}</span>
                      <span className="ghc-pal__role">{p.role}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="ghc-preview">
            {body ? (
              <MarkdownBlock text={text} className="cave-md" />
            ) : (
              <span className="ghc-preview__empty">Nothing to preview yet — write something first.</span>
            )}
          </div>
        )}

        {/* ── Gate ── */}
        {mergeable ? (
          <>
            <button
              type="button"
              className="ghc-sec focus-ring"
              aria-expanded={sec === "gate"}
              aria-label="Gate — checks, reviews and threads"
              onClick={() => toggleSec("gate")}
            >
              <span aria-hidden className={`ghc-sec__caret${sec === "gate" ? " ghc-sec__caret--open" : ""}`}>
                <Icon name="ph:caret-right" width={11} />
              </span>
              <span aria-hidden className={`ghc-sec__icon ${gateOk ? "ghc-sec__ok" : "ghc-sec__warn"}`}>
                <Icon name={gateOk ? "ph:check-circle" : "ph:warning-circle"} width={13} />
              </span>
              <span className="ghc-sec__title">Gate</span>
              <span className="ghc-sec__summary">
                <span className="ghc-sec__mono">{checksLabel}</span>
                {reviewLabel ? <span>{reviewLabel}</span> : null}
                <span className={unresolved.length ? "ghc-sec__warn" : "ghc-sec__ok"}>{threadLabel}</span>
              </span>
            </button>
            {sec === "gate" ? (
              <div className="ghc-body">
                <div className="ghc-gate-row">
                  <span aria-hidden className={`ghc-gate-row__icon ${checks?.counts.failed ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
                    <Icon name={checks?.counts.failed ? "ph:x-circle-fill" : "ph:check-circle"} width={12} />
                  </span>
                  Checks
                  <span className="ghc-gate-row__tail">
                    <span className="ghc-gate-row__note">{checksLabel}</span>
                    {checks && checks.counts.total > 0 ? (
                      <button
                        type="button"
                        className="ghc-mini focus-ring"
                        onClick={() => void rerunChecks(true)}
                        disabled={busy === "checks"}
                      >
                        {busy === "checks" ? "…" : "Re-run"}
                      </button>
                    ) : null}
                  </span>
                </div>
                {reviewLabel ? (
                  <div className="ghc-gate-row">
                    <span aria-hidden className={`ghc-gate-row__icon ${reviews?.changesRequested ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
                      <Icon name={reviews?.changesRequested ? "ph:warning-circle" : "ph:check-circle"} width={12} />
                    </span>
                    Reviews
                    <span className="ghc-gate-row__tail">
                      <span className="ghc-gate-row__note">{reviewLabel}</span>
                    </span>
                  </div>
                ) : null}
                <div className="ghc-gate-row">
                  <span aria-hidden className={`ghc-gate-row__icon ${unresolved.length ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
                    <Icon name={unresolved.length ? "ph:warning-circle" : "ph:check-circle"} width={12} />
                  </span>
                  Threads
                  <span className="ghc-gate-row__tail">
                    <span className="ghc-gate-row__note">
                      {unresolved[0]?.path ? `1 unresolved in ${unresolved[0].path}` : threadLabel}
                    </span>
                    {unresolved[0] ? (
                      <button
                        type="button"
                        className="ghc-mini focus-ring"
                        onClick={() => void resolveThread(unresolved[0].id)}
                        disabled={busy === unresolved[0].id}
                      >
                        {busy === unresolved[0].id ? "…" : "Resolve"}
                      </button>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ── Merge ── */}
        {mergeable ? (
          <>
            <button
              type="button"
              className="ghc-sec focus-ring"
              aria-expanded={sec === "merge"}
              aria-label="Merge — method, commit and branch"
              onClick={() => toggleSec("merge")}
            >
              <span aria-hidden className={`ghc-sec__caret${sec === "merge" ? " ghc-sec__caret--open" : ""}`}>
                <Icon name="ph:caret-right" width={11} />
              </span>
              <span aria-hidden className="ghc-sec__icon">
                <Icon name="ph:git-merge" width={13} />
              </span>
              <span className="ghc-sec__title">Merge</span>
              <span className="ghc-sec__summary">
                <span>
                  {METHOD_LABEL[method]} → {baseRef}
                </span>
                <span>{commitSummary}</span>
                <span>{delBranch ? "delete branch" : "keep branch"}</span>
              </span>
            </button>
            {sec === "merge" ? (
              <div className="ghc-body ghc-body--roomy">
                <div className="ghc-row">
                  <div className="ghc-seg ghc-seg--sunken">
                    {(["squash", "merge", "rebase"] as Method[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={segTight(method === m)}
                        onClick={() => setMethod(m)}
                        aria-pressed={method === m}
                      >
                        {m === "squash" ? "Squash" : m === "merge" ? "Merge commit" : "Rebase"}
                      </button>
                    ))}
                  </div>
                  {item.pull?.headRef ? (
                    <button
                      type="button"
                      className="ghc-switch focus-ring"
                      aria-pressed={delBranch}
                      aria-label={`Delete ${item.pull.headRef} after merging`}
                      onClick={() => setDelBranch((v) => !v)}
                    >
                      <span aria-hidden className={`ghc-switch__track${delBranch ? " ghc-switch__track--on" : ""}`}>
                        <span className="ghc-switch__knob" />
                      </span>
                      delete <span className="ghc-switch__branch">{item.pull.headRef}</span>
                    </button>
                  ) : null}
                </div>
                <div className="ghc-commit">
                  <div className="ghc-commit__head">
                    <span className="ghc-commit__eyebrow">COMMIT</span>
                    <span className="ghc-commit__method">{METHOD_LABEL[method]}</span>
                  </div>
                  <div className="ghc-commit__title">
                    {method === "merge"
                      ? `Merge pull request #${number}${item.pull?.headRef ? ` from ${item.pull.headRef}` : ""}`
                      : `${item.title} (#${number})`}
                  </div>
                </div>
                <div className={`ghc-arm${nudge === "arm" ? " ghc-arm--nudged" : ""}`}>
                  <span className="ghc-arm__label">type</span>
                  <span className="ghc-arm__word">merge</span>
                  <span className="ghc-arm__label">to arm</span>
                  <input
                    ref={armRef}
                    className="ghc-arm__input focus-ring"
                    value={arm}
                    onChange={(e) => {
                      setArm(e.target.value);
                      setNudge("");
                    }}
                    placeholder="…"
                    aria-label="Type merge to arm the merge button"
                  />
                  {armed ? (
                    <span aria-hidden className="ghc-arm__ok">
                      <Icon name="ph:check" width={12} />
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ── Assignees & labels ── */}
        <button
          type="button"
          className="ghc-sec focus-ring"
          aria-expanded={sec === "meta"}
          aria-label="Assignees and labels"
          onClick={() => toggleSec("meta")}
        >
          <span aria-hidden className={`ghc-sec__caret${sec === "meta" ? " ghc-sec__caret--open" : ""}`}>
            <Icon name="ph:caret-right" width={11} />
          </span>
          <span aria-hidden className="ghc-sec__icon">
            <Icon name="ph:tag" width={13} />
          </span>
          <span className="ghc-sec__title">Assignees &amp; labels</span>
          <span className="ghc-sec__summary">
            <span>{people.length ? people.join(", ") : "unassigned"}</span>
            <span>{labels.length ? labels.join(" · ") : "no labels"}</span>
          </span>
        </button>
        {sec === "meta" ? (
          <div className="ghc-body ghc-body--roomy">
            <div className="ghc-field">
              <span className="ghc-field__label">assignees</span>
              <div className="ghc-field__body">
                {people.map((p) => (
                  <span key={p} className="ghc-chip">
                    <span aria-hidden className="ghc-avatar">
                      {p.slice(0, 1).toUpperCase()}
                    </span>
                    {p}
                    <button
                      type="button"
                      className="ghc-chip__x focus-ring"
                      onClick={() => togglePerson(p)}
                      aria-label={`Unassign ${p}`}
                    >
                      <Icon name="ph:x" width={8} aria-hidden />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="ghc-add focus-ring"
                  aria-expanded={pick === "people"}
                  onClick={() => setPick((v) => (v === "people" ? "" : "people"))}
                >
                  <Icon name="ph:plus" width={9} aria-hidden />
                  add
                </button>
                {pick === "people" ? (
                  <div className="ghc-picker">
                    <div className="ghc-pal__label">PEOPLE</div>
                    <div className="ghc-pal__rows">
                      {mentionRoster.map((p) => (
                        <button
                          key={p.login}
                          type="button"
                          className={`ghc-pal__row ghc-pal__row--person focus-ring${people.includes(p.login) ? " ghc-pal__row--active" : ""}`}
                          onClick={() => togglePerson(p.login)}
                        >
                          <span aria-hidden className="ghc-avatar">
                            {p.login.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="ghc-pal__name">{p.login}</span>
                          <span className="ghc-pal__role">{p.role}</span>
                          <span className="ghc-pal__state">{people.includes(p.login) ? "assigned" : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="ghc-field">
              <span className="ghc-field__label">labels</span>
              <div className="ghc-field__body">
                {labels.map((name) => {
                  const hex = (palette.find((p) => p.name === name) ?? item.labels.find((l) => l.name === name))?.color;
                  return (
                    <span key={name} className="ghc-chip ghc-chip--label">
                      <span
                        aria-hidden
                        className="ghc-chip__dot"
                        style={hex ? { background: `#${hex}` } : undefined}
                      />
                      {name}
                      <button
                        type="button"
                        className="ghc-chip__x focus-ring"
                        onClick={() => toggleLabel(name)}
                        aria-label={`Remove label ${name}`}
                      >
                        <Icon name="ph:x" width={8} aria-hidden />
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="ghc-add ghc-add--label focus-ring"
                  aria-expanded={pick === "labels"}
                  onClick={() => setPick((v) => (v === "labels" ? "" : "labels"))}
                >
                  <Icon name="ph:plus" width={9} aria-hidden />
                  add
                </button>
                {pick === "labels" ? (
                  <div className="ghc-picker">
                    <div className="ghc-pal__label">REPO LABELS</div>
                    <div className="ghc-pal__rows">
                      {(palette.length ? palette : item.labels).map((l) => (
                        <button
                          key={l.name}
                          type="button"
                          className={`ghc-pal__row ghc-pal__row--person focus-ring${labels.includes(l.name) ? " ghc-pal__row--active" : ""}`}
                          onClick={() => toggleLabel(l.name)}
                        >
                          <span
                            aria-hidden
                            className="ghc-chip__dot"
                            style={l.color ? { background: `#${l.color}` } : undefined}
                          />
                          <span className="ghc-pal__name">{l.name}</span>
                          <span className="ghc-pal__state">{labels.includes(l.name) ? "applied" : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Draft with <familiar> ── */}
        {familiar ? (
          <>
            <button
              type="button"
              className="ghc-sec focus-ring"
              aria-expanded={sec === "fam"}
              aria-label={`Draft with the ${familiar.name} familiar`}
              onClick={() => toggleSec("fam")}
            >
              <span aria-hidden className={`ghc-sec__caret${sec === "fam" ? " ghc-sec__caret--open" : ""}`}>
                <Icon name="ph:caret-right" width={11} />
              </span>
              <span aria-hidden className="ghc-sec__icon ghc-sec__accent">
                <Icon name="ph:brain" width={13} />
              </span>
              <span className="ghc-sec__title">
                Draft with <span className="ghc-sec__accent">{familiar.name}</span>
              </span>
              <span className="ghc-sec__summary">
                <span className={famDraft ? "ghc-sec__accent" : undefined}>
                  {drafting ? "drafting…" : famDraft ? "draft ready · review before sending" : "reads what you allow"}
                </span>
              </span>
            </button>
            {sec === "fam" ? (
              <div className="ghc-body ghc-body--roomy ghc-body--familiar">
                {famDraft == null ? (
                  <div className="ghc-scopes">
                    <span className="ghc-field__label">scope</span>
                    {(
                      [
                        ["files", item.isPull ? "changed files" : "description"],
                        ["threads", `${unresolved.length} open thread${unresolved.length === 1 ? "" : "s"}`],
                        ["checks", "failing checks"],
                      ] as [keyof GhDraftScopes, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`ghc-scope focus-ring${scopes[key] ? " ghc-scope--on" : ""}`}
                        aria-pressed={scopes[key]}
                        onClick={() => setScopes((s) => ({ ...s, [key]: !s[key] }))}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="ghc-draft-cta focus-ring"
                      onClick={() => void draftWithFamiliar()}
                      disabled={drafting}
                    >
                      <Icon name="ph:sparkle" width={12} aria-hidden />
                      {drafting ? "Drafting…" : "Draft the review"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="ghc-draft-box">{famDraft || "…"}</div>
                    <div className="ghc-draft-foot">
                      <span className="ghc-draft-note">never auto-sent</span>
                      <button
                        type="button"
                        className="ghc-draft-use focus-ring"
                        onClick={() => {
                          commitText(famDraft);
                          setTab("write");
                          setSec("");
                          requestAnimationFrame(focusInput);
                        }}
                        disabled={drafting || !famDraft}
                      >
                        Use as my reply
                      </button>
                      <button
                        type="button"
                        className="ghc-draft-alt focus-ring"
                        onClick={() => void draftWithFamiliar()}
                        disabled={drafting}
                      >
                        <Icon name="ph:arrows-clockwise" width={10} aria-hidden />
                        Re-roll
                      </button>
                      <button
                        type="button"
                        className="ghc-draft-drop focus-ring"
                        aria-label="Discard the draft"
                        onClick={() => {
                          draftAbort.current?.abort();
                          setFamDraft(null);
                          setDrafting(false);
                        }}
                      >
                        <Icon name="ph:x" width={10} aria-hidden />
                      </button>
                    </div>
                  </>
                )}
                {famError ? (
                  <span className="ghc-nudge" role="alert">
                    {famError}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {/* ── footer ── */}
        <div className="ghc-foot">
          <div className="ghc-seg ghc-seg--sunken">
            {(mergeable ? (["comment", "approve", "request", "merge"] as Mode[]) : (["comment"] as Mode[])).map((m) => (
              <button
                key={m}
                type="button"
                className={segTight(mode === m)}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  if (m === "merge") setSec("merge");
                }}
              >
                {VERB[m]}
              </button>
            ))}
          </div>
          <span className={`ghc-draftstate${draftStateCls}`}>
            <span aria-hidden className="ghc-dot" />
            {draftStateLabel}
          </span>
          {nudge ? (
            <span className="ghc-nudge" role="alert">
              {nudge === "arm" ? "type merge in the Merge section to arm this" : "GitHub needs a body for this verb"}
            </span>
          ) : null}
          <button
            type="button"
            className={`ghc-cta focus-ring${isMergeVerb ? " ghc-cta--merge" : ""}${isMergeVerb && armed ? " ghc-cta--armed" : ""}${!isMergeVerb && ready ? " ghc-cta--ready" : ""}`}
            aria-label={`${isMergeVerb ? `${METHOD_LABEL[method]} and merge` : VERB[mode]} on ${repo}#${number}`}
            onClick={() => void send(false)}
          >
            {isMergeVerb ? `${method === "squash" ? "Squash" : method === "rebase" ? "Rebase" : "Merge"} and merge` : VERB[mode]}
            <span aria-hidden className="ghc-cta__hint">
              {isMergeVerb && !armed ? "— type to arm" : "⌘↵"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
