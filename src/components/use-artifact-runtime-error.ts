"use client";

import { useCallback, useEffect, useState } from "react";

export const ARTIFACT_NAVIGATION_WARNING =
  "The artifact navigated away from its preview. Reload or reopen the preview before adding comments.";
export const ARTIFACT_NAVIGATION_WARNING_DURATION_MS = 3_000;

type RuntimeNotice = {
  message: string;
  dismissAfterMs?: number;
};

export function useArtifactRuntimeError() {
  const [notice, setNotice] = useState<RuntimeNotice | null>(null);

  const setRuntimeError = useCallback((message: string | null) => {
    setNotice(message ? { message } : null);
  }, []);

  const showNavigationWarning = useCallback(() => {
    setNotice({
      message: ARTIFACT_NAVIGATION_WARNING,
      dismissAfterMs: ARTIFACT_NAVIGATION_WARNING_DURATION_MS,
    });
  }, []);

  useEffect(() => {
    if (!notice?.dismissAfterMs) return;
    const activeNotice = notice;
    const timer = setTimeout(() => {
      setNotice((current) => current === activeNotice ? null : current);
    }, notice.dismissAfterMs);
    return () => clearTimeout(timer);
  }, [notice]);

  return {
    runtimeError: notice?.message ?? null,
    setRuntimeError,
    showNavigationWarning,
  };
}
