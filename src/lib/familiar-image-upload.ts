"use client";

import { useCallback, useState } from "react";
import {
  MAX_FAMILIAR_IMAGE_DATAURL_BYTES,
  setFamiliarImage,
  clearFamiliarImage,
} from "@/lib/cave-familiar-images";

export type PreparedFamiliarImage = {
  dataUrl: string;
  mime: string;
  downsized?: boolean;
};

/** Accepted upload types — shared by the Look-tab dropzone and the Studio
 *  header avatar button so both file pickers stay in lockstep. */
export const FAMILIAR_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

const DOWNSIZABLE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DOWNSIZE_DIMENSIONS = [1024, 768, 512, 384, 256];
const DOWNSIZE_QUALITIES = [0.86, 0.76, 0.66];

export async function prepareFamiliarImage(file: File): Promise<PreparedFamiliarImage> {
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

/**
 * Shared avatar-image upload behavior for a single familiar. Prepares (and
 * downsizes when needed) a chosen file, commits it to the familiar image store,
 * and surfaces a one-line status/error via `toast`. Used by both the Look tab's
 * dropzone and the Studio header's click-to-upload avatar.
 */
export function useFamiliarImageUpload(familiarId: string) {
  const [toast, setToast] = useState<string | null>(null);

  const onFile = useCallback(
    async (file: File) => {
      setToast(null);
      try {
        const prepared = await prepareFamiliarImage(file);
        const res = setFamiliarImage(familiarId, prepared);
        if (!res.ok) {
          setToast(res.reason);
          return;
        }
        if (prepared.downsized) setToast("Image was downsized for Cave.");
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Could not read image.");
      }
    },
    [familiarId],
  );

  const clear = useCallback(() => clearFamiliarImage(familiarId), [familiarId]);

  return { onFile, clear, toast, setToast };
}
