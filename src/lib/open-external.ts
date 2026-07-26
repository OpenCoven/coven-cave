export const OPEN_IN_APP_BROWSER_EVENT = "cave:open-url-in-browser";
export const PENDING_IN_APP_BROWSER_URL_KEY = "cave:pending-in-app-browser-url";

export function openInAppBrowserUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_IN_APP_BROWSER_URL_KEY, url);
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, { detail: { url } }));
  if (window.location.pathname !== "/") {
    window.location.assign("/#browser");
  }
}

// Historical name kept for existing call sites. External destinations should
// open inside Cave's Browser surface instead of the system browser/new tab.
export function openExternalUrl(url: string): void {
  openInAppBrowserUrl(url);
}
