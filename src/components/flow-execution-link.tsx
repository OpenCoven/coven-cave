"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FlowExecutionsDialog } from "./flow-executions-dialog";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  familiars: readonly Familiar[];
  familiarsLoaded: boolean;
  activeFamiliarId: string | null;
  sessions?: SessionRow[];
  onSelectFamiliar(id: string): void;
  onNavigate(mode: "chat" | "surface:researcher-desk"): void;
  onOpenSession(sessionId: string, familiarId: string): void;
};

export function FlowExecutionLink({
  familiars, familiarsLoaded, activeFamiliarId, sessions, onSelectFamiliar, onNavigate, onOpenSession,
}: Props) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const runId = search.get("flowRun")?.trim() || null;
  const sessionId = search.get("flowSession")?.trim() || null;
  const missionId = search.get("researchMission")?.trim() || null;
  const familiarId = search.get("flowFamiliar")?.trim() || null;
  const targetKey = runId || sessionId || missionId
    ? JSON.stringify([runId, sessionId, missionId, familiarId])
    : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const navigatedKey = useRef<string | null>(null);
  const selectedKey = useRef<string | null>(null);
  const ownerId = familiars.find((familiar) => familiar.id === familiarId)?.id;
  const active = targetKey !== null && targetKey !== dismissedKey;

  useEffect(() => {
    if (!targetKey) {
      navigatedKey.current = null;
      selectedKey.current = null;
      setDismissedKey(null);
      return;
    }
    if (!active || navigatedKey.current === targetKey) return;
    if (!runId && !sessionId && familiarId && (!familiarsLoaded || !ownerId)) return;
    navigatedKey.current = targetKey;
    onNavigate(runId || sessionId ? "chat" : "surface:researcher-desk");
  }, [active, targetKey, runId, sessionId, familiarId, familiarsLoaded, ownerId, onNavigate]);

  useEffect(() => {
    if (!active || !familiarsLoaded || !ownerId || selectedKey.current === targetKey) return;
    selectedKey.current = targetKey;
    if (activeFamiliarId !== ownerId) onSelectFamiliar(ownerId);
  }, [active, targetKey, familiarsLoaded, ownerId, activeFamiliarId, onSelectFamiliar]);

  const close = () => {
    setDismissedKey(targetKey);
    const params = new URLSearchParams(window.location.search);
    if (runId || sessionId) {
      params.delete("flowRun");
      params.delete("flowSession");
      if (!params.has("researchMission")) params.delete("flowFamiliar");
    } else {
      params.delete("researchMission");
      params.delete("flowFamiliar");
    }
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    // Next synchronizes this History write; dismissal must not wait for an RSC request.
    window.history.replaceState(null, "", href);
    router.replace(href, { scroll: false });
  };

  if (!active) return null;
  if (runId || sessionId) {
    return (
      <FlowExecutionsDialog
        key={targetKey}
        open
        initialRunId={runId ?? undefined}
        initialSessionId={sessionId ?? undefined}
        sessions={sessions}
        onClose={close}
        onOpenSession={onOpenSession}
      />
    );
  }
  if (missionId && familiarId && familiarsLoaded && !ownerId) {
    return (
      <Modal open onClose={close} breadcrumb={["Research", "Unavailable"]}
        footerActions={<Button onClick={close}>Close</Button>}>
        <ErrorState compact headline="Research familiar unavailable"
          subtitle={`The familiar ${familiarId} is not in the available roster. No other familiar was selected.`} />
      </Modal>
    );
  }
  return null;
}
