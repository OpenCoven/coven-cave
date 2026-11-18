"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkSignalSweepAccess, type SignalSweepAccess } from "./signal-sweep-launch";

export function useSignalSweepAccess(familiarId: string) {
  const [state, setState] = useState<SignalSweepAccess & { familiarId: string; checking: boolean }>({ familiarId, available: false, checking: true });
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const own = ++revision.current;
    setState({ familiarId, available: false, checking: true });
    const result = await checkSignalSweepAccess(familiarId);
    if (revision.current === own) setState({ ...result, familiarId, checking: false });
  }, [familiarId]);
  useEffect(() => { void refresh(); return () => { revision.current += 1; }; }, [refresh]);
  return { ...(state.familiarId === familiarId ? state : { familiarId, available: false, checking: true, error: undefined }), refresh };
}
