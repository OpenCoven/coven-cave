import { DetachedChatWindow } from "@/components/detached-chat-window";
import { FirstUseProvider } from "@/components/first-use-provider";
import { TrayQuickChat } from "@/components/tray-quick-chat";

// One route, two windows: the floating tray window loads /quick-chat plain;
// the detached Chat window (the right Chat panel popped out of the main
// window) loads /quick-chat?view=window (see chat_window_url_from_main in
// src-tauri/src/window_geometry.rs). Sharing the route keeps the packaged
// sidecar runtime closure flat — a dedicated route pushes the traced fileCount
// toward the SIDECAR_RUNTIME_BUDGETS ceiling — and the server switch picks the
// presentation without a client-side flash.
export default async function QuickChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.view === "window") return <DetachedChatWindow />;
  return <FirstUseProvider><TrayQuickChat /></FirstUseProvider>;
}
