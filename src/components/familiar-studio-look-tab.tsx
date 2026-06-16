"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyphPickerPanel } from "./familiar-glyph-picker-panel";
import { useFamiliarImages } from "@/lib/cave-familiar-images";
import { useFamiliarImageUpload, FAMILIAR_IMAGE_ACCEPT } from "@/lib/familiar-image-upload";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
  useFamiliarOverrides,
} from "@/lib/cave-familiar-overrides";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type ColorPreset = {
  label: string;
  color: string;
  inputFallback: string;
};

const COLOR_PRESETS: ColorPreset[] = [
  {
    label: "Theme",
    color: "color-mix(in oklch, var(--accent-presence) 72%, white 28%)",
    inputFallback: "#9a8ecd",
  },
  {
    label: "Lilac",
    color: "oklch(0.82 0.08 305)",
    inputFallback: "#d8a7f2",
  },
  {
    label: "Rose",
    color: "oklch(0.82 0.08 20)",
    inputFallback: "#f2a6b5",
  },
  {
    label: "Peach",
    color: "oklch(0.84 0.08 55)",
    inputFallback: "#f0bd82",
  },
  {
    label: "Sage",
    color: "oklch(0.80 0.08 145)",
    inputFallback: "#91d3a4",
  },
  {
    label: "Mint",
    color: "oklch(0.83 0.08 180)",
    inputFallback: "#88d9c9",
  },
  {
    label: "Tide",
    color: "oklch(0.80 0.08 235)",
    inputFallback: "#93b9f4",
  },
  {
    label: "Moon",
    color: "color-mix(in oklch, var(--accent-presence-soft) 58%, var(--text-primary) 18%, white 24%)",
    inputFallback: "#b8b8c2",
  },
];

type ColorScope = "familiar" | "harness";

type Props = {
  familiar: ResolvedFamiliar;
  allFamiliars: ResolvedFamiliar[];
};

export function FamiliarStudioLookTab({ familiar, allFamiliars }: Props) {
  const overrides = useFamiliarOverrides();
  const images = useFamiliarImages();
  const currentColor = overrides[familiar.id]?.color ?? null;
  const currentImage = images[familiar.id];
  const { onFile, clear, toast } = useFamiliarImageUpload(familiar.id);
  const [colorScope, setColorScope] = useState<ColorScope>("familiar");

  const harnessKey = familiar.harness ?? "";
  const harnessTargets = allFamiliars.filter((target) => (target.harness ?? "") === harnessKey);
  const colorTargets = colorScope === "harness" ? harnessTargets : [familiar];

  function applyColorToTargets(targets: ResolvedFamiliar[], color: string) {
    for (const target of targets) setFamiliarOverride(target.id, { color });
  }

  function pickColor(color: string | null) {
    if (color === null) {
      for (const target of colorTargets) clearFamiliarOverrideField(target.id, "color");
    } else {
      applyColorToTargets(colorTargets, color);
    }
  }

  function applyPaletteByFamiliar() {
    allFamiliars.forEach((target, index) => {
      const color = COLOR_PRESETS[index % COLOR_PRESETS.length].color;
      setFamiliarOverride(target.id, { color });
    });
  }

  function applyPaletteByHarness() {
    const harnesses = Array.from(
      new Set(allFamiliars.map((target) => target.harness ?? "unassigned")),
    );
    const colorByHarness = new Map(
      harnesses.map((harness, index) => [
        harness,
        COLOR_PRESETS[index % COLOR_PRESETS.length].color,
      ]),
    );
    for (const target of allFamiliars) {
      const color = colorByHarness.get(target.harness ?? "unassigned");
      if (color) setFamiliarOverride(target.id, { color });
    }
  }

  return (
    <div className="familiar-studio-look">
      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Avatar image</h3>
        <div
          className="familiar-studio-look__dropzone"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
        >
          {currentImage ? (
            <>
              <img
                src={currentImage.dataUrl}
                alt="Current avatar"
                width={72}
                height={72}
                className="rounded-md object-cover"
              />
              <button
                type="button"
                onClick={clear}
                className="familiar-studio-look__remove"
              >
                Remove image
              </button>
            </>
          ) : (
            <span className="familiar-studio-look__hint">
              Drop a PNG, JPEG, WebP, or SVG. Large raster images are downsized automatically, or
            </span>
          )}
          <label className="familiar-studio-look__upload">
            <Icon name="ph:cloud-arrow-up-bold" width={14} /> Choose file
            <input type="file"
              accept={FAMILIAR_IMAGE_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {toast ? <p className="familiar-studio-look__toast">{toast}</p> : null}
      </section>

      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Icon</h3>
        <FamiliarGlyphPickerPanel familiar={familiar} />
      </section>

      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Accent color</h3>
        <div
          className="familiar-studio-look__scope"
          role="group"
          aria-label="Color assignment scope"
        >
          <button
            type="button"
            onClick={() => setColorScope("familiar")}
            className={`familiar-studio-look__scope-btn${colorScope === "familiar" ? " familiar-studio-look__scope-btn--active" : ""}`}
          >
            This familiar
          </button>
          <button
            type="button"
            onClick={() => setColorScope("harness")}
            className={`familiar-studio-look__scope-btn${colorScope === "harness" ? " familiar-studio-look__scope-btn--active" : ""}`}
          >
            Same runtime
            <span>{harnessTargets.length}</span>
          </button>
        </div>
        <div className="familiar-studio-look__swatches">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-label={`Use ${preset.label}`}
              title={preset.label}
              onClick={() => pickColor(preset.color)}
              className={`familiar-studio-look__swatch${currentColor === preset.color ? " familiar-studio-look__swatch--active" : ""}`}
              style={{ background: preset.color }}
            />
          ))}
          {/* eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role */}
          <input type="color"
            value={colorInputValue(currentColor)}
            onChange={(e) => pickColor(e.target.value)}
            aria-label="Custom accent color"
            className="familiar-studio-look__custom"
          />
          <button
            type="button"
            onClick={() => pickColor(null)}
            disabled={!currentColor}
            className="familiar-studio-look__reset"
          >
            Reset
          </button>
        </div>
        <div className="familiar-studio-look__palette-actions">
          <button type="button" onClick={applyPaletteByFamiliar}>
            Palette by familiar
          </button>
          <button type="button" onClick={applyPaletteByHarness}>
            Palette by runtime
          </button>
        </div>
        <p className="familiar-studio-look__note">
          Pastels follow the current theme accent. Use same-runtime scope for a
          whole runtime set.
        </p>
      </section>

    </div>
  );
}

// Note: `familiar` is a ResolvedFamiliar — the picker panel takes a base Familiar
// (it does its own resolve). The shape overlap means we can pass it through;
// TypeScript will widen as needed.

function colorInputValue(color: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : (COLOR_PRESETS[0]?.inputFallback ?? "#888888");
}
