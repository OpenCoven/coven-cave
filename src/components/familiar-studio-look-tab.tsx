"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyphPickerPanel } from "./familiar-glyph-picker-panel";
import {
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

const COLOR_PRESETS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#6b7280",
  "#0ea5e9",
];

type Props = { familiar: ResolvedFamiliar };

export function FamiliarStudioLookTab({ familiar }: Props) {
  const overrides = useFamiliarOverrides();
  const images = useFamiliarImages();
  const currentColor = overrides[familiar.id]?.color ?? null;
  const currentImage = images[familiar.id];
  const [toast, setToast] = useState<string | null>(null);

  function pickColor(c: string | null) {
    if (c === null) clearFamiliarOverrideField(familiar.id, "color");
    else setFamiliarOverride(familiar.id, { color: c });
  }

  async function onFile(file: File) {
    setToast(null);
    const dataUrl = await fileToDataUrl(file);
    const res = setFamiliarImage(familiar.id, { dataUrl, mime: file.type });
    if (!res.ok) setToast(res.reason);
  }

  return (
    <div className="familiar-studio-look">
      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Icon</h3>
        <FamiliarGlyphPickerPanel familiar={familiar} />
      </section>

      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Accent color</h3>
        <div className="familiar-studio-look__swatches">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              onClick={() => pickColor(c)}
              className={`familiar-studio-look__swatch${currentColor === c ? " familiar-studio-look__swatch--active" : ""}`}
              style={{ background: c }}
            />
          ))}
          {/* eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role */}
          <input type="color"
            value={currentColor ?? "#888888"}
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
              Drop a PNG, JPEG, WebP, or SVG (max 2MB), or
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
