"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/lib/icon";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings-save-feedback";

const DISMISS_AFTER_MS = 2_400;

type SaveNotice = {
  id: number;
  message: string;
};

export function SettingsSaveToast() {
  const [notice, setNotice] = useState<SaveNotice | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setNotice({
        id: Date.now(),
        message: message?.trim() || "Saved automatically.",
      });
    };
    window.addEventListener(SETTINGS_SAVED_EVENT, show);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, show);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      key={notice.id}
      className="ui-undo-toast ui-save-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="ui-undo-toast__content">
        <Icon
          name="ph:check-circle-bold"
          className="ui-undo-toast__icon"
          aria-hidden
        />
        <span className="ui-undo-toast__label">{notice.message}</span>
        <button
          type="button"
          className="ui-undo-toast__dismiss"
          onClick={() => setNotice(null)}
          aria-label="Dismiss saved notification"
        >
          <Icon name="ph:x-bold" aria-hidden />
        </button>
      </div>
    </div>
  );
}
