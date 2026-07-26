export type NativeDownloadEvent =
  | { event: "Started"; data?: { contentLength?: number } }
  | { event: "Progress"; data?: { chunkLength?: number } }
  | { event: "Finished" };

export type NativeUpdateHandle = {
  version: string;
  available?: boolean;
  download: (onEvent?: (event: NativeDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
};

export type PreparationProgress = {
  phase: "downloading" | "verifying";
  pct: number;
};

export type CancellationSignal = { cancelled: boolean };

const closedUpdates = new WeakSet<object>();

/**
 * Download and signature-verify an update while the current app remains usable.
 * Tauri does not expose a network abort handle, so cancellation is cooperative:
 * the verified bytes are released as soon as the in-flight request settles.
 */
export async function prepareNativeUpdate(
  update: NativeUpdateHandle,
  onProgress: (progress: PreparationProgress) => void,
  cancellation: CancellationSignal,
): Promise<"ready" | "cancelled"> {
  let total = 0;
  let received = 0;
  try {
    await update.download((event) => {
      if (event.event === "Started") {
        total = event.data?.contentLength ?? 0;
        onProgress({ phase: "downloading", pct: 0 });
      } else if (event.event === "Progress") {
        received += event.data?.chunkLength ?? 0;
        if (total > 0) {
          onProgress({
            phase: "downloading",
            pct: Math.min(98, Math.round((received / total) * 100)),
          });
        }
      } else if (event.event === "Finished") {
        // The Rust plugin emits Finished before minisign verification.
        onProgress({ phase: "verifying", pct: 99 });
      }
    });
  } catch (error) {
    if (!cancellation.cancelled) throw error;
    await releasePreparedUpdate(update);
    return "cancelled";
  }

  if (cancellation.cancelled) {
    await releasePreparedUpdate(update);
    return "cancelled";
  }
  return "ready";
}

export async function releasePreparedUpdate(update: NativeUpdateHandle): Promise<void> {
  if (closedUpdates.has(update)) return;
  closedUpdates.add(update);
  try {
    await update.close();
  } catch {
    // The installer may already have consumed and closed the resource.
  }
}
