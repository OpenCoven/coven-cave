function envFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function caveChatoutCodex(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_CHATOUT_CODEX);
}
