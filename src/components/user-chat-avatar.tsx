"use client";

import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { AvatarLightbox } from "./ui/avatar-lightbox";
import { useUserProfile, userAvatarUrl, userDisplayName } from "@/lib/user-profile";

type Props = {
  className?: string;
  ariaLabel?: string;
};

/** Operator avatar — displays the server-stored profile image. Clicking the
 *  image enlarges it in the shared lightbox, same as every other avatar
 *  surface; the profile path lives on as the modal's "Edit in Settings →"
 *  footer action, so peek and edit never collide. Without an image there is
 *  nothing to enlarge, so the button keeps its Settings → Profile deep link. */
export function UserChatAvatar({ className, ariaLabel }: Props) {
  const snapshot = useUserProfile();
  const src = userAvatarUrl(snapshot);
  const name = userDisplayName(snapshot?.profile);

  const face = src ? (
    <img src={src} alt="" className="cave-user-chat-avatar__image" aria-hidden="true" />
  ) : name !== "You" ? (
    <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
  ) : (
    <Icon name="ph:user" width={24} height={24} aria-hidden />
  );

  if (src) {
    return (
      <AvatarLightbox
        src={src}
        label={name}
        category="Profile"
        triggerClassName={className}
        footerActions={
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:pencil-simple"
            onClick={() => window.location.assign("/settings#profile")}
          >
            Edit in Settings →
          </Button>
        }
      >
        {face}
      </AvatarLightbox>
    );
  }

  return (
    <button
      type="button"
      className={`cave-user-chat-avatar ${className ?? ""}`.trim()}
      aria-label={ariaLabel ?? "Open profile settings"}
      title="Profile settings"
      onClick={() => window.location.assign("/settings#profile")}
    >
      {face}
    </button>
  );
}
