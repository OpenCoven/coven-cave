"use client";

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { setUserAvatarImage, useUserAvatarImage } from "@/lib/user-avatar-image";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";

type Props = {
  className?: string;
  ariaLabel?: string;
};

export function UserChatAvatar({ className, ariaLabel }: Props) {
  const avatar = useUserAvatarImage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const title = status ?? (avatar ? "Change your chat avatar" : "Set your chat avatar");

  return (
    <>
      <button
        type="button"
        className={`cave-user-chat-avatar ${className ?? ""}`.trim()}
        aria-label={ariaLabel ?? "Set your chat avatar"}
        title={title}
        onClick={() => inputRef.current?.click()}
      >
        {avatar ? (
          <img src={avatar.dataUrl} alt="" className="cave-user-chat-avatar__image" aria-hidden="true" />
        ) : (
          <Icon name="ph:user" width={24} height={24} aria-hidden />
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={FAMILIAR_IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setStatus(null);
          void prepareFamiliarImage(file)
            .then(async (prepared) => {
              const res = await setUserAvatarImage(prepared);
              setStatus(res.ok ? (prepared.downsized ? "Image was downsized for Cave." : "Chat avatar updated.") : res.reason);
            })
            .catch((err) => {
              setStatus(err instanceof Error ? err.message : "Could not read image.");
            });
        }}
      />
    </>
  );
}
