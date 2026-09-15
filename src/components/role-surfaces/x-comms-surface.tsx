"use client";

/**
 * X Comms — the account's own room.
 *
 * Demo planning and live publishing share this room. Demo approvals only
 * update local fixtures; Live publishing opens the existing confirmed,
 * non-retrying `/api/x/publish` workflow with its durable history.
 *
 * Shape: a work queue grouped by what each draft needs, a composer, and a
 * dispatch rail whose first card is Approval — the only card with a decision
 * in it. An agenda drawer runs along the bottom. Under 860px the rail collapses
 * to a tab strip and opens as an overlay, which is the room chrome's own
 * responsive behaviour rather than a second implementation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon, type IconName } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import {
  altFromPrompt,
  approvalBlocker,
  countdownLabel,
  derivedTitle,
  formatCount,
  isEditable,
  nextSlot,
  queuedApiCost,
  relativeLabel,
  slotLabel,
  titleOf,
  X_API_BUDGET,
  X_API_WARN_AT,
  X_MAX_IMAGES_PER_POST,
  X_MEDIA_PRESETS,
  X_POST_TYPES,
  X_STATUS,
  type XConnectionState,
  type XArticleDraft,
  type XDraft,
  type XGroupLabel,
  type XMediaKind,
  type XPollDuration,
  type XPostBody,
  type XPostDraft,
  type XPostType,
  type XReplyPermission,
  type XTone,
} from "@/lib/x-comms-model";
import { SurfaceCanvas, SurfaceRoom } from "./surface-room";
import { XPublishPanel } from "./x-publish-panel";
import { ApprovalCard, type XConfirmKind } from "./x-comms/approval-card";
import { Composer } from "./x-comms/composer";
import {
  AnalyticsCard,
  ControlCard,
  TrendsCard,
} from "./x-comms/dispatch-cards";
import { seedDrafts, X_ACCOUNT, X_DEMO_NOTICE } from "./x-comms/fixtures";
import { Preview } from "./x-comms/preview";
import {
  QueueRail,
  X_QUEUE_MAX_WIDTH,
  X_QUEUE_MIN_WIDTH,
} from "./x-comms/queue-rail";
import { Segmented } from "./x-comms/segmented";
import { SlotPicker } from "./x-comms/slot-picker";
import type { XComposerActions, XGenerateState } from "./x-comms/types";

import "@/styles/globals/surface-x-comms.css";

const UNDO_SECONDS = 8;

/**
 * The account-state switch is a dev affordance, not a feature.
 *
 * `x-disconnected` and `rate-limited` are account-level, so with no connection
 * to read they are otherwise unreachable — the switch exists so both stay
 * inspectable rather than becoming dead code. In a production build that trade
 * inverts: it would let someone flip their own room into a red "X disconnected"
 * banner that says nothing true about their account. So it ships to dev and
 * stops there, and production pins the room to `connected`.
 */
const SHOW_ACCOUNT_STATE_SWITCH = process.env.NODE_ENV !== "production";

type DispatchTab = "approval" | "control" | "trends" | "analytics";

const DISPATCH_TABS: ReadonlyArray<{
  id: DispatchTab;
  icon: IconName;
  label: string;
  title: string;
}> = [
  { id: "approval", icon: "ph:check", label: "Approval", title: "Approve, decline, schedule" },
  { id: "control", icon: "ph:lock-simple", label: "Control", title: "Human in control — the gate" },
  { id: "trends", icon: "ph:trend-up", label: "Trends", title: "Trends & timing · reference only" },
  { id: "analytics", icon: "ph:chats-circle", label: "Analytics", title: "Last post and 7-day impressions" },
];

type Toast = { message: string; secondsLeft: number; undo: (() => void) | null };

const uid = () => Math.random().toString(36).slice(2, 10);

const emptyPost = (): XPostBody => ({ text: "", media: [], poll: null });

/** Why these two posts cannot be merged without losing something, or "". */
function mergeRefusal(post: XPostBody, following: XPostBody): string {
  if (post.poll && following.poll) return "can't merge · both posts carry a poll";
  if ((post.poll && following.media.length) || (following.poll && post.media.length)) {
    return "can't merge · a post can't carry both a poll and media";
  }
  const media = [...post.media, ...following.media];
  if (media.filter((item) => item.kind !== "image").length > 1) {
    return "can't merge · one video or GIF per post";
  }
  if (media.length > 1 && media.some((item) => item.kind !== "image")) {
    return "can't merge · a video or GIF travels alone";
  }
  if (media.filter((item) => item.kind === "image").length > X_MAX_IMAGES_PER_POST) {
    return `can't merge · ${X_MAX_IMAGES_PER_POST} images max`;
  }
  return "";
}

export function XCommsSurface({ context }: { context: RoleSurfaceContext }) {
  const [livePublishing, setLivePublishing] = useState(false);

  const { announce } = useAnnouncer();
  const viewSwitchRef = useRef<HTMLButtonElement>(null);
  const previousView = useRef(livePublishing);
  useEffect(() => {
    if (previousView.current !== livePublishing) viewSwitchRef.current?.focus();
    previousView.current = livePublishing;
  }, [livePublishing]);

  // One clock for the whole room, so a countdown and the slot it counts to can
  // never be computed against two different "now"s in one render.
  const [now, setNow] = useState(() => Date.now());
  const [drafts, setDrafts] = useState<XDraft[]>(() => seedDrafts(Date.now()));
  const [selectedId, setSelectedId] = useState<string | null>("x1");

  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [view, setView] = useState<"compose" | "preview">("compose");
  const [queueWidth, setQueueWidth] = useState(280);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<XGroupLabel, boolean>>>({});
  const [closedCards, setClosedCards] = useState<Partial<Record<DispatchTab, boolean>>>({});
  const [dispatchTab, setDispatchTab] = useState<DispatchTab>("approval");
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Collapsed by default: expanded it duplicated counts the queue already shows.
  const [agendaOpen, setAgendaOpen] = useState(false);

  const [quotaOpen, setQuotaOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [openTrend, setOpenTrend] = useState<number | null>(null);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<XConfirmKind | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [generate, setGenerate] = useState<XGenerateState | null>(null);
  const [caretByPost, setCaretByPost] = useState<Record<number, number>>({});
  const [articleCaret, setArticleCaret] = useState<number | null>(null);
  const [focusedOption, setFocusedOption] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Account-level state. With no dispatcher and no connection to read, these
  // two are otherwise unreachable — and an operator has to be able to recognise
  // both, because they are the states in which approving still works but
  // nothing moves. The demo banner carries the switch, which is the one place
  // in the room already saying that its data is not real.
  const [connection, setConnection] = useState<XConnectionState>("connected");
  const quotaUsed = connection === "rate-limited" ? X_API_BUDGET : 412;

  const primaryRef = useRef<HTMLSpanElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = useMemo(
    () => drafts.find((draft) => draft.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  const pending = drafts.filter(
    (draft) => draft.status === "needs-approval" || draft.status === "failed",
  );
  const approved = drafts.filter((draft) => draft.status === "approved");
  const posted = drafts.filter((draft) => draft.status === "posted");
  const draftCount = drafts.filter(
    (draft) => draft.status === "draft" || draft.status === "revoked",
  ).length;

  const nextSlotAt = useMemo(() => nextSlot(now), [now]);
  const blocker = approvalBlocker(selected);

  // The dispatch rail collapses to a tab strip below 1280px, which is the
  // frame's own break. The room's three columns are not the room chrome's
  // named rails (the queue is drag-resizable and the dispatch rail is a fixed
  // 376px, neither of which the shared template expresses), so the collapse is
  // this room's to implement rather than something it inherits.
  useEffect(() => {
    const measure = () => setRailCollapsed(window.innerWidth < 1280);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // A minute is the finest granularity anything here displays, so a faster
  // tick would re-render the room for no visible change.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const closeOverlays = useCallback(() => {
    setQuotaOpen(false);
    setRevisionsOpen(false);
    setSlotPickerOpen(false);
    setRailOpen(false);
    setConfirm(null);
  }, []);

  const clearToastTimer = useCallback(() => {
    if (toastTimer.current) {
      clearInterval(toastTimer.current);
      toastTimer.current = null;
    }
  }, []);

  /**
   * Announce a change and hold an undo for 8s. The snapshot is the whole draft
   * list: a change that touched several records (approve, restore) must undo as
   * one, and a per-field undo would leave the room half-reverted.
   */
  const commit = useCallback(
    (message: string, undoable = true) => {
      const previousDrafts = drafts;
      const previousSelection = selectedId;
      clearToastTimer();
      announce(message);
      setToast({
        message,
        secondsLeft: UNDO_SECONDS,
        undo: undoable
          ? () => {
              setDrafts(previousDrafts);
              setSelectedId(previousSelection);
              setToast(null);
            }
          : null,
      });
      toastTimer.current = setInterval(() => {
        setToast((current) => {
          if (!current) return null;
          if (current.secondsLeft <= 1) {
            clearToastTimer();
            return null;
          }
          return { ...current, secondsLeft: current.secondsLeft - 1 };
        });
      }, 1000);
    },
    [announce, clearToastTimer, drafts, selectedId],
  );

  useEffect(() => clearToastTimer, [clearToastTimer]);

  const undo = useCallback(() => {
    const current = toast;
    clearToastTimer();
    if (current?.undo) {
      current.undo();
      announce("undone");
    } else {
      setToast(null);
    }
  }, [announce, clearToastTimer, toast]);

  const patchSelected = useCallback(
    (patch: Partial<XPostDraft> | Partial<XArticleDraft>) => {
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === selectedId ? ({ ...draft, ...patch } as XDraft) : draft,
        ),
      );
    },
    [selectedId],
  );

  const patchPost = useCallback(
    (index: number, patch: Partial<XPostBody>) => {
      setDrafts((current) =>
        current.map((draft) => {
          if (draft.id !== selectedId || draft.kind !== "post") return draft;
          return {
            ...draft,
            posts: draft.posts.map((post, i) => (i === index ? { ...post, ...patch } : post)),
          };
        }),
      );
    },
    [selectedId],
  );

  const approve = useCallback(
    (id: string) => {
      const at = nextSlot(Date.now());
      commit(`approved · queued for ${slotLabel(Date.now(), at)}`);
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                status: "approved",
                approvedBy: "you",
                approvedAt: Date.now(),
                scheduledAt: at,
                slotPassed: false,
              }
            : draft,
        ),
      );
    },
    [commit],
  );

  const decline = useCallback(
    (id: string) => {
      commit("declined · back to draft");
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                status: "draft",
                scheduledAt: undefined,
                approvedBy: undefined,
                approvedAt: undefined,
                slotPassed: false,
              }
            : draft,
        ),
      );
    },
    [commit],
  );

  const jumpToNeedsYou = useCallback(() => {
    const target = pending[0];
    if (!target) return;
    setSelectedId(target.id);
    setView("compose");
    setDispatchTab("approval");
    setRailOpen(true);
    requestAnimationFrame(() => {
      primaryRef.current?.querySelector("button")?.focus();
    });
  }, [pending]);

  // Room-level keys. Escape unwinds the topmost thing rather than everything at
  // once, so closing a menu never also closes the dialog behind it.
  useEffect(() => {
    if (livePublishing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (renaming) {
          setRenaming(false);
          return;
        }
        if (generate) {
          setGenerate(null);
          return;
        }
        closeOverlays();
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "Enter" && selected?.status === "needs-approval" && !blocker) {
        event.preventDefault();
        approve(selected.id);
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        jumpToNeedsYou();
      }
      if (mod && event.key.toLowerCase() === "z" && toast?.undo) {
        event.preventDefault();
        undo();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [approve, blocker, closeOverlays, generate, jumpToNeedsYou, livePublishing, renaming, selected, toast, undo]);

  const startResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = queueWidth;
      const onMove = (move: globalThis.PointerEvent) => {
        setQueueWidth(
          Math.max(
            X_QUEUE_MIN_WIDTH,
            Math.min(X_QUEUE_MAX_WIDTH, startWidth + move.clientX - startX),
          ),
        );
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [queueWidth],
  );

  const resizeByKey = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setQueueWidth((width) => Math.max(X_QUEUE_MIN_WIDTH, width - step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setQueueWidth((width) => Math.min(X_QUEUE_MAX_WIDTH, width + step));
    }
  }, []);

  const newDraft = useCallback(
    (kind: "post" | "article") => {
      const id = uid();
      const base = {
        id,
        tone: "neutral" as XTone,
        status: "draft" as const,
        notes: "",
        createdAt: Date.now(),
        revisions: [],
      };
      const draft: XDraft =
        kind === "post"
          ? {
              ...base,
              kind: "post",
              type: "post",
              target: "",
              posts: [emptyPost()],
              replyPermission: "everyone",
            }
          : { ...base, kind: "article", title: "", body: "", inline: [] };
      setDrafts((current) => [draft, ...current]);
      setSelectedId(id);
      setView("compose");
    },
    [],
  );

  const actions: XComposerActions = useMemo(
    () => ({
      setPostText: (index, text) => patchPost(index, { text }),
      setPostCaret: (index, caret) =>
        setCaretByPost((current) => ({ ...current, [index]: caret })),
      movePost: (from, to) => {
        if (!selected || selected.kind !== "post" || from === to) return;
        const next = [...selected.posts];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        patchSelected({ posts: next });
      },
      splitPost: (index) => {
        if (!selected || selected.kind !== "post") return;
        const caret = caretByPost[index];
        if (caret == null) return;
        const post = selected.posts[index];
        const next = [...selected.posts];
        next.splice(
          index,
          1,
          { ...post, text: post.text.slice(0, caret).trimEnd() },
          { text: post.text.slice(caret).trimStart(), media: [], poll: null },
        );
        patchSelected({ posts: next });
      },
      /**
       * Merge down, or refuse and say why.
       *
       * The obvious implementation concatenates and truncates — `slice(0, 4)`
       * on the media, `a.poll ?? b.poll` on the polls — and that silently
       * destroys an attachment or a whole poll the operator wrote. It can also
       * assemble combinations the add buttons refuse one at a time: a poll
       * beside media, or two videos. So the incompatible cases are reported
       * rather than performed, and merge only proceeds where nothing is lost.
       */
      mergePost: (index) => {
        if (!selected || selected.kind !== "post" || index >= selected.posts.length - 1) return;
        const post = selected.posts[index];
        const following = selected.posts[index + 1];

        const refusal = mergeRefusal(post, following);
        if (refusal) {
          commit(refusal, false);
          return;
        }

        const next = [...selected.posts];
        next.splice(index, 2, {
          text: `${post.text.trimEnd()}\n${following.text.trimStart()}`,
          media: [...post.media, ...following.media],
          poll: post.poll ?? following.poll,
        });
        patchSelected({ posts: next });
      },
      removePost: (index) => {
        if (!selected || selected.kind !== "post") return;
        patchSelected({ posts: selected.posts.filter((_, i) => i !== index) });
      },
      addPost: () => {
        if (!selected || selected.kind !== "post") return;
        patchSelected({ posts: [...selected.posts, emptyPost()] });
      },

      addMedia: (index, kind) => {
        if (!selected || selected.kind !== "post") return;
        patchPost(index, {
          media: [...selected.posts[index].media, { kind, alt: "" }],
        });
      },
      removeMedia: (index, mediaIndex) => {
        if (!selected || selected.kind !== "post") return;
        patchPost(index, {
          media: selected.posts[index].media.filter((_, i) => i !== mediaIndex),
        });
      },
      setAlt: (index, mediaIndex, alt) => {
        if (!selected || selected.kind !== "post") return;
        patchPost(index, {
          media: selected.posts[index].media.map((item, i) =>
            i === mediaIndex ? { ...item, alt, altAuto: false } : item,
          ),
        });
      },
      convertToGif: (index, mediaIndex) => {
        if (!selected || selected.kind !== "post") return;
        patchPost(index, {
          media: selected.posts[index].media.map((item, i) => {
            if (i !== mediaIndex) return item;
            const width = Math.min(item.width ?? 480, 480);
            const height = Math.round(width * ((item.height ?? 270) / (item.width ?? 480)));
            return { ...item, kind: "gif" as XMediaKind, origin: "png-to-gif" as const, frames: 1, width, height };
          }),
        });
      },

      addPoll: (index) => patchPost(index, { poll: { options: ["", ""], duration: "1d" } }),
      removePoll: (index) => patchPost(index, { poll: null }),
      addPollOption: (index) => {
        if (!selected || selected.kind !== "post") return;
        const poll = selected.posts[index].poll;
        if (!poll) return;
        patchPost(index, { poll: { ...poll, options: [...poll.options, ""] } });
      },
      removePollOption: (index, optionIndex) => {
        if (!selected || selected.kind !== "post") return;
        const poll = selected.posts[index].poll;
        if (!poll) return;
        patchPost(index, {
          poll: { ...poll, options: poll.options.filter((_, i) => i !== optionIndex) },
        });
      },
      setPollOption: (index, optionIndex, text) => {
        if (!selected || selected.kind !== "post") return;
        const poll = selected.posts[index].poll;
        if (!poll) return;
        patchPost(index, {
          poll: {
            ...poll,
            options: poll.options.map((option, i) => (i === optionIndex ? text : option)),
          },
        });
      },
      setPollDuration: (index, duration: XPollDuration) => {
        if (!selected || selected.kind !== "post") return;
        const poll = selected.posts[index].poll;
        if (!poll) return;
        patchPost(index, { poll: { ...poll, duration } });
      },
      reorderPollOption: (index, from, to) => {
        if (!selected || selected.kind !== "post") return;
        const poll = selected.posts[index].poll;
        if (!poll || from === to) return;
        const options = [...poll.options];
        const [moved] = options.splice(from, 1);
        options.splice(to, 0, moved);
        patchPost(index, { poll: { ...poll, options } });
      },

      openGenerate: (state) => setGenerate(state),
      closeGenerate: () => setGenerate(null),
      updateGenerate: (patch) =>
        setGenerate((current) => (current ? { ...current, ...patch } : current)),
      runGenerate: () => {
        if (!generate || !generate.prompt.trim() || !selected) return;
        const preset =
          X_MEDIA_PRESETS[generate.kind].find((item) => item.value === generate.preset) ??
          X_MEDIA_PRESETS[generate.kind][0];
        // Alt text proposed from the prompt is marked for review rather than
        // accepted silently: unread generated alt is the failure the rule exists
        // to prevent, and passing the check without reading it defeats it.
        const item = {
          kind: generate.kind,
          alt: altFromPrompt(generate.prompt),
          altAuto: true,
          width: preset.width,
          height: preset.height,
          duration: preset.duration,
          frames: generate.kind === "gif" ? 24 : undefined,
          origin: "generated" as const,
          prompt: generate.prompt.trim(),
        };

        if (typeof generate.target === "number" && selected.kind === "post") {
          const post = selected.posts[generate.target];
          const media =
            generate.replaceIndex != null
              ? post.media.map((existing, i) => (i === generate.replaceIndex ? item : existing))
              : [...post.media, item];
          patchPost(generate.target, { media });
          commit(
            `${generate.kind} generated · ${preset.width}×${preset.height} · alt written from prompt — review it`,
            false,
          );
        } else if (selected.kind === "article" && generate.target === "cover") {
          patchSelected({ cover: { ...item, width: 1200, height: 675 } });
          commit("cover generated · 1200×675 · review its alt text", false);
        } else if (selected.kind === "article") {
          // One past the highest marker ever issued, not the count: after
          // removing [img:1] the count is 1 again, and a second image would
          // take the id [img:2] already in the body.
          const n = selected.inline.reduce((high, image) => Math.max(high, image.n), 0) + 1;
          const token = `[img:${n}]`;
          const caret = articleCaret ?? selected.body.length;
          const body = `${selected.body.slice(0, caret).replace(/\s+$/, "")}\n\n${token}\n\n${selected.body
            .slice(caret)
            .replace(/^\s+/, "")}`;
          patchSelected({
            inline: [...selected.inline, { ...item, width: 1600, height: 900, n }],
            body,
          });
          commit(`inline image ${token} placed at the cursor · review its alt text`, false);
        }
        setGenerate(null);
      },

      setTarget: (value) => patchSelected({ target: value }),
      setType: (value) => {
        if (!selected || selected.kind !== "post") return;
        if (value === "thread-append") {
          patchSelected(
            selected.type === "thread"
              ? { posts: [...selected.posts, emptyPost()] }
              : { type: "thread", posts: [...selected.posts, emptyPost()] },
          );
          return;
        }
        const next = value as XPostType;
        patchSelected({ type: next, target: "" });
      },
      setPermission: (value) => patchSelected({ replyPermission: value as XReplyPermission }),
      setTone: (tone) => patchSelected({ tone }),
      setNotes: (value) => patchSelected({ notes: value }),

      setArticleTitle: (value) => patchSelected({ title: value }),
      setArticleBody: (value) => patchSelected({ body: value }),
      setArticleCaret: (caret) => setArticleCaret(caret),
      setCoverAlt: (value) => {
        if (!selected || selected.kind !== "article" || !selected.cover) return;
        patchSelected({
          cover: { ...selected.cover, alt: value, altAuto: false },
        });
      },
      removeCover: () => patchSelected({ cover: undefined }),
      setInlineAlt: (index, value) => {
        if (!selected || selected.kind !== "article") return;
        patchSelected({
          inline: selected.inline.map((item, i) =>
            i === index ? { ...item, alt: value, altAuto: false } : item,
          ),
        });
      },
      removeInline: (index) => {
        if (!selected || selected.kind !== "article") return;
        const removed = selected.inline[index];
        patchSelected({
          inline: selected.inline.filter((_, i) => i !== index),
          body: selected.body.replace(new RegExp(`\\n*\\[img:${removed.n}\\]\\n*`), "\n\n"),
        });
      },
    }),
    [articleCaret, caretByPost, commit, generate, patchPost, patchSelected, selected],
  );

  const quotaPercent = Math.min(100, Math.round((quotaUsed / X_API_BUDGET) * 100));
  const quotaWarn = quotaPercent >= X_API_WARN_AT * 100;
  const quotaZero = quotaUsed >= X_API_BUDGET;
  const quotaTone = quotaZero
    ? "var(--color-danger)"
    : quotaWarn
      ? "var(--x-accent)"
      : "var(--text-muted)";

  const agenda = useMemo(() => {
    const entries = [
      ...approved.map((draft) => ({ at: draft.scheduledAt ?? 0, draft })),
      ...posted.map((draft) => ({ at: draft.postedAt ?? 0, draft })),
    ];
    return entries.sort((a, b) => a.at - b.at);
  }, [approved, posted]);
  const upcoming = agenda.filter((entry) => entry.at > now);

  const lastPosted = useMemo(
    () =>
      posted
        .slice()
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))[0] ?? null,
    [posted],
  );

  const resolveConfirm = (proceed: boolean) => {
    if (!proceed || !confirm || !selected) {
      setConfirm(null);
      return;
    }
    if (confirm === "discard") {
      commit("draft discarded");
      setDrafts((current) => current.filter((draft) => draft.id !== selected.id));
      setSelectedId(null);
    } else {
      commit("revoked · out of the queue");
      patchSelected({
        status: "revoked",
        revokedAt: Date.now(),
        scheduledAt: undefined,
      });
    }
    setConfirm(null);
  };

  const anyOverlay = quotaOpen || revisionsOpen || slotPickerOpen || railOpen;

  if (livePublishing) {
    return (
      <SurfaceRoom
        accentHue={38}
        header={
          <div className="x-comms-banner">
            <button
              ref={viewSwitchRef}
              type="button"
              className="role-surface-chip focus-ring"
              onClick={() => setLivePublishing(false)}
            >
              Back to demo planning
            </button>
          </div>
        }
      >
        <SurfaceCanvas label="Live X publishing">
          <XPublishPanel key={context.activeFamiliar.id} familiarId={context.activeFamiliar.id} />
        </SurfaceCanvas>
      </SurfaceRoom>
    );
  }

  return (
    <div
      className="x-comms"
      data-density={density}
      data-rail={railCollapsed ? "collapsed" : "expanded"}
      // The queue is drag-resizable, so its width is the one layout value that
      // cannot live in the sheet. Everything else is on the scale.
      style={{ "--x-queue-w": `${queueWidth}px` } as React.CSSProperties}
    >
      <SurfaceRoom
        accentHue={38}
        className="x-comms-room"
        header={
          <>
            {/* The room's one unavoidable disclaimer. It sits above everything
                because a console this faithful would otherwise read as live. */}
            <div className="x-comms-banner" data-tone="demo">
              <span className="x-comms-banner-icon">
                <Icon name="ph:warning" width={12} height={12} aria-hidden />
              </span>
              <strong>Demo room.</strong>
              <span className="x-comms-banner-body">{X_DEMO_NOTICE}</span>
              <button
                type="button"
                className="role-surface-chip focus-ring"
                ref={viewSwitchRef}
                onClick={() => setLivePublishing(true)}
              >
                Live publishing
              </button>
              {SHOW_ACCOUNT_STATE_SWITCH ? (
                <span className="x-comms-banner-tail">
                  <span>account state</span>
                  <Segmented
                    ariaLabel="Demo account state"
                    value={connection}
                    options={["connected", "disconnected", "rate-limited"] as const}
                    onChange={setConnection}
                  />
                </span>
              ) : (
                <span className="x-comms-banner-tail">
                  Live publishing requires confirmation
                </span>
              )}
            </div>

            {connection !== "connected" && (
              <div
                role="status"
                aria-live="polite"
                className="x-comms-banner"
                data-tone={connection === "disconnected" ? "danger" : "warn"}
              >
                <span className="x-comms-banner-icon">
                  <Icon name="ph:warning" width={12} height={12} aria-hidden />
                </span>
                <strong>
                  {connection === "disconnected" ? "X disconnected." : "API budget spent."}
                </strong>
                <span className="x-comms-banner-body">
                  {connection === "disconnected"
                    ? "Approvals still work; posts hold locally and go once the account reconnects."
                    : `${X_API_BUDGET} of ${X_API_BUDGET} used · scheduled posts wait for the reset.`}
                </span>
                <span className="x-comms-banner-tail">queue holds locally · nothing drops</span>
              </div>
            )}

            <header className="x-comms-header">
              {/* No title here: the room chrome's own header already names the
                  room. The frame carried one because it had no chrome above it;
                  repeating it would put "X Comms" on screen twice. */}
              <span className="x-comms-title">
                <span className="x-comms-subtitle">
                  {context.activeFamiliar.display_name || context.activeFamiliar.name}
                  &apos;s X room.
                </span>
              </span>
              <span className="x-comms-header-tools">
                <Segmented
                  ariaLabel="Density"
                  value={density}
                  options={["comfortable", "compact"] as const}
                  onChange={setDensity}
                />
                <span className="x-comms-account">
                  <button
                    type="button"
                    className="x-comms-account-trigger focus-ring"
                    aria-expanded={quotaOpen}
                    title="Connected X account · click for API budget"
                    style={
                      {
                        "--x-account-border": quotaWarn
                          ? "color-mix(in oklch, var(--x-accent) 45%, var(--border))"
                          : "var(--border)",
                      } as React.CSSProperties
                    }
                    onClick={() => {
                      setQuotaOpen((open) => !open);
                      setRevisionsOpen(false);
                    }}
                  >
                    <span className="x-comms-avatar" aria-hidden>
                      {X_ACCOUNT.initial}
                    </span>
                    <span className="x-comms-account-handle">{X_ACCOUNT.handle}</span>
                    <span className="x-comms-account-divider" aria-hidden />
                    <span
                      className="x-comms-quota"
                      style={
                        {
                          "--x-quota-tone": quotaTone,
                          "--x-quota-pct": `${quotaPercent}%`,
                        } as React.CSSProperties
                      }
                    >
                      <span className="x-comms-meter" aria-hidden>
                        <span className="x-comms-meter-fill" />
                      </span>
                      {quotaZero ? "api 0 left" : `api ${X_API_BUDGET - quotaUsed} left`}
                    </span>
                  </button>

                  {quotaOpen && (
                    <div className="x-comms-popover" role="dialog" aria-label="API budget">
                      <div className="x-comms-popover-head">
                        <strong>API budget</strong>
                        <span>24h window · resets in 42m</span>
                      </div>
                      <dl className="x-comms-stat-row">
                        <div className="x-comms-stat">
                          <dt>used</dt>
                          <dd
                            data-tone="quota"
                            style={{ "--x-quota-tone": quotaTone } as React.CSSProperties}
                          >
                            {quotaUsed}
                          </dd>
                        </div>
                        <div className="x-comms-stat">
                          <dt>left</dt>
                          <dd>{Math.max(0, X_API_BUDGET - quotaUsed)}</dd>
                        </div>
                        <div className="x-comms-stat">
                          <dt>queued cost</dt>
                          <dd>{queuedApiCost(drafts)}</dd>
                        </div>
                      </dl>
                      <div>
                        <span
                          className="x-comms-budget-track"
                          aria-hidden
                          style={
                            {
                              "--x-quota-tone": quotaTone,
                              "--x-quota-pct": `${quotaPercent}%`,
                            } as React.CSSProperties
                          }
                        >
                          <span className="x-comms-meter-fill" />
                          <span className="x-comms-budget-threshold" />
                        </span>
                        <span className="x-comms-budget-scale">
                          <span>0</span>
                          <span data-warn="">1200 · warn</span>
                          <span>{X_API_BUDGET}</span>
                        </span>
                      </div>
                      <dl>
                        <div className="x-comms-note">
                          <span className="x-comms-dot" data-filled="true" data-tone="posted" aria-hidden />
                          <dt>consumes</dt>
                          <dd>
                            1 · post, reply, quote, dm
                            <br />2 · media upload
                            <br />0 · drafts, previews, approvals
                          </dd>
                        </div>
                        <div className="x-comms-note" data-tone="warn">
                          <span className="x-comms-dot" data-filled="true" data-tone="accent" aria-hidden />
                          <dt>at 80%</dt>
                          <dd>pill turns amber · new slots suggested after the reset</dd>
                        </div>
                        <div className="x-comms-note" data-tone="danger">
                          <span className="x-comms-dot" data-filled="true" data-tone="danger" aria-hidden />
                          <dt>at zero</dt>
                          <dd>
                            approved posts hold locally · go at their slot after the reset ·
                            nothing drops, nothing auto-retries
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </span>
              </span>
            </header>
          </>
        }
        drawer={
          agenda.length === 0 ? (
            <p role="status" className="x-comms-group-empty">
              Nothing scheduled.
            </p>
          ) : (
            <ol className="x-comms-agenda">
              {agenda.map(({ at, draft }) => {
                const status = X_STATUS[draft.status];
                const future = at > now;
                return (
                  <li key={draft.id}>
                    <button
                      type="button"
                      className="x-comms-agenda-row focus-ring-inset"
                      onClick={() => setSelectedId(draft.id)}
                    >
                      <span
                        className="x-comms-agenda-time"
                        data-future={future ? "true" : "false"}
                      >
                        <span
                          className="x-comms-dot"
                          data-filled={status.filled ? "true" : "false"}
                          style={{ "--x-dot-tone": status.tone } as React.CSSProperties}
                          aria-hidden
                        />
                        {slotLabel(now, at)}
                      </span>
                      <span className="x-comms-row-icon">
                        <Icon
                          name={
                            (draft.kind === "article"
                              ? "ph:file-text"
                              : X_POST_TYPES[draft.type].icon) as IconName
                          }
                          width={13}
                          height={13}
                          aria-hidden
                        />
                      </span>
                      <span className="x-comms-agenda-title" title={titleOf(draft)}>
                        {titleOf(draft)}
                      </span>
                      <span className="x-comms-agenda-note">
                        {future
                          ? countdownLabel(now, at)
                          : draft.metrics
                            ? `${formatCount(draft.metrics.impressions)} impressions · ${draft.metrics.engagementRate}% eng`
                            : "posted"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )
        }
        drawerOpen={agendaOpen}
        onToggleDrawer={() => setAgendaOpen((open) => !open)}
        drawerTitle="Agenda"
        drawerSummary={
          <>
            <span className="x-comms-agenda-note">
              {upcoming.length
                ? `next · ${slotLabel(now, upcoming[0].at)} · ${titleOf(upcoming[0].draft)}`
                : "nothing scheduled"}
            </span>
            <span className="x-comms-agenda-counts">
              <span className="x-comms-agenda-count">
                <span
                  className="x-comms-dot"
                  data-filled="true"
                  style={
                    {
                      "--x-dot-tone": pending.length
                        ? "var(--x-accent)"
                        : "var(--text-muted)",
                    } as React.CSSProperties
                  }
                  aria-hidden
                />
                queued {pending.length}
              </span>
              <span className="x-comms-agenda-count">
                <span className="x-comms-dot" data-filled="false" data-tone="scheduled" aria-hidden />
                scheduled {approved.length}
              </span>
              <span className="x-comms-agenda-count">
                <span className="x-comms-dot" data-filled="true" data-tone="posted" aria-hidden />
                posted {posted.length}
              </span>
            </span>
          </>
        }
      >
        {/* Direct children of the room's own column grid — the sheet only
            re-proportions it, it does not re-implement it. */}
        <>
          <QueueRail
            drafts={drafts}
            selectedId={selectedId}
            collapsedGroups={collapsedGroups}
            connectionLabel={
              connection === "connected"
                ? "X connected"
                : connection === "disconnected"
                  ? "X disconnected"
                  : "X rate-limited"
            }
            connectionTone={
              connection === "connected"
                ? "var(--x-state-posted)"
                : connection === "disconnected"
                  ? "var(--color-danger)"
                  : "var(--x-accent)"
            }
            blockerFor={(draft) => approvalBlocker(draft)}
            onToggleGroup={(label) =>
              setCollapsedGroups((current) => ({ ...current, [label]: !current[label] }))
            }
            onSelect={(id) => {
              setSelectedId(id);
              setRevisionsOpen(false);
              setRailOpen(false);
            }}
            onApprove={approve}
            onDecline={decline}
            onNewPost={() => newDraft("post")}
            onNewArticle={() => newDraft("article")}
            onResizeStart={startResize}
            onResizeKey={resizeByKey}
            now={now}
          />

          <section className="x-comms-canvas" aria-label="Composer">
            {selected ? (
              <div className="x-comms-compose">
                <div className="x-comms-doc-head">
                  <span className="x-comms-doc-name">
                    {renaming ? (
                      <input
                        ref={renameRef}
                        className="x-comms-rename"
                        value={renameValue}
                        aria-label="Draft name"
                        placeholder={derivedTitle(selected)}
                        autoFocus
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => {
                          patchSelected({ name: renameValue.trim() || undefined });
                          setRenaming(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            patchSelected({ name: renameValue.trim() || undefined });
                            setRenaming(false);
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            setRenaming(false);
                          }
                        }}
                      />
                    ) : (
                      <h3
                        title={`Double-click to name this draft · otherwise named from its content`}
                        onDoubleClick={() => {
                          setRenameValue(selected.name ?? "");
                          setRenaming(true);
                        }}
                      >
                        {titleOf(selected)}
                      </h3>
                    )}

                    <span className="x-comms-path">
                      <span>
                        <span className="x-comms-path-dir">~/drafts</span> /{" "}
                        <span className="x-comms-path-file">
                          x.{selected.kind === "article" ? "article" : selected.type}
                        </span>
                      </span>
                      <span className="x-comms-revisions-wrap">
                        <button
                          type="button"
                          className="x-comms-revisions-trigger focus-ring"
                          aria-expanded={revisionsOpen}
                          title="Local revision history · restore any point"
                          onClick={() => {
                            setRevisionsOpen((open) => !open);
                            setQuotaOpen(false);
                          }}
                        >
                          · saved{" "}
                          {relativeLabel(now, selected.revisions[0]?.at ?? selected.createdAt)} ·{" "}
                          {selected.revisions.length} revisions
                        </button>
                        {revisionsOpen && (
                          <div className="x-comms-revisions" role="dialog" aria-label="Revisions">
                            <span className="x-comms-revisions-label">
                              revisions · local only · newest first
                            </span>
                            {selected.revisions.map((revision, index) => (
                              <div
                                key={index}
                                className="x-comms-revision"
                                data-current={index === 0 ? "true" : "false"}
                              >
                                <span className="x-comms-revision-when">
                                  {relativeLabel(now, revision.at)}
                                </span>
                                <span className="x-comms-revision-note" title={revision.note}>
                                  {revision.note}
                                </span>
                                {index === 0 ? (
                                  <span className="x-comms-revision-when">current</span>
                                ) : revision.posts && selected.kind === "post" ? (
                                  <button
                                    type="button"
                                    className="x-comms-micro focus-ring"
                                    onClick={() => {
                                      commit(`restored · ${revision.note}`);
                                      patchSelected({
                                        posts: revision.posts,
                                        revisions: [
                                          {
                                            at: Date.now(),
                                            note: `you · restored "${revision.note}"`,
                                            posts: selected.posts,
                                          },
                                          ...selected.revisions,
                                        ],
                                      });
                                      setRevisionsOpen(false);
                                    }}
                                  >
                                    restore
                                  </button>
                                ) : (
                                  <span className="x-comms-revision-when">—</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </span>
                    </span>
                  </span>

                  <span className="x-comms-view-switch">
                    <Segmented
                      ariaLabel="Composer view"
                      value={view}
                      options={["compose", "preview"] as const}
                      onChange={setView}
                      labelOf={(option) =>
                        option === "compose" ? "Compose" : "Preview"
                      }
                      equalWidth
                    />
                  </span>
                </div>

                {view === "compose" ? (
                  <Composer
                    draft={selected}
                    caretByPost={caretByPost}
                    focusedOption={focusedOption}
                    generate={generate}
                    actions={actions}
                    onFocusOption={setFocusedOption}
                  />
                ) : (
                  <Preview draft={selected} now={now} />
                )}
              </div>
            ) : (
              <div className="x-comms-empty">
                <EmptyState
                  icon="ph:x-logo-bold"
                  headline={drafts.length ? "No draft selected." : "Nothing drafted."}
                  subtitle={
                    drafts.length
                      ? "Pick one from the queue or start a post."
                      : "Start a post. Approve it. It waits in the queue until its slot."
                  }
                />
              </div>
            )}
          </section>

          {railCollapsed && (
            <nav className="x-comms-rail-tabs" aria-label="Dispatch tabs">
              {DISPATCH_TABS.map((tab) => {
                const active = railOpen && dispatchTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className="x-comms-rail-tab focus-ring"
                    aria-label={tab.label}
                    title={tab.title}
                    aria-pressed={active}
                    onClick={() => {
                      setRailOpen(!(railOpen && dispatchTab === tab.id));
                      setDispatchTab(tab.id);
                    }}
                  >
                    <Icon name={tab.icon} width={14} height={14} aria-hidden />
                    {tab.id === "approval" && pending.length > 0 && (
                      <span className="x-comms-badge" aria-hidden />
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {(!railCollapsed || railOpen) && (
          <aside className="x-comms-dispatch" aria-label="Dispatch">
            <div role="tablist" aria-label="Dispatch sections" className="x-comms-tablist">
              {DISPATCH_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={dispatchTab === tab.id}
                  className="x-comms-tab focus-ring"
                  title={tab.title}
                  onClick={() => setDispatchTab(tab.id)}
                >
                  <span className="x-comms-tab-label">{tab.label}</span>
                  {tab.id === "approval" && pending.length > 0 && (
                    <>
                      <span className="x-comms-badge" aria-hidden />
                      <span className="sr-only">
                        {pending.length} awaiting you
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>

            {dispatchTab === "approval" &&
              (selected ? (
                <ApprovalCard
                  draft={selected}
                  now={now}
                  open={!closedCards.approval}
                  blocker={blocker}
                  confirm={confirm}
                  nextSlotAt={nextSlotAt}
                  primaryRef={primaryRef}
                  onToggle={() =>
                    setClosedCards((current) => ({ ...current, approval: !current.approval }))
                  }
                  onRequestApproval={() => {
                    if (selected.kind !== "post") {
                      patchSelected({ status: "needs-approval" });
                      return;
                    }
                    patchSelected({
                      status: "needs-approval",
                      revisions: [
                        { at: Date.now(), note: "you · requested approval", posts: selected.posts },
                        ...selected.revisions,
                      ],
                    });
                  }}
                  onApprove={() => approve(selected.id)}
                  onDecline={() => decline(selected.id)}
                  onOpenSlotPicker={() => {
                    setPickedSlot(selected.scheduledAt ?? nextSlotAt);
                    setSlotPickerOpen(true);
                  }}
                  onRetry={() => {
                    commit("re-queued for next slot");
                    patchSelected({
                      status: "approved",
                      scheduledAt: nextSlot(Date.now()),
                      failedAt: undefined,
                      failReason: undefined,
                    });
                  }}
                  onAskConfirm={setConfirm}
                  onResolveConfirm={resolveConfirm}
                />
              ) : (
                <p role="status" className="x-comms-card x-comms-group-empty">
                  Select a draft to approve it.
                </p>
              ))}

            {dispatchTab === "control" && (
              <ControlCard
                open={!closedCards.control}
                whyOpen={whyOpen}
                draftCount={draftCount}
                pendingCount={pending.length}
                scheduledCount={approved.length}
                onToggle={() =>
                  setClosedCards((current) => ({ ...current, control: !current.control }))
                }
                onToggleWhy={() => setWhyOpen((open) => !open)}
              />
            )}

            {dispatchTab === "trends" && (
              <TrendsCard
                open={!closedCards.trends}
                openTrend={openTrend}
                timingOpen={timingOpen}
                hasSelection={selected != null && isEditable(selected)}
                now={now}
                nextSlotAt={nextSlotAt}
                onToggle={() =>
                  setClosedCards((current) => ({ ...current, trends: !current.trends }))
                }
                onToggleTrend={(index) =>
                  setOpenTrend((current) => (current === index ? null : index))
                }
                onToggleTiming={() => setTimingOpen((open) => !open)}
                onInsertReference={(line) => {
                  if (!selected) return;
                  patchSelected({
                    notes: selected.notes ? `${selected.notes} · ${line}` : line,
                  });
                  commit("reference added to notes · body untouched", false);
                }}
              />
            )}

            {dispatchTab === "analytics" && (
              <AnalyticsCard
                open={!closedCards.analytics}
                lastPosted={lastPosted}
                now={now}
                onToggle={() =>
                  setClosedCards((current) => ({ ...current, analytics: !current.analytics }))
                }
              />
            )}
          </aside>
          )}
        </>
      </SurfaceRoom>

      {anyOverlay && (
        <button
          type="button"
          className="x-comms-scrim"
          data-dim={slotPickerOpen ? "true" : undefined}
          aria-label="Close"
          onClick={closeOverlays}
        />
      )}

      {slotPickerOpen && selected && (
        <SlotPicker
          now={now}
          picked={pickedSlot ?? selected.scheduledAt ?? nextSlotAt}
          onPick={setPickedSlot}
          onCancel={() => {
            setSlotPickerOpen(false);
            setPickedSlot(null);
          }}
          onUse={() => {
            const at = pickedSlot ?? nextSlotAt;
            commit(`slot changed · ${slotLabel(now, at)}`);
            patchSelected({ scheduledAt: at });
            setSlotPickerOpen(false);
            setPickedSlot(null);
          }}
        />
      )}

      {toast && (
        <div role="status" aria-live="polite" className="x-comms-toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="x-comms-toast-undo focus-ring" onClick={undo}>
              undo · {toast.secondsLeft}s
            </button>
          )}
          <button
            type="button"
            className="x-comms-toast-dismiss focus-ring"
            aria-label="Dismiss"
            onClick={() => {
              clearToastTimer();
              setToast(null);
            }}
          >
            <Icon name="ph:x" width={11} height={11} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
