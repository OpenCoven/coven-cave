"use client";

/**
 * FamiliarRite — the image-first summoning rite (cave-3rz.3).
 *
 * Two columns: the card floats on the left, one question at a time on the
 * right. Deliberately NOT a form — the rules that keep it from becoming one:
 *
 *  · One question per screen, and PICKING ADVANCES. No Next button.
 *  · Choices are objects, not controls. No <select> anywhere.
 *  · The question is the label — never label + field + helper line.
 *  · Every pick visibly changes the card. A choice that doesn't belongs in
 *    Familiar Studio afterwards, not in the rite.
 *  · Everything after the image is skippable, so you can drop a likeness and
 *    summon immediately. A rite that requires four answers is a form in a robe.
 *
 * **The rite is sequenced around the scry.** The scry costs 12-18 s and it is
 * what fills the offices. While it is in flight the rite offers only the two
 * choices the scry never touches — the vessel and the mind — and holds the
 * office step until the likeness has actually been read. That removes the race
 * the `touched` ref used to paper over (it is kept below as belt-and-braces),
 * and turns the wait into work. The hold cannot deadlock: `src/lib/rite-flow.ts`
 * opens it on done, on failure, in manual mode, and on a ceiling — and the seal
 * stays reachable throughout, so nobody is trapped behind it.
 *
 * **Manual mode** is a first-class choice at step I, not a buried link: no scry
 * fires, every step is open at once, and nothing is pre-filled or badged
 * "scried". It is also where the rite lands when the endpoint reports
 * `no_local_vision_harness` — a machine with no local vision harness gets a
 * plain explanation and a working rite rather than an error banner.
 *
 * Built beside the existing Summoning Circle rather than inside it: that
 * component's stage machine is a hand-written 0|1|2|3 union pinned by a
 * source-text regex test, so extending it in place is worse than replacing it.
 *
 * **The rite does not replace the circle — it fronts it.** The circle still
 * owns three vessels this rite cannot express (an SSH host, an existing
 * OpenClaw agent, an existing Hermes profile), so `onSummonByHand` is a
 * first-class way out of the rite and into the circle rather than a dead end.
 * See `FamiliarRiteOverlay` below and the Summon entry point in
 * `familiars-view.tsx`.
 *
 * **No sessionStorage draft, deliberately.** The circle keeps one
 * (`src/lib/summoning-draft.ts`) because an accidental Escape unmounts it. The
 * rite's first and only required input is a `File`, which cannot be
 * serialized — the circle never persists its avatar either. Restoring the
 * answers WITHOUT the likeness would rebuild a rite that looks finished, shows
 * a blank card, and cannot summon; that is worse than starting over. So the
 * overlay defends the actual gesture instead: the backdrop never closes it, and
 * Escape asks before discarding a rite in progress.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FamiliarCardPreview } from "@/components/familiar-card-preview";
import { ScryGlitch } from "@/components/scry-glitch";
import { ScryPanel } from "@/components/scry-panel";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { setFamiliarOverride } from "@/lib/cave-familiar-overrides";
import { contextWindowForModel } from "@/lib/context-meter";
import { FAMILIAR_TYPES, type FamiliarTypeId } from "@/lib/familiar-types";
import { slugifyFamiliarId } from "@/lib/onboarding-familiars";
import {
  OFFICE_HOLD_CEILING_MS,
  officeStepHeld,
  shouldFallBackToManual,
} from "@/lib/rite-flow";
import { SCRY_DEFAULT_PRONOUNS } from "@/lib/scry";
import { useConjuredCard } from "@/lib/use-conjured-card";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useScry } from "@/lib/use-scry";
import { formatTokens } from "@/lib/usage-format";

import "@/styles/familiar-rite.css";

type StepKey = "likeness" | "vessel" | "mind" | "office" | "seal";

const STEPS: Array<{ key: StepKey; numeral: string; question: string; aside: string }> = [
  { key: "likeness", numeral: "I", question: "Show me its likeness", aside: "Paste or drop an image. Everything else follows from it." },
  { key: "vessel", numeral: "II", question: "Which vessel?", aside: "Where the familiar runs." },
  { key: "mind", numeral: "III", question: "How wide a mind?", aside: "Each stone is a model. Larger holds more at once." },
  { key: "office", numeral: "IV", question: "What office does it hold?", aside: "Each sigil opens a room. Take as many as fit." },
  { key: "seal", numeral: "V", question: "Strike the seal", aside: "The card becomes fixed." },
];

const OFFICE_STEP = STEPS.findIndex((s) => s.key === "office");
const SEAL_STEP = STEPS.length - 1;

/** Why the rite is being filled in by hand. Drives one line of explanation —
 *  the two reasons are not the same story and must not share wording. */
type ManualReason =
  /** The user took the skip at step I. */
  | "chosen"
  /** Nothing on this machine can look at an image; there was never a choice. */
  | "no-vision";

/** Vessels the rite offers. Marks are distinct per harness — the shipped circle
 *  gives every one the same terminal glyph, which tells you nothing. */
const VESSELS: Array<{ id: string; label: string; note: string; icon: IconName }> = [
  { id: "claude", label: "Claude Code", note: "Local. Reads files, sees images.", icon: "ph:brain-bold" },
  { id: "codex", label: "Codex", note: "Local. Reads files, sees images.", icon: "ph:code" },
  { id: "hermes", label: "Hermes", note: "Remote profiles cannot reach local files.", icon: "ph:globe" },
  { id: "opencode", label: "OpenCode", note: "Local.", icon: "ph:desktop" },
  { id: "grok", label: "Grok", note: "Local.", icon: "ph:robot" },
];

/** Model stones. Size is drawn from the REAL context window, so a bigger stone
 *  means it holds more — not that it is a better model. Models are not a
 *  ranking, and a card implying one leads people to pick the shiny option. */
const STONES = [
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.6-sol",
  "nous/hermes-4",
];

/** Where the seal points. The rite mints one before the familiar exists (from
 *  the typed name) and re-mints it on the real id the moment it does. */
const SEAL_ORIGIN = "https://opencoven.ai/f/";

/** Skipping the vessel has to land somewhere real. Same fallback the create
 *  route itself uses when no harness is supplied (`normalizeFamiliarDraft`). */
const FALLBACK_HARNESS = "codex";

/** `POST /api/familiars` REQUIRES a description — an empty one is a 400, not a
 *  blank field. The rite promises every step after the likeness is skippable,
 *  so the skip needs a defensible default rather than a validation error. */
const DEFAULT_DESCRIPTION = "A familiar summoned from a likeness.";

export type FamiliarRiteProps = {
  /** ids already in the roster — used to warn before the seal is struck. */
  existingIds?: string[];
  /** Global default harness, used when the vessel step is skipped. */
  defaultHarness?: string;
  /** Called with the new familiar's id once it exists. */
  onCreated?: (id: string) => void;
  /** When provided, the struck seal offers the first conversation. */
  onStartChat?: (id: string) => void;
  /** Leave the rite entirely. */
  onClose?: () => void;
  /**
   * Escape to the Summoning Circle. The rite offers five local harnesses; the
   * circle also binds an SSH host, an existing OpenClaw agent and an existing
   * Hermes profile. Without this the rite would be a dead end for all three.
   */
  onSummonByHand?: () => void;
  /** Reports whether abandoning the rite would lose work. */
  onDirtyChange?: (dirty: boolean) => void;
};

export function FamiliarRite({
  existingIds = [],
  defaultHarness,
  onCreated,
  onStartChat,
  onClose,
  onSummonByHand,
  onDirtyChange,
}: FamiliarRiteProps = {}) {
  const { announce } = useAnnouncer();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  // Never inferred from a face. The scry does not ask and does not parse it;
  // this is a default the user is expected to change, and the rite says so.
  const [pronouns, setPronouns] = useState(SCRY_DEFAULT_PRONOUNS);
  const [vessel, setVessel] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [types, setTypes] = useState<FamiliarTypeId[]>([]);
  const [dragging, setDragging] = useState(false);
  /** Null while the rite is still the default, scry-led path. */
  const [manualReason, setManualReason] = useState<ManualReason | null>(null);
  const manual = manualReason !== null;
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the familiar exists. The seal is struck against the REAL id. */
  const [summoned, setSummoned] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Which fields the user has taken over. A suggestion fills a field only while
  // it is still untouched — a scry that lands late must never overwrite typing.
  const touched = useRef<Record<"name" | "role" | "description" | "types", boolean>>({
    name: false, role: false, description: false, types: false,
  });

  const theme = useMemo(
    () => [name, ...types].filter(Boolean).join(" "),
    [name, types],
  );
  const conjure = useConjuredCard(file, theme);
  // Manual mode passes no file, so no request is ever made — and an in-flight
  // one is aborted the moment the rite turns manual. "No scry fires" is
  // enforced here, not by hiding the panel.
  const scry = useScry(manual ? null : file);
  const scried = scry.suggestions;

  /** The office step is held while the scry that fills it is still reading. */
  const officeHeld = officeStepHeld({ manual, status: scry.status, waitedTooLong });

  // Suggestions, not decisions: every one of these lands in an input the user
  // can overwrite, and none of it is stored anywhere until they strike the seal.
  useEffect(() => {
    if (!scried) return;
    if (scried.name && !touched.current.name) setName(scried.name);
    if (scried.role && !touched.current.role) setRole(scried.role);
    if (scried.description && !touched.current.description) setDescription(scried.description);
    if (scried.typeIds.length && !touched.current.types) setTypes(scried.typeIds);
    announce(
      `The scry suggests ${scried.name || "no name"}. Every field is editable.`,
    );
  }, [announce, scried]);

  /**
   * No local harness can look at an image. That is a property of the machine,
   * not a failure of this scry, so retrying is pointless and an error banner is
   * the wrong shape: the rite becomes a manual one and says why.
   */
  useEffect(() => {
    if (manual) return;
    if (!shouldFallBackToManual(scry.status, scry.errorCode)) return;
    setManualReason("no-vision");
    announce(
      "No local harness here can read an image, so the rite continues by hand. Every step is open and nothing is filled in.",
    );
  }, [announce, manual, scry.errorCode, scry.status]);

  /**
   * The hold's own release valve. `useScry` already guarantees a terminal
   * state, so this should never fire — which is exactly why it is here: a lock
   * whose release depends on another module's invariant is one that will
   * eventually not release.
   */
  useEffect(() => {
    if (scry.status !== "scrying") {
      setWaitedTooLong(false);
      return;
    }
    const timer = window.setTimeout(() => setWaitedTooLong(true), OFFICE_HOLD_CEILING_MS);
    return () => window.clearTimeout(timer);
  }, [scry.status]);

  // Announced rather than silently swapped: the offices arriving is the whole
  // reason the step was held, and the user is usually reading somewhere else.
  const wasHeld = useRef(false);
  useEffect(() => {
    if (wasHeld.current && !officeHeld) {
      announce("The likeness has been read. The offices are open.");
    }
    wasHeld.current = officeHeld;
  }, [announce, officeHeld]);

  // Read inside goTo, which must not be rebuilt on every scry frame.
  const heldRef = useRef(officeHeld);
  heldRef.current = officeHeld;

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(clamped);
    const waiting = clamped === OFFICE_STEP && heldRef.current
      ? " The likeness is still being read; these arrive with it."
      : "";
    announce(`Rite ${STEPS[clamped].numeral}. ${STEPS[clamped].question}${waiting}`);
  }, [announce]);

  /** Picking advances. This is the single rule that keeps it from reading as a
   *  form — no Next button anywhere except the deliberately-slow final seal. */
  const pickAndAdvance = useCallback((fn: () => void) => {
    fn();
    window.setTimeout(() => goTo(stepRef.current + 1), 260);
  }, [goTo]);
  const stepRef = useRef(step);
  stepRef.current = step;

  const takeFile = useCallback((f: File | null) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFile(f);
    if (!name) setName(suggestName(f.name));
    window.setTimeout(() => goTo(1), 420);
  }, [goTo, name]);

  /** The skip at step I: a rite with no scry at all. Offered beside the drop
   *  well as its own choice, because "I'll do this myself" is a decision, not a
   *  fallback — but the scry stays the default path and the larger target. */
  const chooseManual = useCallback(() => {
    setManualReason("chosen");
    announce("A manual rite. Nothing is read from a likeness; every step is open.");
    goTo(1);
  }, [announce, goTo]);

  /** Only ever offered for a manual mode the user chose — a machine with no
   *  vision harness has nothing to go back to. */
  const resumeScry = useCallback(() => {
    setManualReason(null);
    announce("The scry is on again. A likeness will be read when one is dropped.");
  }, [announce]);

  // Paste support. A likeness usually lives on the clipboard, not on disk, and
  // making people save it to a file first is the most form-like step of all.
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const item = [...(ev.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (!item) return;
      ev.preventDefault();
      takeFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeFile]);

  // Arrows walk the rite — but NOT while a caret is in a field. Left/right are
  // how you fix a typo, and the seal step is three text inputs: without this
  // guard, correcting a name throws you back to the model step and takes the
  // field with it. (Found by driving the real rite; `fill()` never reveals it,
  // which is why no test caught it first.)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        /^(input|textarea|select)$/i.test(target?.tagName ?? "")
      ) {
        return;
      }
      if (ev.key === "ArrowRight") goTo(step + 1);
      else if (ev.key === "ArrowLeft") goTo(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, step]);

  const current = STEPS[step];
  // A held step must not describe choices it is not offering yet.
  const asideLine = current.key === "office" && officeHeld
    ? "They arrive with the scry, which is still reading the likeness."
    : current.aside;
  const roleLabel = types.length
    ? FAMILIAR_TYPES.find((t) => t.id === types[0])?.label ?? ""
    : "";

  const trimmedName = name.trim();
  const derivedId = slugifyFamiliarId(trimmedName);
  const duplicate = derivedId.length > 0 && existingIds.some((id) => id.toLowerCase() === derivedId);
  const canSummon = Boolean(trimmedName) && Boolean(file) && !duplicate && !submitting && !summoned;

  // Leaving costs something the moment any of this exists. The overlay uses it
  // to ask before discarding; a struck seal costs nothing, so it is not dirty.
  const dirty =
    summoned === null &&
    (file !== null || trimmedName !== "" || vessel !== null || model !== null || types.length > 0);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /**
   * Strike the seal — the one write in the whole rite.
   *
   * Shaped after the Summoning Circle's `handleSummon`, deliberately and
   * step for step: create, then adorn. The avatar upload and the override write
   * are BEST-EFFORT on purpose — the familiar already exists by then, so a
   * failed portrait or a failed aura must never undo a successful summoning.
   */
  async function handleSummon() {
    if (!canSummon || !file) return;
    setSubmitting(true);
    setError(null);
    const harness = vessel ?? defaultHarness ?? FALLBACK_HARNESS;
    const officeGlyph = types.length
      ? FAMILIAR_TYPES.find((t) => t.id === types[0])?.iconName
      : undefined;
    try {
      const res = await fetch("/api/familiars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: derivedId,
            displayName: trimmedName,
            glyph: officeGlyph ?? "ph:sparkle-fill",
            description: description.trim() || DEFAULT_DESCRIPTION,
            ...(role.trim() ? { role: role.trim() } : {}),
            harness,
            ...(model ? { model } : {}),
            runtime: { kind: "local" },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Could not summon the familiar (HTTP ${res.status}).`);
      }
      const newId = json.id ?? derivedId;
      // Best-effort adornments: the familiar already exists, so a failed
      // avatar upload or override write must not undo the summoning.
      try {
        await fetch(`/api/familiars/${encodeURIComponent(newId)}/avatar`, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
      } catch {
        /* non-blocking */
      }
      try {
        setFamiliarOverride(newId, {
          ...(conjure.aura ? { color: conjure.aura } : {}),
          ...(types.length ? { familiarType: types.join(",") } : {}),
          ...(role.trim() ? { role: role.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(pronouns.trim() ? { pronouns: pronouns.trim() } : {}),
        });
      } catch {
        /* non-blocking */
      }
      setSummoned({ id: newId, name: trimmedName });
      setSubmitting(false);
      window.dispatchEvent(new Event("cave:familiars-refresh"));
      onCreated?.(newId);
      announce(`${trimmedName} has answered the summons.`, "polite");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not summon the familiar.";
      setError(msg);
      announce(msg, "assertive");
      setSubmitting(false);
    }
  }

  return (
    <div className="rite">
      {/* The likeness comes apart while it is being read: the card's own pixels
          tear on the left and travel to the slots on the right as shards. It
          draws across BOTH columns, so it hangs off the grid root rather than
          either column, and it never intercepts a pointer.

          `quietSelector` is what keeps the card readable — those rects are
          punched out of the canvas clip every frame, so the name and the stat
          plate cannot be torn no matter how hard the rest of it is glitching.
          Reduced motion is handled inside: the canvas simply never starts. */}
      <ScryGlitch
        status={scry.status}
        stage={scry.stage}
        source={conjure.glitch}
        artSelector=".rite .famcard__art"
        quietSelector=".rite .famcard__head, .rite .famcard__plate"
        targetSelector=".rite [data-scry-slot]"
      />
      <div className="rite__stage">
        {/* The card floats. Incompleteness shows HERE — no frame, dead foil —
            rather than as validation text or a disabled button. */}
        <FamiliarCardPreview
          name={name}
          role={role || roleLabel}
          description={description}
          harness={vessel}
          vesselLabel={VESSELS.find((v) => v.id === vessel)?.label}
          model={model}
          typeIds={types}
          artUrl={conjure.artUrl}
          plateUrl={conjure.plateUrl}
          aura={conjure.aura}
          /* Before the summoning the seal can only encode a guess at the id;
             the moment the familiar exists it encodes the id the daemon
             actually gave it, which is the only mark that resolves. */
          sealUrl={
            summoned
              ? `${SEAL_ORIGIN}${summoned.id}`
              : step === SEAL_STEP && name
                ? `${SEAL_ORIGIN}${slug(name)}`
                : null
          }
          scrying={scry.status === "scrying"}
          sealed={summoned !== null}
        />
        {conjure.note ? <p className="rite__telemetry">{conjure.note}</p> : null}
      </div>

      <div className="rite__ask">
        <ol className="rite__track" aria-label="Rite progress">
          {STEPS.map((s, i) => {
            // A held bead is still navigable — the step explains itself when you
            // get there, which is far better than a dead control that doesn't.
            const held = i === OFFICE_STEP && officeHeld;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className={`rite__bead focus-ring${i === step ? " rite__bead--now" : ""}${i < step ? " rite__bead--done" : ""}${held ? " rite__bead--held" : ""}`}
                  onClick={() => goTo(i)}
                  aria-current={i === step}
                  aria-label={`Rite ${s.numeral}. ${s.question}${held ? " Waiting on the scry." : ""}`}
                >
                  {s.numeral}
                </button>
              </li>
            );
          })}
        </ol>

        <h2 className="rite__question">{current.question}</h2>
        <p className="rite__aside">{asideLine}</p>

        {current.key === "likeness" ? (
          /* Two paths, side by side. The scry is the default and keeps the
             larger target; the manual rite sits beside it as its own choice
             rather than as a link hidden under the well, because "I'll fill
             this in myself" is a decision about how the rite runs. */
          <div className="rite__paths">
            <div
              className={`rite__well${dragging ? " rite__well--live" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files?.[0] ?? null); }}
            >
              <Icon name="ph:image-bold" width={28} height={28} aria-hidden />
              <p className="rite__well-line">Drop it here, or press <kbd>⌘V</kbd></p>
              <Button variant="secondary" size="sm" leadingIcon="ph:camera" onClick={() => inputRef.current?.click()}>
                Choose a file
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="rite__file"
                onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {manual ? null : (
              <button type="button" className="rite__path focus-ring" onClick={chooseManual}>
                <Icon name="ph:pen-nib-bold" width={22} height={22} aria-hidden />
                <span className="rite__path-label">Summon without a scry</span>
                <span className="rite__path-note">
                  No likeness is read. Every step opens at once and nothing is
                  guessed for you.
                </span>
              </button>
            )}
          </div>
        ) : null}

        {/* A manual rite says so on every step — otherwise the absence of the
            scry panel is the only signal, and an absence explains nothing. It
            stops once the seal is struck: how the rite was filled in is no
            longer a mode anyone is in. */}
        {manual && !summoned ? (
          <p className="rite__manual">
            <span className="rite__manual-line">
              {manualReason === "no-vision"
                ? "No local harness here can look at an image — scrying needs a local runtime such as Codex or Claude Code. The rite carries on by hand: every step is open, and nothing has been filled in."
                : "A manual rite. Nothing is read from a likeness, so every step is open and nothing is filled in."}
            </span>
            {manualReason === "chosen" ? (
              <Button variant="ghost" size="xs" onClick={resumeScry}>Use the scry after all</Button>
            ) : null}
          </p>
        ) : null}

        {/* The scry runs in the background from the moment the image lands. It
            no longer races the office step — that step is held until this lands
            (see rite-flow) — but it is still never a gate: the vessel and the
            mind are open throughout, the seal is reachable, and a scry that
            fails costs nothing but empty fields. The panel stays put across
            every step so the four slots are visible from the drop onward — the
            point is seeing WHAT is being extracted before any of it arrives. */}
        {scry.status !== "idle" ? <ScryPanel scry={scry} /> : null}

        {current.key === "vessel" ? (
          <div className="rite__tiles" role="radiogroup" aria-label="Vessel">
            {VESSELS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={vessel === v.id}
                className={`rite__tile focus-ring${vessel === v.id ? " rite__tile--on" : ""}`}
                onClick={() => pickAndAdvance(() => setVessel(v.id))}
              >
                <Icon name={v.icon} width={20} height={20} aria-hidden />
                <span className="rite__tile-label">{v.label}</span>
                <span className="rite__tile-note">{v.note}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* The escape hatch, offered exactly where the gap is discovered. The
            rite binds five local harnesses; an SSH host, an existing OpenClaw
            agent and an existing Hermes profile are still the circle's, so
            "none of these" has to lead somewhere rather than stop. */}
        {current.key === "vessel" && onSummonByHand ? (
          <button type="button" className="rite__path rite__path--aside focus-ring" onClick={onSummonByHand}>
            <Icon name="ph:compass" width={22} height={22} aria-hidden />
            <span className="rite__path-label">None of these — summon by hand</span>
            <span className="rite__path-note">
              A remote host over SSH, an OpenClaw agent you already run, or a
              Hermes profile. The summoning circle binds all three; this rite
              does not.
            </span>
          </button>
        ) : null}

        {current.key === "mind" ? (
          <div className="rite__stones" role="radiogroup" aria-label="Model">
            {STONES.map((id) => {
              const ctx = contextWindowForModel(id);
              // Cube-root so a 1M window is visibly larger than 128K without
              // being eight times the size — area should read, not dominate.
              const scale = 0.52 + Math.cbrt(ctx.tokens / 1_000_000) * 0.48;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={model === id}
                  className={`rite__stone focus-ring${model === id ? " rite__stone--on" : ""}`}
                  onClick={() => pickAndAdvance(() => setModel(id))}
                  aria-label={`${id}, ${formatTokens(ctx.tokens) ?? ctx.tokens} context`}
                >
                  <span className="rite__crystal" style={{ "--stone-scale": scale.toFixed(2) } as React.CSSProperties}>
                    <svg viewBox="0 0 40 56" aria-hidden focusable="false">
                      <polygon points="20,1 38,17 30,54 10,54 2,17" />
                      <polygon points="20,1 30,54 20,44 10,54" className="rite__crystal-facet" />
                    </svg>
                  </span>
                  <span className="rite__stone-ctx">{formatTokens(ctx.tokens) ?? ctx.tokens}</span>
                  <span className="rite__stone-id">{id.split("/")[1]}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Held, not disabled. The sigils are the one thing the scry writes, so
            offering them mid-flight is offering a choice about to be overruled.
            What the user gets instead is the reason, the two choices the scry
            never touches, and a way through to the seal — never a dead end. */}
        {current.key === "office" && officeHeld ? (
          <div className="rite__held">
            <span className="rite__held-mark" aria-hidden>
              <Icon name="ph:hourglass" width={20} height={20} />
            </span>
            <p className="rite__held-line">The likeness is still being read.</p>
            <p className="rite__held-note">
              {scry.harnessLabel ? `${scry.harnessLabel} is looking at it now, and the` : "The"} offices
              arrive with what it finds — so they are not yours to pick yet. The vessel and the
              mind are: the scry never touches either.
            </p>
            <div className="rite__held-outs">
              <Button variant="secondary" size="sm" onClick={() => goTo(1)}>
                Choose the vessel meanwhile
              </Button>
              <Button variant="ghost" size="sm" onClick={() => goTo(SEAL_STEP)}>
                Skip to the seal
              </Button>
            </div>
          </div>
        ) : null}

        {current.key === "office" && !officeHeld ? (
          <>
            <div className="rite__sigils" role="group" aria-label="Offices">
              {FAMILIAR_TYPES.filter((t) => t.id !== "general").map((t) => {
                const on = types.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`rite__sigil focus-ring${on ? " rite__sigil--on" : ""}`}
                    onClick={() => {
                      touched.current.types = true;
                      setTypes((prev) => on ? prev.filter((x) => x !== t.id) : [...prev, t.id]);
                    }}
                  >
                    <Icon name={t.iconName} width={22} height={22} aria-hidden />
                    <span className="rite__sigil-label">
                      {t.label}
                      {/* A pre-selected sigil says why it is on, so a guess is
                          never mistaken for a decision the user made. */}
                      {on && !touched.current.types && scried?.typeIds.includes(t.id) ? (
                        <span className="rite__guess">scried</span>
                      ) : null}
                    </span>
                    <span className="rite__sigil-note">{t.description.split(" — ")[0]}</span>
                  </button>
                );
              })}
            </div>
            {/* Multi-select is the one place picking cannot advance, so this is
                the only forward control in the rite before the seal. */}
            <Button variant="secondary" size="sm" onClick={() => goTo(step + 1)}>
              {types.length ? "That's the office" : "No office for now"}
            </Button>
          </>
        ) : null}

        {current.key === "seal" && summoned ? (
          /* Struck. Nothing here is editable any more — the card carries the
             real mark now, and everything else moves to Familiar Studio. */
          <div className="rite__struck">
            <p className="rite__struck-line">{summoned.name} has answered the summons.</p>
            <p className="rite__aside">
              The seal is struck and does not lift. Its mark carries the
              familiar&rsquo;s true name, <code className="rite__id">{summoned.id}</code>. Everything
              after this is edited in Familiar Studio.
            </p>
            <div className="rite__struck-outs">
              {onStartChat ? (
                /* Leaves with you, exactly as the circle's success stage does —
                   an overlay left standing over the chat it just opened is the
                   obvious way to get this wrong. */
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => {
                    onStartChat(summoned.id);
                    onClose?.();
                  }}
                >
                  Begin the first conversation
                </Button>
              ) : null}
              {onClose ? (
                <Button variant="secondary" size="md" onClick={onClose}>
                  Back to the familiars
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {current.key === "seal" && !summoned ? (
          <div className="rite__seal">
            <label className="rite__name">
              <span className="rite__name-hint">It answers to</span>
              <input
                className="rite__name-input"
                value={name}
                onChange={(e) => { touched.current.name = true; setName(e.target.value); }}
                placeholder="give it a name"
                aria-label="Familiar name"
              />
            </label>

            {/* Everything the scry offered, as fields — pre-filled, plainly
                overwritable, and never committed on the user's behalf. */}
            <div className="rite__guesses">
              <label className="rite__field">
                <span className="rite__field-hint">Office</span>
                <input
                  className="rite__field-input"
                  value={role}
                  onChange={(e) => { touched.current.role = true; setRole(e.target.value); }}
                  placeholder={roleLabel || "what it does"}
                  aria-label="Familiar role"
                />
              </label>
              <label className="rite__field">
                <span className="rite__field-hint">In a line</span>
                <input
                  className="rite__field-input"
                  value={description}
                  onChange={(e) => { touched.current.description = true; setDescription(e.target.value); }}
                  placeholder="what it is"
                  aria-label="Familiar description"
                />
              </label>
              <label className="rite__field">
                <span className="rite__field-hint">Pronouns</span>
                <input
                  className="rite__field-input"
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                  aria-label="Familiar pronouns"
                  aria-describedby="rite-pronouns-note"
                />
              </label>
              {/* Deliberate: an image is not evidence of anyone's pronouns, so
                  the scry never guesses them and the default says so out loud. */}
              <p className="rite__note" id="rite-pronouns-note">
                A default, not a reading — nothing about pronouns is taken from the image.
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              disabled={!canSummon}
              loading={submitting}
              onClick={() => void handleSummon()}
            >
              {submitting ? `Summoning ${trimmedName || "it"}…` : `Summon ${trimmedName || "it"}`}
            </Button>
            <p className="rite__aside">
              {!file
                ? "It needs a likeness first."
                : !trimmedName
                  ? "It needs a name."
                  : duplicate
                    ? `A familiar already answers to "${derivedId}". Give this one another name.`
                    : "The seal is struck once and does not lift."}
            </p>
            {error ? (
              <p className="rite__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The rite as the app's Summon surface.
 *
 * Mirrors the Summoning Circle's overlay (portal + focus trap) so both rituals
 * feel like the same kind of thing, with one deliberate difference: **the
 * backdrop does not close it.** The rite holds a dropped `File` that no draft
 * can restore (see the module note), so a stray click outside must not be able
 * to throw it away. Escape still works — it asks first.
 */
export function FamiliarRiteOverlay({
  open,
  onClose,
  ...rest
}: FamiliarRiteProps & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <RiteOverlay onClose={onClose} {...rest} />;
}

// Mounted only while open — state resets by unmounting, not by a reset().
function RiteOverlay({ onClose, ...rest }: FamiliarRiteProps & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const stayRef = useRef<HTMLButtonElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (confirming) stayRef.current?.focus();
  }, [confirming]);

  const requestClose = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirming(true);
  }, [dirty, onClose]);

  useFocusTrap(true, dialogRef, { onEscape: requestClose });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="rite-backdrop" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Summoning rite"
        tabIndex={-1}
        className="rite-dialog"
      >
        <header className="rite-chrome">
          <div className="rite-chrome__crumb">
            <span>Familiars</span>
            <span aria-hidden className="rite-chrome__sep">
              ›
            </span>
            <strong>Summoning rite</strong>
          </div>
          <div className="rite-chrome__acts">
            {rest.onSummonByHand ? (
              <Button variant="ghost" size="xs" leadingIcon="ph:compass" onClick={rest.onSummonByHand}>
                Summon by hand
              </Button>
            ) : null}
            <button
              type="button"
              onClick={requestClose}
              aria-label="Leave the summoning rite"
              className="focus-ring rite-chrome__close"
            >
              <Icon name="ph:x" width={14} height={14} aria-hidden />
            </button>
          </div>
        </header>

        {/* The rite cannot be restored from storage, so leaving is the one
            irreversible thing that is not the seal. It says so rather than
            silently discarding a likeness the user cannot get back with an
            undo. */}
        {confirming ? (
          <div className="rite-leave" role="alertdialog" aria-label="Leave the rite?">
            <p className="rite-leave__line">Leave the rite?</p>
            <p className="rite-leave__note">
              Nothing here is kept. The likeness in particular cannot be saved
              for later, so the rite starts from the drop again.
            </p>
            <div className="rite-leave__acts">
              {/* Focus lands on STAYING. The question was raised by a keystroke
                  the user may have hit by accident, so the safe answer is the
                  one already under their hands. */}
              <Button ref={stayRef} variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                Stay in the rite
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Leave and discard
              </Button>
            </div>
          </div>
        ) : null}

        <div className="rite-dialog__body">
          <FamiliarRite {...rest} onClose={onClose} onDirtyChange={setDirty} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A first guess at a name from the filename, so the field is never empty. */
function suggestName(filename: string): string {
  const stem = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  const word = stem.split(/\s+/).find((w) => /^[a-z]{3,}$/i.test(w));
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : "";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "familiar";
}
