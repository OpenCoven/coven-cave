"use client";

import { Icon } from "@/lib/icon";
import { Modal } from "@/components/ui/modal";

export type ResearchResourceBrowserModalProps = {
  open: boolean;
  onClose: () => void;
  /** Resource title — the final breadcrumb segment. */
  title: string;
  /** Browser-capable source URL. Untrusted data; loaded only when consent allows. */
  url: string | null;
  /** Mirrors `consent.allowRemoteContent` — remote content is opt-in, fail-closed. */
  allowRemoteContent: boolean;
};

/**
 * The Research Desk's browser-capable resource preview.
 *
 * Local normalized content stays the default view in the resources surface;
 * this modal is the opt-in "browser view". When `allowRemoteContent` is false
 * no URL is ever loaded — the pane shows a gated notice instead, honoring the
 * Research policy that resource text is untrusted data and remote content is
 * consent-gated.
 *
 * On the desktop shell the in-app browser surface uses a native Tauri webview;
 * that machinery owns its own bounds/occlusion lifecycle and is not reused for
 * a portaled modal. This modal follows the browser pane's own fallback path —
 * the sandboxed `<iframe>` it renders in `next dev` and on non-desktop
 * platforms — so it stays DOM-native and composable inside the shared Modal.
 */
export function ResearchResourceBrowserModal({
  open,
  onClose,
  title,
  url,
  allowRemoteContent,
}: ResearchResourceBrowserModalProps) {
  const browserUrl = allowRemoteContent ? url : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      breadcrumb={["Research", "Resource browser", title]}
    >
      <div className="research-resource-browser">
        {!allowRemoteContent ? (
          <div className="research-resource-browser__gated" role="status">
            <Icon name="ph:lock-simple" width={16} height={16} aria-hidden />
            <strong>Remote content is off</strong>
            <p>
              This resource’s local text stays the default view. Turn on remote
              content to load its source URL here.
            </p>
          </div>
        ) : browserUrl ? (
          <iframe
            src={browserUrl}
            title={`${title} — browser preview`}
            className="research-resource-browser__frame"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="research-resource-browser__gated" role="status">
            <Icon name="ph:link-simple" width={16} height={16} aria-hidden />
            <strong>No source URL</strong>
            <p>This resource has no browser-capable source to open.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
