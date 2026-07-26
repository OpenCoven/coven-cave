import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type CommandPermissionMode,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "./command-controls.ts";

const CHAT_COMPOSER_PREFS_KEY = "cave:chat-composer-controls:v1";

export type ChatComposerPrefs = {
  thinkingEffort: CommandThinkingEffort;
  responseSpeed: CommandResponseSpeed;
  permissionMode: CommandPermissionMode;
};

function defaults(): ChatComposerPrefs {
  return { ...COMMAND_CONTROL_DEFAULTS, permissionMode: DEFAULT_PERMISSION_MODE };
}

/** Read only recognized persisted values so stale localStorage cannot corrupt controls. */
export function readChatComposerPrefs(storage: Pick<Storage, "getItem"> | null): ChatComposerPrefs {
  if (!storage) return defaults();
  try {
    const raw = storage.getItem(CHAT_COMPOSER_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<Record<keyof ChatComposerPrefs, string>> : {};
    return {
      thinkingEffort: COMMAND_THINKING_OPTIONS.some((option) => option.value === parsed.thinkingEffort)
        ? parsed.thinkingEffort as CommandThinkingEffort : COMMAND_CONTROL_DEFAULTS.thinkingEffort,
      responseSpeed: COMMAND_RESPONSE_SPEED_OPTIONS.some((option) => option.value === parsed.responseSpeed)
        ? parsed.responseSpeed as CommandResponseSpeed : COMMAND_CONTROL_DEFAULTS.responseSpeed,
      permissionMode: PERMISSION_MODES.some((mode) => mode.value === parsed.permissionMode)
        ? parsed.permissionMode as CommandPermissionMode : DEFAULT_PERMISSION_MODE,
    };
  } catch {
    return defaults();
  }
}

export function writeChatComposerPrefs(storage: Pick<Storage, "setItem"> | null, prefs: ChatComposerPrefs): void {
  if (!storage) return;
  try {
    storage.setItem(CHAT_COMPOSER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* best effort */
  }
}
