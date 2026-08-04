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
 * Built beside the existing Summoning Circle rather than inside it: that
 * component's stage machine is a hand-written 0|1|2|3 union pinned by a
 * source-text regex test, so extending it in place is worse than replacing it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FamiliarCardPreview } from "@/components/familiar-card-preview";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { contextWindowForModel } from "@/lib/context-meter";
import { FAMILIAR_TYPES, type FamiliarTypeId } from "@/lib/familiar-types";
import { SCRY_DEFAULT_PRONOUNS } from "@/lib/scry";
import { useConjuredCard } from "@/lib/use-conjured-card";
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

export function FamiliarRite() {
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
  const scry = useScry(file);
  const scried = scry.suggestions;

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

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(clamped);
    announce(`Rite ${STEPS[clamped].numeral}. ${STEPS[clamped].question}`);
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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight") goTo(step + 1);
      else if (ev.key === "ArrowLeft") goTo(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, step]);

  const current = STEPS[step];
  const roleLabel = types.length
    ? FAMILIAR_TYPES.find((t) => t.id === types[0])?.label ?? ""
    : "";
  const scryLine =
    scry.status === "scrying"
      ? "Scrying the likeness…"
      : scry.status === "done"
        ? `${scry.harnessLabel ?? "The scry"} looked. Everything it guessed is editable.`
        : scry.status === "failed"
          ? `${scry.error ?? "The scry did not come back."} Fill the fields in yourself.`
          : null;

  return (
    <div className="rite">
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
          sealUrl={step === STEPS.length - 1 && name ? `https://opencoven.ai/f/${slug(name)}` : null}
        />
        {conjure.note ? <p className="rite__telemetry">{conjure.note}</p> : null}
      </div>

      <div className="rite__ask">
        <ol className="rite__track" aria-label="Rite progress">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className={`rite__bead focus-ring${i === step ? " rite__bead--now" : ""}${i < step ? " rite__bead--done" : ""}`}
                onClick={() => goTo(i)}
                aria-current={i === step}
                aria-label={`Rite ${s.numeral}. ${s.question}`}
              >
                {s.numeral}
              </button>
            </li>
          ))}
        </ol>

        <h2 className="rite__question">{current.question}</h2>
        <p className="rite__aside">{current.aside}</p>

        {current.key === "likeness" ? (
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
        ) : null}

        {/* The scry runs in the background from the moment the image lands, and
            is never a gate: the rite advances without waiting, and a scry that
            fails costs nothing but empty fields. */}
        {scryLine ? <p className="rite__scry">{scryLine}</p> : null}

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

        {current.key === "office" ? (
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

        {current.key === "seal" ? (
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

            <Button variant="primary" size="lg" disabled={!name || !file}>
              Summon {name || "it"}
            </Button>
            <p className="rite__aside">
              {!file ? "It needs a likeness first." : !name ? "It needs a name." : "The seal is struck once and does not lift."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
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
