"use client";

/**
 * The likeness rite — scry a familiar out of a picture.
 *
 * Drop, paste, or pick an image and a local runtime reads it, proposing the
 * name, office, purpose, description, sigil, and aura. Every value arrives as
 * an **editable suggestion**: this panel writes into the same inputs the rite
 * already renders, so nothing it proposes is committed, and the person can
 * overwrite any of it before summoning.
 *
 * The likeness itself becomes the portrait, through the existing avatar upload
 * the rite already performs — a scry adds no second path for image bytes to
 * reach a familiar.
 */

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  isScryLikenessMime,
  SCRY_LIKENESS_ACCEPT,
  SCRY_MAX_LIKENESS_BYTES,
  type ScryReading,
} from "@/lib/scry";

export type LikenessRiteProps = {
  /** The runtime the vessel rite already chose. Disabled when it cannot scry. */
  harness: string | null;
  /** Whether that runtime is one the server will accept for a scry. */
  canScry: boolean;
  /** Applied when a reading comes back. The caller owns every field it touches. */
  onReading: (reading: ScryReading, likeness: File) => void;
};

type RiteState =
  | { kind: "idle" }
  | { kind: "scrying" }
  | { kind: "read"; pronounsFlagged: true }
  | { kind: "failed"; message: string };

export function FamiliarLikenessRite({ harness, canScry, onReading }: LikenessRiteProps) {
  const { announce } = useAnnouncer();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<RiteState>({ kind: "idle" });
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);

  const scry = useCallback(
    async (file: File) => {
      if (!harness || !canScry) return;
      // The client check is a courtesy that saves an upload; the route repeats
      // every one of these against the bytes it actually receives.
      if (!isScryLikenessMime(file.type)) {
        setState({ kind: "failed", message: "That file is not a PNG, JPEG, or WebP image." });
        return;
      }
      if (file.size > SCRY_MAX_LIKENESS_BYTES) {
        setState({ kind: "failed", message: "That image is too large to scry." });
        return;
      }
      setState({ kind: "scrying" });
      announce("Scrying the likeness.", "polite");
      try {
        const res = await fetch(`/api/scry?harness=${encodeURIComponent(harness)}`, {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          reading?: ScryReading;
          error?: string;
        };
        if (!res.ok || !json.ok || !json.reading) {
          throw new Error(json.error ?? `The scry failed (HTTP ${res.status}).`);
        }
        onReading(json.reading, file);
        setState({ kind: "read", pronounsFlagged: true });
        announce(
          "The likeness was read. Every field is a suggestion you can edit.",
          "polite",
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The scry failed.";
        setState({ kind: "failed", message });
        announce(message, "assertive");
      }
    },
    [announce, canScry, harness, onReading],
  );

  const takeFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void scry(file);
    },
    [scry],
  );

  const disabled = !canScry || state.kind === "scrying";

  return (
    <div>
      <span className="likeness-rite__label" id="summon-likeness-label">
        Scry a likeness <span className="likeness-rite__optional">(optional)</span>
      </span>
      <div
        role="group"
        aria-labelledby="summon-likeness-label"
        className={`likeness-rite${dropActive ? " likeness-rite--drop" : ""}${
          disabled ? " likeness-rite--disabled" : ""
        }`}
        onDragEnter={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDropActive(true);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDropActive(false);
        }}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDropActive(false);
          takeFiles(event.dataTransfer?.files ?? null);
        }}
        onPaste={(event) => {
          if (disabled) return;
          const item = Array.from(event.clipboardData?.items ?? []).find(
            (candidate) => candidate.kind === "file",
          );
          const file = item?.getAsFile();
          if (file) {
            event.preventDefault();
            void scry(file);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={SCRY_LIKENESS_ACCEPT}
          className="hidden"
          onChange={(event) => {
            takeFiles(event.target.files);
            // Allow re-picking the same file after a failure.
            event.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="ph:image"
          disabled={disabled}
          loading={state.kind === "scrying"}
          onClick={() => inputRef.current?.click()}
        >
          {state.kind === "scrying" ? "Scrying…" : "Choose a likeness"}
        </Button>
        <p className="likeness-rite__hint">
          {canScry
            ? "Drop or paste an image here and the runtime proposes a familiar from it."
            : "Choose a local runtime in the vessel rite to scry a likeness."}
        </p>
      </div>

      {state.kind === "read" ? (
        <p className="likeness-rite__note" role="status">
          <Icon name="ph:sparkle" width={12} />
          Read from the likeness — every field below is a suggestion. Pronouns
          were not inferred and stay <strong>they/them</strong> until you say
          otherwise.
        </p>
      ) : null}

      {state.kind === "failed" ? (
        <p className="likeness-rite__note likeness-rite__note--fail" role="alert">
          <Icon name="ph:warning-circle" width={12} />
          {state.message} You can still fill the rite in by hand.
        </p>
      ) : null}
    </div>
  );
}
