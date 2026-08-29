"use client";

/**
 * Research intake engine — the "New research" composer (cave-dl74, Phase B1).
 *
 * The design's prompt card: a large intent textarea with a slash-command
 * palette, agentic "✦ Improve", suggested-angle chips derived from REAL
 * mission/link titles, attached quick-save chips, a compact mode picker backed
 * by the shared auto-routing inference, and the original
 * collapsible bounds editor (the plan keeps bounds review even though the
 * design omits it). Validation is unchanged: the shared
 * RESEARCH_INTENT_MIN_LENGTH gate, aria-invalid wiring, and the honest
 * daemon-offline note all carry over from the pre-redesign composer.
 *
 * Slash commands map to real actions only: /brief /sweep /paper /deep set the
 * mode (deep = autoresearch, shown as "Deep loop"), /improve runs agentic Improve,
 * /suggest rotates the angle chips (only offered when real seeds exist), and
 * /save jumps to the Resources tab. The design's /task, /find and /chat are
 * omitted here: there is no board-create wiring from the intake, /find belongs
 * to the Desk's runs rail, and a prompt that has not started yet has no
 * session for /chat to open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import type { ChatModelState } from "@/lib/chat-model-state";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "@/lib/research-mission-routing";
import {
  RESEARCH_BOUND_LIMITS,
  RESEARCH_INTENT_MAX_LENGTH,
  RESEARCH_INTENT_MIN_LENGTH,
  RESEARCH_MISSION_MODES,
  type CreateResearchMissionInput,
  RESEARCH_HARNESS_IDS,
  RESEARCH_RUNTIME_DEFAULT_HARNESS,
  type ResearchBounds,
  type ResearchMission,
  type ResearchMissionMode,
} from "@/lib/research-missions";
import { inventoryProvenanceLabel, useRuntimeModelInventory } from "@/lib/use-runtime-model-options";
import { usePromptEnhance } from "@/lib/use-prompt-enhance";
import {
  RESEARCH_BRIEF_FIELDS,
  assembleBrief,
  parseBrief,
  promptStrength,
  summarizeRecommendationTitle,
  type ResearchPromptRecommendation,
} from "@/lib/research-prompt-brief";
import { ResearchPromptBuilder } from "./research-prompt-builder";
import { ResearchPromptStrengthMeter } from "./research-prompt-strength";
import type { TopicProposalDraftV1 } from "@/lib/research-topic-discovery";

type StartResult =
  | { ok: true; mission: ResearchMission }
  | { ok: false; error: string };

export type AttachedResearchLink = {
  id: string;
  title: string;
  url: string;
};

type Props = {
  familiarId: string;
  daemonRunning: boolean;
  onStart(input: CreateResearchMissionInput): Promise<StartResult>;
  /** Mode preselected by cross-tab navigation (treated as a manual choice). */
  initialMode?: ResearchMissionMode;
  /** Quick saves the user attached as related context (chips with ✕). */
  attachedLinks?: AttachedResearchLink[];
  onRemoveAttached?(id: string): void;
  /** REAL angle seeds — recent mission titles + saved-link titles. */
  angleSeeds?: string[];
  /** The /save command destination (Resources tab). */
  onOpenResources?(): void;
  /** Prompts derived from real missions; empty renders no ⚡ affordance. */
  recommendations?: ResearchPromptRecommendation[];
  /** Current draft, reported up so Quick saves can match against it. */
  onDraftChange?(draft: string): void;
  /** An explicitly accepted recommendation replaces the composer draft once. */
  recommendedDraft?: { value: string; revision: number } | null;
  /** An accepted Topic Discovery proposal pre-fills intent/mode/bounds once. */
  initialDraft?: TopicProposalDraftV1;
};

const MODE_LABELS: Record<ResearchMissionMode, string> = {
  brief: "Brief",
  sweep: "Sweep",
  paper: "Paper",
  autoresearch: "Deep loop",
};

/** Display names for the runtimes a mission may run on. Unknown ids fall back
 *  to the raw id rather than being hidden, so a newly added adapter is still
 *  selectable before it earns a label here. */
const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  copilot: "Copilot",
  hermes: "Hermes",
  grok: "Grok",
  openclaw: "OpenClaw",
  opencode: "OpenCode",
};

const MODE_DESCRIPTIONS: Record<ResearchMissionMode, string> = {
  brief: "A fast answer to one question.",
  sweep: "Map a landscape of options or players.",
  paper: "A cited, structured report.",
  autoresearch: "Iterative research with checkpoints you review.",
};

/** Card meta derived from the real default plan — never hand-written numbers. */
export function modeCardMeta(mode: ResearchMissionMode): string {
  const bounds = defaultResearchPlan(mode).bounds;
  const passes = mode === "autoresearch"
    ? `up to ${bounds.maxIterations} passes`
    : `${bounds.maxIterations} pass${bounds.maxIterations === 1 ? "" : "es"}`;
  return `${passes} · ${bounds.wallClockMinutes} min · ${bounds.sourceTarget} sources`;
}

/** A trailing slash token opens the command palette (design logic 785–811). */
export function matchSlashCommand(text: string): { query: string } | null {
  const match = text.match(/(^|\s)\/([a-z]*)$/i);
  return match ? { query: match[2].toLowerCase() } : null;
}

/** Remove the trailing slash token once its command runs — commands act, they
 *  never leave "/brief" behind to pollute the mission intent. */
export function stripSlashToken(text: string): string {
  return text.replace(/(^|\s)\/[a-z]*$/i, "$1").replace(/\s+$/, "");
}

/** The design's angle-expansion phrasing applied to a REAL title. */
export function buildAngleBrief(title: string): string {
  return `${title}. Compare the leading approaches, quantify the tradeoffs with numbers from primary sources, flag conflicting claims for verification, and close with a recommendation for our stack.`;
}

/** Up to three chips rotated through the real seed list; empty seeds mean no
 *  chips row at all — there are no canned fallback topics. */
export function buildAngleChips(
  seeds: string[],
  offset: number,
): { title: string; brief: string }[] {
  const unique = [...new Set(seeds.map((seed) => seed.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const take = Math.min(3, unique.length);
  return Array.from({ length: take }, (_, index) => {
    const title = unique[(offset + index) % unique.length];
    return { title, brief: buildAngleBrief(title) };
  });
}

type SlashCommand = {
  cmd: string;
  label: string;
  hint: string;
  run: "mode" | "improve" | "suggest" | "save";
  mode?: ResearchMissionMode;
};

function slashCommands(hasAngles: boolean, hasResources: boolean): SlashCommand[] {
  const commands: SlashCommand[] = [
    { cmd: "/brief", label: "Start a quick brief", hint: modeCardMeta("brief"), run: "mode", mode: "brief" },
    { cmd: "/sweep", label: "Start a landscape sweep", hint: modeCardMeta("sweep"), run: "mode", mode: "sweep" },
    { cmd: "/paper", label: "Start a cited paper", hint: modeCardMeta("paper"), run: "mode", mode: "paper" },
    { cmd: "/deep", label: "Start a deep loop with checkpoints", hint: modeCardMeta("autoresearch"), run: "mode", mode: "autoresearch" },
    { cmd: "/improve", label: "Improve this prompt", hint: "rewrites for scope and rigor", run: "improve" },
  ];
  if (hasAngles) {
    commands.push({ cmd: "/suggest", label: "Suggest research angles", hint: "from your runs and saved links", run: "suggest" });
  }
  if (hasResources) {
    commands.push({ cmd: "/save", label: "Save links in Resources", hint: "jumps to the Resources tab", run: "save" });
  }
  return commands;
}

function boundNumber(value: string, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

/** The four numeric bounds the editor exposes (spend/cost stay plan-driven). */
type BoundKey = "wallClockMinutes" | "maxIterations" | "sourceTarget" | "checkpointEvery";

/** Commit order: iterations apply before checkpoints so the cap is current. */
const BOUND_KEYS: readonly BoundKey[] = [
  "wallClockMinutes",
  "maxIterations",
  "sourceTarget",
  "checkpointEvery",
];

/** One raw bound edit parsed against the same clamps the old handlers used:
 *  invalid/empty falls back to 1, iterations drag checkpointEvery down with
 *  them, and checkpointEvery caps at the current iteration count. */
function applyBoundEdit(current: ResearchBounds, key: BoundKey, raw: string): ResearchBounds {
  if (key === "maxIterations") {
    const maxIterations = boundNumber(raw, 1, RESEARCH_BOUND_LIMITS.maxIterations);
    return {
      ...current,
      maxIterations,
      checkpointEvery: Math.min(current.checkpointEvery, maxIterations),
    };
  }
  if (key === "checkpointEvery") {
    return { ...current, checkpointEvery: boundNumber(raw, 1, current.maxIterations) };
  }
  return { ...current, [key]: boundNumber(raw, 1, RESEARCH_BOUND_LIMITS[key]) };
}

export function ResearchMissionComposer({
  familiarId,
  daemonRunning,
  onStart,
  initialMode,
  attachedLinks = [],
  onRemoveAttached,
  angleSeeds = [],
  onOpenResources,
  recommendations = [],
  onDraftChange,
  recommendedDraft,
  initialDraft,
}: Props) {
  const { announce } = useAnnouncer();
  const [intent, setIntent] = useState("");
  const [mode, setModeState] = useState<"auto" | ResearchMissionMode>(initialMode ?? "auto");
  const [bounds, setBounds] = useState<ResearchBounds>(
    defaultResearchPlan(initialMode ?? "brief").bounds,
  );
  // Raw text for a bound input while it is being edited — committed numbers
  // live in `bounds`. Parsing on every keystroke made fields uncloseable:
  // clearing snapped to 1, so typing "5" produced "15".
  const [boundDrafts, setBoundDrafts] = useState<Partial<Record<BoundKey, string>>>({});
  // Copilot is the safe fallback until the familiar's shared model state loads.
  const [harness, setHarness] = useState<string>(RESEARCH_RUNTIME_DEFAULT_HARNESS);
  const [model, setModel] = useState("");
  const modelSelectionDirtyRef = useRef(false);
  // The familiar whose model state the effect below last loaded, so a daemon
  // status transition can be told apart from an actual familiar switch.
  const loadedFamiliarIdRef = useRef<string | null>(null);
  // Dirty latch: once a bound is hand-edited, auto-routing (which re-derives
  // the plan on every keystroke) must stop clobbering it. Explicit mode picks
  // clear the latch below, so a deliberate switch still resets.
  const boundsDirtyRef = useRef(false);
  const [boundsOpen, setBoundsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuCursor, setMenuCursor] = useState(0);
  const [angleOffset, setAngleOffset] = useState(0);
  const [builderOpen, setBuilderOpen] = useState(false);
  // The assembled-brief strip appears once the prompt is actually structured —
  // either the builder applied it or a recommendation loaded it. A hand-typed
  // sentence keeps the card quiet.
  const [briefShown, setBriefShown] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [briefNote, setBriefNote] = useState<string | null>(null);
  const appliedRecommendedDraftRevision = useRef<number | null>(null);

  useEffect(() => {
    const familiarChanged = loadedFamiliarIdRef.current !== familiarId;
    if (familiarChanged) {
      loadedFamiliarIdRef.current = familiarId;
      modelSelectionDirtyRef.current = false;
    } else if (modelSelectionDirtyRef.current) {
      return;
    }
    // A clean daemon transition must immediately restore the safe fallback
    // before capability re-evaluation; an explicit user pick returns above.
    setHarness(RESEARCH_RUNTIME_DEFAULT_HARNESS);
    setModel("");
    let cancelled = false;
    void (async () => {
      try {
        const [response, researchStatus] = await Promise.all([
          fetch(
            `/api/chat/model-state?familiarId=${encodeURIComponent(familiarId)}`,
            { cache: "no-store" },
          ),
          fetch("/api/daemon/status?scope=research-local", { cache: "no-store" })
            .then((result) => result.json() as Promise<{
              research?: { sessionLaunchPolicy?: boolean };
            }>)
            .catch(() => null),
        ]);
        const json = (await response.json()) as {
          ok?: boolean;
          state?: ChatModelState;
        };
        if (cancelled || modelSelectionDirtyRef.current || !json.ok || !json.state) return;
        if (
          json.state.harness === "codex"
          && researchStatus?.research?.sessionLaunchPolicy !== true
        ) return;
        setHarness(json.state.harness);
        setModel(json.state.effectiveModel);
      } catch {
        // Keep the Research-safe fallback when agent model state is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiarId, daemonRunning]);

  useEffect(() => {
    if (
      !recommendedDraft
      || appliedRecommendedDraftRevision.current === recommendedDraft.revision
    ) {
      return;
    }
    appliedRecommendedDraftRevision.current = recommendedDraft.revision;
    setIntent(recommendedDraft.value);
    setMenuDismissed(false);
    setMenuCursor(0);
  }, [recommendedDraft]);

  // Every setMode caller is an explicit pick — mode cards, slash commands,
  // Reset to Auto, cross-tab preselect — so a deliberate switch clears the
  // bounds dirty latch and lets the new plan's bounds apply.
  const setMode = useCallback((next: "auto" | ResearchMissionMode) => {
    boundsDirtyRef.current = false;
    setModeState(next);
  }, []);

  // Cross-tab navigation may re-target an already-mounted intake (e.g. the
  // Desk's /paper while the Prompt tab is live) — treat it as a manual pick.
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode, setMode]);

  // An accepted Topic Discovery proposal is a one-shot prefill: the question
  // becomes the intent, the suggested mode is selected, and the suggested
  // sourceTarget/wallClockMinutes land in the plan bounds. Other plan fields
  // (iterations, checkpointEvery) come from the mode's default plan.
  const appliedInitialDraftId = useRef<string | null>(null);
  useEffect(() => {
    if (!initialDraft || appliedInitialDraftId.current === initialDraft.proposalId) return;
    appliedInitialDraftId.current = initialDraft.proposalId;
    setIntent(initialDraft.question);
    setMode(initialDraft.mode);
    boundsDirtyRef.current = true;
    const draftPlan = defaultResearchPlan(initialDraft.mode).bounds;
    setBounds({
      ...draftPlan,
      sourceTarget: initialDraft.sourceTarget,
      wallClockMinutes: initialDraft.wallClockMinutes,
    });
  }, [initialDraft, setMode]);

  const inferred = useMemo(() => inferResearchMissionMode(intent), [intent]);
  const effectiveMode = mode === "auto" ? inferred.mode : mode;
  const plan = useMemo(() => defaultResearchPlan(effectiveMode), [effectiveMode]);
  const trimmedIntent = intent.trim();
  const intentTooShort = trimmedIntent.length > 0 && trimmedIntent.length < RESEARCH_INTENT_MIN_LENGTH;
  // Grow the box with the brief instead of scrolling three fixed rows. The CSS
  // caps it at ~12 lines, so `auto` then scrollHeight settles at the smaller of
  // content height and that ceiling; past it the element scrolls as before.
  // Measured on every intent change, including programmatic ones (slash
  // completions, /improve rewrites, restored drafts), not just typing.
  const intentBoxRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = intentBoxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [intent]);

  // Strength + assembled brief are pure reads of the textarea, so they track
  // hand edits made after the builder closed.
  const strength = useMemo(() => promptStrength(intent), [intent]);
  const brief = useMemo(() => parseBrief(intent), [intent]);
  const briefFilled = RESEARCH_BRIEF_FIELDS.filter((field) => brief[field.key].trim()).length;

  useEffect(() => {
    onDraftChange?.(intent);
  }, [intent, onDraftChange]);

  const runtimeModelInventory = useRuntimeModelInventory(harness, familiarId);
  const modelOptions = useMemo<StandardSelectOption<string>[]>(() => {
    const options: StandardSelectOption<string>[] = [
      {
        value: "",
        label: "Runtime default",
        detail: inventoryProvenanceLabel(
          runtimeModelInventory.provenance,
          runtimeModelInventory.loading,
        ),
      },
      ...runtimeModelInventory.models.map((option) => ({
        value: option.id,
        label: option.label,
        detail: option.id,
      })),
    ];
    if (model && !options.some((option) => option.value === model)) {
      options.push({ value: model, label: model, detail: "Selected model" });
    }
    return options;
  }, [
    model,
    runtimeModelInventory.loading,
    runtimeModelInventory.models,
    runtimeModelInventory.provenance,
  ]);

  const promptEnhance = usePromptEnhance({
    draft: intent,
    setDraft: setIntent,
    familiarId,
    mode: "research",
    context: {
      researchMode: effectiveMode,
      bounds,
      runtime: harness,
      model: model || null,
      relatedSources: attachedLinks.map((link) => ({
        id: link.id,
        title: link.title,
        url: link.url,
      })),
    },
    disabled: submitting || trimmedIntent.length < 3,
  });

  useEffect(() => {
    if (boundsDirtyRef.current) return;
    setBounds({ ...plan.bounds });
    setBoundDrafts({});
  }, [plan]);

  const editBound = (key: BoundKey, raw: string) => {
    boundsDirtyRef.current = true;
    setBoundDrafts((current) => ({ ...current, [key]: raw }));
  };

  const commitBound = (key: BoundKey) => {
    const raw = boundDrafts[key];
    if (raw === undefined) return;
    setBounds((current) => applyBoundEdit(current, key, raw));
    setBoundDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  /** What the input shows: the in-flight draft while editing, else the number. */
  const boundValue = (key: BoundKey): string => boundDrafts[key] ?? String(bounds[key]);

  /** Committed bounds plus any in-flight drafts — what Start actually submits. */
  const resolveBounds = (): ResearchBounds =>
    BOUND_KEYS.reduce((acc, key) => {
      const raw = boundDrafts[key];
      return raw === undefined ? acc : applyBoundEdit(acc, key, raw);
    }, bounds);

  // Enter inside a bounds field must never implicitly submit the form —
  // starting a paid mission stays behind the explicit Start button (the
  // textarea's palette shortcuts handle their own keys). Enter commits the
  // draft exactly like blur instead.
  const boundKeyDown = (key: BoundKey) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitBound(key);
  };

  // The summary pill doubles as the bounds toggle: open the editor and focus
  // its first input once visible; press again to collapse.
  const focusBound = (inputId: string) => {
    setBoundsOpen(true);
    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  };

  // ── Suggested angles: real mission/link titles only — an empty seed list
  // renders nothing (no fabricated topics). ─────────────────────────────────
  const angleChips = useMemo(
    () => buildAngleChips(angleSeeds, angleOffset),
    [angleSeeds, angleOffset],
  );
  const suggestAngles = () => {
    if (angleChips.length === 0) return;
    setAngleOffset((current) => current + angleChips.length);
    announce("Suggested new research angles.");
  };

  // ── ✦ Improve: familiar-backed streaming rewrite with the shared
  // race-safe apply/suggest/revert lifecycle and local offline fallback.
  const improveReady = trimmedIntent.length >= 3;
  const improving = promptEnhance.state.phase === "loading";

  // ── Slash-command palette (↑↓ / Tab / Enter / Esc per design 785–811). ────
  const slash = matchSlashCommand(intent);
  const commands = useMemo(
    () => slashCommands(angleSeeds.length > 0, Boolean(onOpenResources)),
    [angleSeeds.length, onOpenResources],
  );
  const menuItems = slash
    ? commands.filter((command) => command.cmd.slice(1).startsWith(slash.query))
    : [];
  const menuOpen = Boolean(slash) && !menuDismissed && menuItems.length > 0;
  const menuIndex = Math.min(menuCursor, Math.max(0, menuItems.length - 1));

  const runCommand = (command: SlashCommand) => {
    const stripped = stripSlashToken(intent);
    setIntent(stripped);
    setMenuCursor(0);
    if (command.run === "mode" && command.mode) {
      setMode(command.mode);
      announce(`${MODE_LABELS[command.mode]} mode selected.`);
    } else if (command.run === "improve") {
      promptEnhance.enhance("auto", stripped);
    } else if (command.run === "suggest") {
      suggestAngles();
    } else if (command.run === "save") {
      onOpenResources?.();
    }
  };

  const onIntentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen || menuItems.length === 0) return;
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      runCommand(menuItems[menuIndex]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuCursor((menuIndex + 1) % menuItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuCursor((menuIndex - 1 + menuItems.length) % menuItems.length);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setMenuDismissed(true);
    }
  };

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = intent.trim();
    if (trimmed.length < RESEARCH_INTENT_MIN_LENGTH || submitting) return;
    // Any bound still being edited commits before the mission is created, so
    // Start never submits a value the user already replaced on screen.
    const submittedBounds = resolveBounds();
    setBounds(submittedBounds);
    setBoundDrafts({});
    setSubmitting(true);
    setError(null);
    try {
      const result = await onStart({
        familiarId,
        intent: trimmed,
        mode: effectiveMode,
        modeSource: mode === "auto" ? "auto" : "user",
        deliverable: plan.deliverables.join(" + "),
        bounds: submittedBounds,
        harness,
        // Empty means "the harness picks", so send nothing rather than an empty
        // string the validator would reject.
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        announce(result.error);
        return;
      }
      setIntent("");
      announce(`Started ${result.mission.title}.`);
    } catch {
      setError("Research could not start. Check the runtime and try again.");
      announce("Research could not start.");
    } finally {
      setSubmitting(false);
    }
  };

  const manual = mode !== "auto";
  const focusIntent = () => requestAnimationFrame(() => intentBoxRef.current?.focus());

  return (
    <form className="research-mission-composer research-intake__form" onSubmit={start}>
      <div className="research-intake__card">
        <div className="research-mission-composer__prompt research-intake__prompt">
          <label htmlFor="research-intent" className="sr-only">What should we investigate?</label>
          <textarea
            id="research-intent"
            ref={intentBoxRef}
            maxLength={RESEARCH_INTENT_MAX_LENGTH}
            value={intent}
            onChange={(event) => {
              setIntent(event.target.value);
              setMenuDismissed(false);
              setMenuCursor(0);
            }}
            onKeyDown={onIntentKeyDown}
            placeholder="What should we investigate?  Type / for commands"
            rows={3}
            aria-invalid={Boolean(error) || intentTooShort}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-controls="research-cmd-menu"
            aria-activedescendant={menuOpen ? `research-cmd-${menuItems[menuIndex].cmd.slice(1)}` : undefined}
            aria-describedby={error
              ? "research-mission-error"
              : intentTooShort
                ? "research-intent-minimum"
                : "research-plan-review"}
          />
          {menuOpen ? (
            <div className="research-cmd-menu" id="research-cmd-menu" role="listbox" aria-label="Prompt commands">
              {menuItems.map((command, index) => (
                <div
                  key={command.cmd}
                  id={`research-cmd-${command.cmd.slice(1)}`}
                  role="option"
                  aria-selected={index === menuIndex}
                  className="research-cmd-menu__item"
                  onMouseDown={(event) => {
                    // mousedown, not click — keep the textarea focused.
                    event.preventDefault();
                    runCommand(command);
                  }}
                >
                  <span className="research-cmd-menu__cmd">{command.cmd}</span>
                  <span className="research-cmd-menu__label">{command.label}</span>
                  <span className="research-cmd-menu__hint">{command.hint}</span>
                </div>
              ))}
              <p className="research-cmd-menu__keys" aria-hidden>↑↓ navigate · Tab or ⏎ complete · Esc dismiss</p>
            </div>
          ) : null}
          {intentTooShort ? (
            <p id="research-intent-minimum" className="research-intent-minimum">
              Add at least {RESEARCH_INTENT_MIN_LENGTH} characters so the familiar has a real question to investigate.
            </p>
          ) : null}
          {/* Static text, deliberately not a live region — announcing every
              keystroke would drown the composer. The ceiling is visible while
              writing rather than discovered as a server rejection afterwards. */}
          <span
            className={`research-intent-count${
              intent.length >= RESEARCH_INTENT_MAX_LENGTH * 0.9 ? " research-intent-count--near" : ""
            }`}
          >
            {intent.length.toLocaleString()} / {RESEARCH_INTENT_MAX_LENGTH.toLocaleString()}
          </span>
        </div>

        {attachedLinks.length > 0 ? (
          <div className="research-intake__attached" role="group" aria-label="Resources ready for first pass">
            <span className="research-intake__attached-label">
              Resources ready for first pass ({attachedLinks.length}):
            </span>
            {attachedLinks.map((link) => (
              <span key={link.id} className="research-intake__attached-chip">
                {link.title}
                <button
                  type="button"
                  className="research-intake__attached-remove"
                  aria-label={`Remove ${link.title} from the first research pass`}
                  onClick={() => onRemoveAttached?.(link.id)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {angleChips.length === 0 ? null : (
          <div className="research-intake__angles" role="group" aria-label="Suggested angles">
            {angleChips.map((chip) => (
              <button
                key={chip.title}
                type="button"
                className="research-intake__angle"
                // The seed is a whole pasted prompt, so the full text is the
                // tooltip and the pill carries a headline. Rendering the seed
                // raw put "## Report topic **…" markdown on the chip.
                title={chip.title}
                onClick={() => setIntent(chip.brief)}
              >
                {summarizeRecommendationTitle(chip.title)}
              </button>
            ))}
          </div>
        )}

        {briefShown ? (
          <div className="research-brief" role="group" aria-label="Assembled brief">
            <div className="research-brief__head">
              <span className="research-brief__kicker">✦ Assembled brief</span>
              <span className="research-brief__summary">
                {briefFilled} of {RESEARCH_BRIEF_FIELDS.length} elements · reused at every checkpoint
              </span>
              <button
                type="button"
                className="research-brief__edit focus-ring"
                onClick={() => setBuilderOpen(true)}
              >
                Edit in builder
              </button>
              <button
                type="button"
                className="research-brief__dismiss focus-ring"
                aria-label="Dismiss the assembled brief"
                onClick={() => setBriefShown(false)}
              >
                ✕
              </button>
            </div>
            <div className="research-brief__rows">
              {RESEARCH_BRIEF_FIELDS.map((field) => {
                const value = brief[field.key].trim();
                return (
                  <div
                    key={field.key}
                    className="research-brief__row"
                    data-set={Boolean(value)}
                    title={value || undefined}
                  >
                    <span className="research-brief__mark" aria-hidden>{value ? "✓" : "·"}</span>
                    <span className="research-brief__cell">
                      <span className="research-brief__label">{field.label}</span>
                      <span className="research-brief__value">{value || "—"}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {briefNote ? <p className="research-brief__note">{briefNote}</p> : null}
          </div>
        ) : null}

        {recsOpen && recommendations.length > 0 ? (
          <div className="research-recs" role="group" aria-label="Recommended prompts">
            <span className="research-recs__kicker">
              ⚡ Recommended from your runs
            </span>
            <div className="research-recs__grid">
              {recommendations.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  className="research-recs__card focus-ring"
                  onClick={() => {
                    setIntent(assembleBrief(rec.brief));
                    setBriefShown(true);
                    setRecsOpen(false);
                    setBriefNote(`Loaded from ${rec.why}.`);
                    announce("Prompt loaded from a recommendation.");
                  }}
                >
                  <span className="research-recs__title">{rec.title}</span>
                  <span className="research-recs__foot">
                    <span className="research-recs__why" data-tone={rec.tone}>{rec.why}</span>
                    <span className="research-recs__use" aria-hidden>Use →</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="research-intake__footer">
          <button
            type="button"
            className="research-improve focus-ring"
            data-active={improving}
            disabled={!improveReady && !improving}
            title={improving ? "Cancel prompt improvement" : "Improve this prompt with the familiar"}
            onClick={() => {
              if (improving) {
                promptEnhance.cancel();
                focusIntent();
                return;
              }
              promptEnhance.enhance();
            }}
          >
            {improving ? "✦ Stop improving" : "✦ Improve"}
          </button>
          <button
            type="button"
            className="research-builder-open focus-ring"
            title="Structure the question: goal, constraints, deliverable, sources"
            onClick={() => setBuilderOpen(true)}
          >
            ✦ Prompt builder
          </button>
          {recommendations.length > 0 ? (
            <button
              type="button"
              className="research-recs-open focus-ring"
              aria-expanded={recsOpen}
              title="Prompts derived from your runs"
              onClick={() => setRecsOpen((open) => !open)}
            >
              ⚡ Recommendations
            </button>
          ) : null}
          {angleSeeds.length > 0 ? (
            <button type="button" className="research-suggest" onClick={suggestAngles}>
              Suggest angles
            </button>
          ) : null}
          <ResearchPromptStrengthMeter strength={strength} showMissing={trimmedIntent.length > 0} />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            leadingIcon="ph:play"
            loading={submitting}
            disabled={trimmedIntent.length < RESEARCH_INTENT_MIN_LENGTH}
            className="research-intake__start"
          >
            Start research
          </Button>
        </div>
        {promptEnhance.state.phase !== "idle" ? (
          <div
            className="research-improve-status"
            data-phase={promptEnhance.state.phase}
          >
            <span className="research-improve-status__mark" aria-hidden>
              {promptEnhance.state.phase === "error"
                ? "!"
                : promptEnhance.state.phase === "applied"
                  ? "✓"
                  : "✦"}
            </span>
            <span
              className="research-improve-status__message"
              role={promptEnhance.state.phase === "error" ? "alert" : "status"}
            >
              {promptEnhance.state.phase === "loading"
                ? promptEnhance.state.preview || "The familiar is tightening scope, evidence, and output shape…"
                : promptEnhance.state.phase === "suggested"
                  ? `An improved version is ready${promptEnhance.state.offline ? " from the offline fallback" : ""}.`
                  : promptEnhance.state.phase === "applied"
                    ? `Prompt improved${promptEnhance.state.offline ? " with the offline fallback" : " by the familiar"}.`
                    : promptEnhance.state.message}
            </span>
            <span className="research-improve-status__actions">
              {promptEnhance.state.phase === "loading" ? (
                <button type="button" className="focus-ring" onClick={promptEnhance.cancel}>
                  Cancel
                </button>
              ) : promptEnhance.state.phase === "suggested" ? (
                <>
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => {
                      promptEnhance.apply();
                      focusIntent();
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => {
                      promptEnhance.dismiss();
                      focusIntent();
                    }}
                  >
                    Dismiss
                  </button>
                </>
              ) : promptEnhance.state.phase === "applied" ? (
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => {
                    promptEnhance.revert();
                    focusIntent();
                  }}
                >
                  Revert
                </button>
              ) : (
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => {
                    promptEnhance.dismiss();
                    focusIntent();
                  }}
                >
                  Dismiss
                </button>
              )}
            </span>
            {promptEnhance.state.phase === "suggested" ? (
              <span className="research-improve-status__preview" title={promptEnhance.state.enhanced}>
                {promptEnhance.state.enhanced}
              </span>
            ) : null}
            {promptEnhance.state.phase === "suggested" || promptEnhance.state.phase === "applied" ? (
              <details className="research-improve-status__why">
                <summary className="focus-ring">Why this?</summary>
                <p>{promptEnhance.state.recommendation.rationale}</p>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <ResearchPromptBuilder
        open={builderOpen}
        draft={intent}
        onClose={() => setBuilderOpen(false)}
        onApply={(prompt, filled) => {
          setIntent(prompt);
          setBuilderOpen(false);
          setBriefShown(true);
          setBriefNote(null);
          announce(`Structured prompt applied — ${filled} of ${RESEARCH_BRIEF_FIELDS.length} elements.`);
        }}
      />

      <div className="research-intake__modes">
        <div className="research-intake__modes-head">
          <h3>Research mode</h3>
          <span className="research-intake__modes-note">
            {manual
              ? `You chose ${MODE_LABELS[effectiveMode]} — this run will use it.`
              : `Auto selected ${MODE_LABELS[effectiveMode]} from the prompt.`}
          </span>
        </div>
        <div className="research-mode-picker">
          <StandardSelect<"auto" | ResearchMissionMode>
            label="Research mode"
            value={mode}
            onChange={setMode}
            className="research-mode-picker__select"
            popoverClassName="research-mode-picker__popover"
            options={[
              {
                value: "auto",
                label: `Auto · ${MODE_LABELS[effectiveMode]}`,
                detail: inferred.reason,
              },
              ...RESEARCH_MISSION_MODES.map((value) => ({
                value,
                label: MODE_LABELS[value],
                detail: `${MODE_DESCRIPTIONS[value]} ${modeCardMeta(value)}.`,
              })),
            ]}
          />
          <div className="research-mode-picker__summary" data-auto={!manual}>
            <span className="research-mode-picker__state">{manual ? "Selected" : "Auto pick"}</span>
            <strong>{MODE_LABELS[effectiveMode]}</strong>
            <span>{MODE_DESCRIPTIONS[effectiveMode]}</span>
            <code>{modeCardMeta(effectiveMode)}</code>
          </div>
        </div>
      </div>

      <div className="research-mission-composer__controls research-intake__bounds">
        {/* The whole plan in one quiet pill: mode + bounds. Press to review/edit. */}
        <button
          type="button"
          id="research-plan-review"
          className="research-plan-summary"
          title={mode === "auto" ? inferred.reason : "Selected manually"}
          aria-expanded={boundsOpen}
          aria-controls="research-bounds-editor"
          onClick={() => (boundsOpen ? setBoundsOpen(false) : focusBound("research-bound-minutes"))}
        >
          {MODE_LABELS[effectiveMode]} · {bounds.maxIterations} iteration{bounds.maxIterations === 1 ? "" : "s"} · {bounds.wallClockMinutes} min · {bounds.sourceTarget} sources · {HARNESS_LABELS[harness] ?? harness}{model.trim() ? ` (${model.trim()})` : ""}
        </button>
      </div>

      {boundsOpen ? (
        <div id="research-bounds-editor" className="research-bounds-grid">
          <label>
            <span>Minutes</span>
            <input
              id="research-bound-minutes"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.wallClockMinutes}
              value={boundValue("wallClockMinutes")}
              onChange={(event) => editBound("wallClockMinutes", event.target.value)}
              onBlur={() => commitBound("wallClockMinutes")}
              onKeyDown={boundKeyDown("wallClockMinutes")}
            />
          </label>
          <label>
            <span>Iterations</span>
            <input
              id="research-bound-iterations"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.maxIterations}
              value={boundValue("maxIterations")}
              onChange={(event) => editBound("maxIterations", event.target.value)}
              onBlur={() => commitBound("maxIterations")}
              onKeyDown={boundKeyDown("maxIterations")}
            />
          </label>
          <label>
            <span>Source target</span>
            <input
              id="research-bound-sources"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.sourceTarget}
              value={boundValue("sourceTarget")}
              onChange={(event) => editBound("sourceTarget", event.target.value)}
              onBlur={() => commitBound("sourceTarget")}
              onKeyDown={boundKeyDown("sourceTarget")}
            />
          </label>
          <label>
            <span>Checkpoint every</span>
            <input
              type="number"
              min={1}
              max={bounds.maxIterations}
              value={boundValue("checkpointEvery")}
              onChange={(event) => editBound("checkpointEvery", event.target.value)}
              onBlur={() => commitBound("checkpointEvery")}
              onKeyDown={boundKeyDown("checkpointEvery")}
            />
          </label>
          <label>
            <span>Runtime</span>
            <StandardSelect
              id="research-runtime-harness"
              label="Runtime"
              value={harness}
              className="research-bounds-select"
              onChange={(next) => {
                modelSelectionDirtyRef.current = true;
                setHarness(next);
                setModel("");
              }}
              options={RESEARCH_HARNESS_IDS.map((id) => ({
                value: id,
                label: HARNESS_LABELS[id] ?? id,
              }))}
            />
          </label>
          <label>
            <span>Model</span>
            <StandardSelect
              id="research-runtime-model"
              label={`Model · ${inventoryProvenanceLabel(
                runtimeModelInventory.provenance,
                runtimeModelInventory.loading,
              )}`}
              value={model}
              className="research-bounds-select"
              onChange={(next) => {
                modelSelectionDirtyRef.current = true;
                setModel(next);
              }}
              options={modelOptions}
            />
          </label>
        </div>
      ) : null}

      {!daemonRunning ? (
        <p className="research-runtime-note">
          The local daemon is offline. Travel mode may queue this mission; otherwise it will stay retryable.
        </p>
      ) : null}
      {error ? <p id="research-mission-error" className="research-mission-error" role="alert">{error}</p> : null}
    </form>
  );
}
