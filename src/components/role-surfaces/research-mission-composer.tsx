"use client";

/**
 * Research intake engine — the "New research" composer (cave-dl74, Phase B1).
 *
 * The design's prompt card: a large intent textarea with a slash-command
 * palette, "✦ Improve" (POST /api/prompt/enhance), suggested-angle chips
 * derived from REAL mission/link titles, attached quick-save chips, four mode
 * cards backed by the shared auto-routing inference, and the original
 * collapsible bounds editor (the plan keeps bounds review even though the
 * design omits it). Validation is unchanged: the shared
 * RESEARCH_INTENT_MIN_LENGTH gate, aria-invalid wiring, and the honest
 * daemon-offline note all carry over from the pre-redesign composer.
 *
 * Slash commands map to real actions only: /brief /sweep /paper /deep set the
 * mode (deep = autoresearch, shown as "Deep loop"), /improve runs Improve,
 * /suggest rotates the angle chips (only offered when real seeds exist), and
 * /save jumps to the Resources tab. The design's /task, /find and /chat are
 * omitted here: there is no board-create wiring from the intake, /find belongs
 * to the Desk's runs rail, and a prompt that has not started yet has no
 * session for /chat to open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { settleEnhance } from "@/lib/prompt-enhancer";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "@/lib/research-mission-routing";
import {
  RESEARCH_BOUND_LIMITS,
  RESEARCH_INTENT_MIN_LENGTH,
  RESEARCH_MISSION_MODES,
  type CreateResearchMissionInput,
  type ResearchBounds,
  type ResearchMission,
  type ResearchMissionMode,
} from "@/lib/research-missions";

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
};

const MODE_LABELS: Record<ResearchMissionMode, string> = {
  brief: "Brief",
  sweep: "Sweep",
  paper: "Paper",
  autoresearch: "Deep loop",
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
  // Dirty latch: once a bound is hand-edited, auto-routing (which re-derives
  // the plan on every keystroke) must stop clobbering it. Explicit mode picks
  // clear the latch below, so a deliberate switch still resets.
  const boundsDirtyRef = useRef(false);
  const [boundsOpen, setBoundsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuCursor, setMenuCursor] = useState(0);
  const [improving, setImproving] = useState(false);
  const [improveNote, setImproveNote] = useState<string | null>(null);
  const [angleOffset, setAngleOffset] = useState(0);

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

  const inferred = useMemo(() => inferResearchMissionMode(intent), [intent]);
  const effectiveMode = mode === "auto" ? inferred.mode : mode;
  const plan = useMemo(() => defaultResearchPlan(effectiveMode), [effectiveMode]);
  const trimmedIntent = intent.trim();
  const intentTooShort = trimmedIntent.length > 0 && trimmedIntent.length < RESEARCH_INTENT_MIN_LENGTH;

  // The enhance race rule: only overwrite the draft the rewrite was asked for.
  const intentRef = useRef(intent);
  intentRef.current = intent;

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

  // ── ✦ Improve: POST /api/prompt/enhance (research mode), replace on apply.
  const improveReady = trimmedIntent.length >= 3;
  const improve = async (draft: string) => {
    if (draft.trim().length < 3 || improving) return;
    setImproving(true);
    setImproveNote(null);
    try {
      const res = await fetch("/api/prompt/enhance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft, mode: "research" }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        enhanced?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok || !data.enhanced) {
        setImproveNote(data?.error ?? `Improve failed (HTTP ${res.status}) — the draft is unchanged.`);
        return;
      }
      if (settleEnhance(draft, intentRef.current) === "apply") {
        setIntent(data.enhanced);
        announce("Draft improved.");
      } else {
        setImproveNote("The draft changed while improving — kept your edits.");
      }
    } catch {
      setImproveNote("Improve is unreachable right now — the draft is unchanged.");
    } finally {
      setImproving(false);
    }
  };

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
      void improve(stripped);
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

  return (
    <form className="research-mission-composer research-intake__form" onSubmit={start}>
      <div className="research-intake__card">
        <div className="research-mission-composer__prompt research-intake__prompt">
          <label htmlFor="research-intent" className="sr-only">What should we investigate?</label>
          <textarea
            id="research-intent"
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
        </div>

        {attachedLinks.length > 0 ? (
          <div className="research-intake__attached" role="group" aria-label="Related context">
            <span className="research-intake__attached-label">Related context ({attachedLinks.length}):</span>
            {attachedLinks.map((link) => (
              <span key={link.id} className="research-intake__attached-chip">
                {link.title}
                <button
                  type="button"
                  className="research-intake__attached-remove"
                  aria-label={`Remove ${link.title} from related context`}
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
                title="Fill the prompt with a detailed brief"
                onClick={() => setIntent(chip.brief)}
              >
                {chip.title}
              </button>
            ))}
          </div>
        )}

        <div className="research-intake__footer">
          <button
            type="button"
            className="research-improve"
            disabled={!improveReady || improving}
            onClick={() => void improve(intent)}
          >
            {improving ? "✦ Improving…" : "✦ Improve"}
          </button>
          {angleSeeds.length > 0 ? (
            <button type="button" className="research-suggest" onClick={suggestAngles}>
              Suggest angles
            </button>
          ) : null}
          <p className="research-improve-note" role="status">
            {improving ? "Rewriting the draft for scope and rigor…" : improveNote}
          </p>
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
      </div>

      <div className="research-intake__modes">
        <div className="research-intake__modes-head">
          <h3>Modes</h3>
          <span className="research-intake__modes-note">
            {manual
              ? `You chose ${MODE_LABELS[effectiveMode]} — this run will use it.`
              : `Auto picks one from your prompt — ${MODE_LABELS[effectiveMode]} for now. Click a card to override.`}
          </span>
          {manual ? (
            <button type="button" className="research-intake__modes-reset" onClick={() => setMode("auto")}>
              Reset to Auto
            </button>
          ) : null}
        </div>
        <div className="research-intake__modes-grid">
          {RESEARCH_MISSION_MODES.map((value) => {
            const selected = value === effectiveMode;
            return (
              <button
                key={value}
                type="button"
                className="research-mode-card"
                data-selected={selected}
                aria-pressed={manual && selected}
                onClick={() => setMode(value)}
              >
                <span className="research-mode-card__head">
                  <span className="research-mode-card__name">{MODE_LABELS[value]}</span>
                  {selected ? (
                    <span className="research-mode-card__badge">{manual ? "✓ selected" : "auto pick"}</span>
                  ) : null}
                </span>
                <span className="research-mode-card__desc">{MODE_DESCRIPTIONS[value]}</span>
                <span className="research-mode-card__meta">{modeCardMeta(value)}</span>
              </button>
            );
          })}
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
          {MODE_LABELS[effectiveMode]} · {bounds.maxIterations} iteration{bounds.maxIterations === 1 ? "" : "s"} · {bounds.wallClockMinutes} min · {bounds.sourceTarget} sources
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
