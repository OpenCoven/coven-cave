"use client";

import { Icon } from "@/lib/icon";
import { useUserProfile, userAvatarUrl, userDisplayName } from "@/lib/user-profile";

type Props = {
  className?: string;
  ariaLabel?: string;
};

/** Operator avatar — displays the server-stored profile image. Editing moved
 *  to Settings → Profile; clicking navigates there. */
export function UserChatAvatar({ className, ariaLabel }: Props) {
  const snapshot = useUserProfile();
  const src = userAvatarUrl(snapshot);
  const name = userDisplayName(snapshot?.profile);

  return (
    <button
      type="button"
      className={`cave-user-chat-avatar ${className ?? ""}`.trim()}
      aria-label={ariaLabel ?? "Open profile settings"}
      title="Profile settings"
      onClick={() => window.location.assign("/settings#profile")}
    >
      {src ? (
        <img src={src} alt="" className="cave-user-chat-avatar__image" aria-hidden="true" />
      ) : name !== "You" ? (
        <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <Icon name="ph:user" width={24} height={24} aria-hidden />
      )}
    </button>
  );
}
