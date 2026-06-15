"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyphPickerPanel } from "./familiar-glyph-picker-panel";
import {
  MAX_FAMILIAR_IMAGE_DATAURL_BYTES,
  setFamiliarImage,
  clearFamiliarImage,
  useFamiliarImages,
} from "@/lib/cave-familiar-images";
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
  const [toast, setToast] = useState<string | null>(null);
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

  async function onFile(file: File) {
    setToast(null);
    try {
      const prepared = await prepareFamiliarImage(file);
      const res = setFamiliarImage(familiar.id, prepared);
      if (!res.ok) {
        setToast(res.reason);
        return;
      }
      if (prepared.downsized) setToast("Image was downsized for Cave.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not read image.");
    }
  }

  return (
    <div className="familiar-studio-look">
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
            Same harness
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
            Palette by harness
          </button>
        </div>
        <p className="familiar-studio-look__note">
          Pastels follow the current theme accent. Use same-harness scope for a
          whole harness set.
        </p>
      </section>

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
                onClick={() => clearFamiliarImage(familiar.id)}
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
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
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
    </div>
  );
}

// Note: `familiar` is a ResolvedFamiliar — the picker panel takes a base Familiar
// (it does its own resolve). The shape overlap means we can pass it through;
// TypeScript will widen as needed.

type PreparedFamiliarImage = {
  dataUrl: string;
  mime: string;
  downsized?: boolean;
};

const DOWNSIZABLE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DOWNSIZE_DIMENSIONS = [1024, 768, 512, 384, 256];
const DOWNSIZE_QUALITIES = [0.86, 0.76, 0.66];

async function prepareFamiliarImage(file: File): Promise<PreparedFamiliarImage> {
  const dataUrl = await fileToDataUrl(file);
  if (dataUrl.length <= MAX_FAMILIAR_IMAGE_DATAURL_BYTES || !DOWNSIZABLE_MIMES.has(file.type)) {
    return { dataUrl, mime: file.type };
  }

  const downsized = await downsizeFamiliarImage(file);
  return { ...downsized, downsized: true };
}

async function downsizeFamiliarImage(file: File): Promise<{ dataUrl: string; mime: string }> {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not resize image in this browser.");

  let smallest: { dataUrl: string; mime: string } | null = null;
  const outputMimes = file.type === "image/jpeg"
    ? ["image/jpeg", "image/webp"]
    : ["image/webp", "image/jpeg"];

  for (const maxSide of DOWNSIZE_DIMENSIONS) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const mime of outputMimes) {
      for (const quality of DOWNSIZE_QUALITIES) {
        const blob = await canvasToBlob(canvas, mime, quality);
        if (!blob) continue;
        const dataUrl = await blobToDataUrl(blob);
        const candidate = { dataUrl, mime: blob.type || mime };
        if (!smallest || dataUrl.length < smallest.dataUrl.length) smallest = candidate;
        if (dataUrl.length <= MAX_FAMILIAR_IMAGE_DATAURL_BYTES) return candidate;
      }
    }
  }

  if (!smallest) throw new Error("Could not resize image in this browser.");
  return smallest;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const blobToDataUrl = fileToDataUrl;

function colorInputValue(color: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : (COLOR_PRESETS[0]?.inputFallback ?? "#888888");
}
