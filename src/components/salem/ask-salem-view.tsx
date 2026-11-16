"use client";

// Compatibility for saved `salem` mode/split links only. This is not an assistant.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { ASK_SALEM_THREAD_KEY } from "@/lib/salem/ask-salem-thread";

export function AskSalemView() {
  const { announce } = useAnnouncer();
  const [status, setStatus] = useState("");
  const exportHistory = () => {
    try {
      const raw = window.localStorage.getItem(ASK_SALEM_THREAD_KEY);
      if (raw === null) {
        setStatus("No saved Salem history in this browser.");
        announce("No saved Salem history in this browser.");
        return;
      }
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "cave-salem-history.json";
        link.click();
        // Safari needs the object URL to outlive the download click.
        requestAnimationFrame(() => URL.revokeObjectURL(url));
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      setStatus("Saved history export requested.");
      announce("Saved history export requested.");
    } catch {
      setStatus("Couldn't export saved history. Check browser storage access and try again.");
      announce("Couldn't export saved history.", "assertive");
    }
  };
  return (
    <section aria-label="Retired Ask Salem" className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <EmptyState
        headline="Ask Salem has been retired"
        subtitle="Your saved Salem data has not been deleted. Use Chat to talk with a familiar."
        actions={<Button className="focus-ring" onClick={exportHistory}>Export saved Salem history</Button>}
      />
      {status ? <p role="status" className="text-xs text-[var(--text-secondary)]">{status}</p> : null}
    </section>
  );
}
