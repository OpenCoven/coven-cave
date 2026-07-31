import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { ProposalApproval } from "@/components/proposal-approval";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proposals — CovenCave",
};

/**
 * Staged writes from ~/.coven/pending/ — each one degraded to a proposal by a
 * frayed thread. A proposal is data, not authority: approving forwards your
 * decision to the daemon, which re-validates before anything touches a
 * protected surface. This page never applies edits itself.
 *
 * Chrome (breadcrumb back through Weaves to Memories) lives with the queue in
 * components/threads-chrome.tsx, shared with /weaves — they are one flow.
 */
export default function ProposalsPage() {
  return (
    <AnalyticsPageShell>
      <ProposalApproval />
    </AnalyticsPageShell>
  );
}
