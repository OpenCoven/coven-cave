"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import { Modal } from "./ui/modal";
import { useAnnouncer } from "./ui/live-region";

const VaultPanel = dynamic(() => import("./vault-panel").then((m) => m.VaultPanel), {
  ssr: false,
  loading: () => <p role="status">Loading Vault…</p>,
});

/** Keep Chat mounted so credentials can be repaired without losing the retry
 * payload, including attachments and the failed turn's selected controls. */
export function HarnessAuthVaultButton({ familiarId, className }: { familiarId: string; className: string }) {
  const [open, setOpen] = useState(false);
  const { announce } = useAnnouncer();
  return (
    <>
      <button type="button" className={className} onClick={(event) => {
        // Give the shared modal a stable focus-return target in WebKit.
        event.currentTarget.focus({ preventScroll: true });
        setOpen(true);
        announce("Opening familiar Vault. Your message is kept for retry.");
      }}>
        <Icon name="ph:key" width={11} aria-hidden />
        Open familiar Vault
      </button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} breadcrumb={["Familiar", "Vault"]} wide>
          <p className="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            Save your credentials, then close the Vault and retry your message.
          </p>
          <VaultPanel familiarId={familiarId} />
        </Modal>
      ) : null}
    </>
  );
}
