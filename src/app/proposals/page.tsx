import { Icon } from "@/lib/icon";
import { ProposalApproval } from "@/components/proposal-approval";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proposals — CovenCave",
};

export default function ProposalsPage() {
  return (
    <main className="dr-page">
      <div className="dr-topbar" data-tauri-drag-region="deep">
        <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
          <a className="dr-back" href="/">
            <Icon name="ph:arrow-left" aria-hidden />
            CovenCave
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <span className="dr-crumb-current">Proposals</span>
        </nav>
      </div>
      <div className="px-4 pb-6">
        <p className="mb-3 max-w-2xl text-xs text-[var(--text-muted)]">
          Staged writes from ~/.coven/pending/ — each one degraded to a proposal by a frayed thread.
          A proposal is data, not authority: approving forwards your decision to the daemon, which
          re-validates before anything touches a protected surface. This page never applies edits
          itself.
        </p>
        <ProposalApproval />
      </div>
    </main>
  );
}
