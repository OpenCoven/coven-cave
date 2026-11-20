import { isTauri } from "../tauri-platform.ts";

export type MicrophoneAccessErrorCode =
  | "microphone_denied"
  | "microphone_not_found"
  | "microphone_unavailable"
  | "microphone_unsupported"
  | "microphone_permission_failed";

type NativeMicrophonePermission = {
  status: "granted" | "denied" | "unavailable";
};

type InvokeCommand = (command: string) => Promise<unknown>;

/** The desktop shell's OS, or null in a browser tab. */
export type DesktopPlatform = "macos" | "windows" | "linux" | null;

type MicrophoneAccessDependencies = {
  nativeMac?: boolean;
  detectNativeMac?: () => Promise<boolean>;
  /** Overrides OS detection; `nativeMac: true` implies "macos". */
  desktopPlatform?: DesktopPlatform;
  detectDesktopPlatform?: () => Promise<DesktopPlatform>;
  invoke?: InvokeCommand;
  getUserMedia?: () => Promise<MediaStream>;
};

export class MicrophoneAccessError extends Error {
  readonly code: MicrophoneAccessErrorCode;
  readonly hint: string;
  readonly canOpenSettings: boolean;

  constructor(
    code: MicrophoneAccessErrorCode,
    hint: string,
    canOpenSettings = false,
  ) {
    super(code);
    this.name = "MicrophoneAccessError";
    this.code = code;
    this.hint = hint;
    this.canOpenSettings = canOpenSettings;
  }
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

/**
 * Where a denied microphone is re-enabled. The macOS shell can open the pane
 * itself; Windows and Linux desktops get the path spelled out, and only a
 * browser tab is told about "site" settings (#5970).
 */
export function microphoneDeniedHint(
  canOpenSettings: boolean,
  platform: DesktopPlatform = null,
): string {
  if (canOpenSettings) {
    return "Allow Coven Cave under System Settings → Privacy & Security → Microphone, then retry.";
  }
  if (platform === "windows") {
    return "Allow CovenCave to use the microphone under Windows Settings → Privacy & security → Microphone, then retry.";
  }
  if (platform === "linux") {
    return "Allow CovenCave to use the microphone in your system's privacy or sound settings, then retry.";
  }
  return "Allow microphone access for this site in your browser settings, then retry.";
}

export function classifyMicrophoneCaptureError(
  error: unknown,
  canOpenSettings = false,
  platform: DesktopPlatform = null,
): MicrophoneAccessError {
  if (error instanceof MicrophoneAccessError) return error;

  switch (errorName(error)) {
    case "NotAllowedError":
      return new MicrophoneAccessError(
        "microphone_denied",
        microphoneDeniedHint(canOpenSettings, platform),
        canOpenSettings,
      );
    case "SecurityError":
      return new MicrophoneAccessError(
        "microphone_unsupported",
        "Microphone capture is disabled for this app window or browser.",
      );
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new MicrophoneAccessError(
        "microphone_not_found",
        "Connect or enable a microphone, then retry.",
      );
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new MicrophoneAccessError(
        "microphone_unavailable",
        "Close other apps using the microphone, check the selected input device, then retry.",
      );
    default:
      return new MicrophoneAccessError(
        "microphone_unavailable",
        "Check the microphone connection and input settings, then retry.",
      );
  }
}

async function defaultInvoke(command: string): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command);
}

function defaultGetUserMedia(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneAccessError(
      "microphone_unsupported",
      "Use the Coven Cave desktop app or a browser window that supports microphone capture.",
    );
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

async function detectDesktopPlatform(): Promise<DesktopPlatform> {
  if (!isTauri()) return null;
  const { platform } = await import("@tauri-apps/plugin-os");
  const os = platform();
  return os === "macos" || os === "windows" || os === "linux" ? os : null;
}

export async function requestMicrophoneStream(
  dependencies: MicrophoneAccessDependencies = {},
): Promise<MediaStream> {
  let nativeMac: boolean;
  let desktopPlatform: DesktopPlatform = null;
  try {
    if (dependencies.nativeMac !== undefined || dependencies.detectNativeMac) {
      nativeMac = dependencies.nativeMac ?? await dependencies.detectNativeMac!();
      desktopPlatform = nativeMac ? "macos" : dependencies.desktopPlatform ?? null;
    } else {
      desktopPlatform =
        dependencies.desktopPlatform ??
        await (dependencies.detectDesktopPlatform ?? detectDesktopPlatform)();
      nativeMac = desktopPlatform === "macos";
    }
  } catch {
    nativeMac = false;
    desktopPlatform = null;
  }
  const invoke = dependencies.invoke ?? defaultInvoke;

  if (nativeMac) {
    let permission: NativeMicrophonePermission;
    try {
      permission = await invoke("microphone_permission_request") as NativeMicrophonePermission;
    } catch {
      throw new MicrophoneAccessError(
        "microphone_permission_failed",
        "Restart Coven Cave and retry the call.",
      );
    }

    if (permission.status === "denied") {
      throw new MicrophoneAccessError(
        "microphone_denied",
        "Allow Coven Cave under System Settings → Privacy & Security → Microphone, then retry.",
        true,
      );
    }
    if (permission.status !== "granted" && permission.status !== "unavailable") {
      throw new MicrophoneAccessError(
        "microphone_permission_failed",
        "Restart Coven Cave and retry the call.",
      );
    }
  }

  try {
    return await (dependencies.getUserMedia ?? defaultGetUserMedia)();
  } catch (error) {
    throw classifyMicrophoneCaptureError(error, nativeMac, desktopPlatform);
  }
}

export async function openMicrophoneSettings(
  invoke: InvokeCommand = defaultInvoke,
): Promise<void> {
  await invoke("microphone_settings_open");
}
