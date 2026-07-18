import { NotchQuickChat } from "@/components/notch-quick-chat";
import { TrayQuickChat } from "@/components/tray-quick-chat";

// One route, two presentations: the floating tray window loads /quick-chat
// plain; the shell's notch window loads /quick-chat?notch=1 (see
// notch_url_from_main in src-tauri/src/lib.rs). Sharing the route keeps the
// packaged sidecar runtime closure flat — a dedicated /notch route pushed the
// traced fileCount over the SIDECAR_RUNTIME_BUDGETS ceiling — and the server
// switch picks the presentation without a client-side flash.
export default async function QuickChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return params.notch === "1" ? <NotchQuickChat /> : <TrayQuickChat />;
}
