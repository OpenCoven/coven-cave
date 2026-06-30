import type { RuntimeModelOption } from "@/lib/runtime-models";

export type CommandThinkingEffort = "low" | "medium" | "high";
export type CommandResponseSpeed = "fast" | "balanced" | "careful";
export type CommandControlDensity = "full" | "compact";
export type CommandControlSurface = "home" | "chat" | "code" | "quick-chat";

export type CommandControls = {
  thinkingEffort: CommandThinkingEffort;
  responseSpeed: CommandResponseSpeed;
};

export type InitialCommandControls = Partial<CommandControls>;

export const COMMAND_CONTROL_DEFAULTS: CommandControls = {
  thinkingEffort: "high",
  responseSpeed: "fast",
};

export const COMMAND_THINKING_OPTIONS: Array<{ value: CommandThinkingEffort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const COMMAND_RESPONSE_SPEED_OPTIONS: Array<{ value: CommandResponseSpeed; label: string }> = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "careful", label: "Careful" },
];

export type CommandPermissionMode = "full" | "read" | "ask";

export const PERMISSION_MODES: { value: CommandPermissionMode; label: string; icon: string }[] = [
  { value: "full", label: "Full access", icon: "ph:shield-warning" },
  { value: "read", label: "Read only", icon: "ph:eye" },
  { value: "ask", label: "Ask first", icon: "ph:hand" },
];

export const DEFAULT_PERMISSION_MODE: CommandPermissionMode = "full";

function isThinkingEffort(value: unknown): value is CommandThinkingEffort {
  return COMMAND_THINKING_OPTIONS.some((option) => option.value === value);
}

function isResponseSpeed(value: unknown): value is CommandResponseSpeed {
  return COMMAND_RESPONSE_SPEED_OPTIONS.some((option) => option.value === value);
}

export function normalizeCommandControls(input: Partial<Record<keyof CommandControls, unknown>> | null | undefined): CommandControls {
  return {
    thinkingEffort: isThinkingEffort(input?.thinkingEffort)
      ? input.thinkingEffort
      : COMMAND_CONTROL_DEFAULTS.thinkingEffort,
    responseSpeed: isResponseSpeed(input?.responseSpeed)
      ? input.responseSpeed
      : COMMAND_CONTROL_DEFAULTS.responseSpeed,
  };
}

export function commandControlPayload(controls: CommandControls): {
  reasoningEffort: CommandThinkingEffort;
  responseSpeed: CommandResponseSpeed;
} {
  return {
    reasoningEffort: controls.thinkingEffort,
    responseSpeed: controls.responseSpeed,
  };
}

export function runtimeModelSelectLabel(options: RuntimeModelOption[]): string {
  return options.length === 0 ? "Runtime managed" : "Model";
}
