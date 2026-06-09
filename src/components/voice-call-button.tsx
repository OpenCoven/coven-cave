"use client";

import { Icon } from "@iconify/react";
import type { Familiar } from "@/lib/types";

type Props = {
  familiar: Familiar;
  callActive: boolean;
  onOpen: () => void;
};

export function VoiceCallButton({ familiar, callActive, onOpen }: Props) {
  const configured = Boolean(familiar.voiceProvider);
  const disabled = !configured || callActive;
  const title = !configured
    ? "Open Familiar Studio → Brain to pick a voice provider"
    : callActive
      ? "Call in progress"
      : `Call ${familiar.display_name}`;
  return (
    <button
      type="button"
      className="voice-call-button"
      aria-label={title}
      title={!configured ? "Open Familiar Studio → Brain to pick a voice provider" : title}
      disabled={!familiar.voiceProvider || callActive}
      onClick={onOpen}
    >
      <Icon icon="ph:phone-fill" />
    </button>
  );
}
