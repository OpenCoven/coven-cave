const DEV_CACHE_RESET_SCRIPT = `
(function () {
  try {
    var reloadKey = "coven-cave:dev-cache-reset-reloaded";
    var pending = [];
    if ("serviceWorker" in navigator) {
      pending.push(
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
          return Promise.all(
            registrations.map(function (registration) {
              return registration.unregister();
            }),
          ).then(function () {
            return registrations.length > 0;
          });
        }),
      );
    }
    if ("caches" in window) {
      pending.push(
        caches.keys().then(function (keys) {
          var covenKeys = keys.filter(function (key) {
            return key.indexOf("covencave-pwa") === 0;
          });
          return Promise.all(
            covenKeys.map(function (key) {
              return caches.delete(key);
            }),
          ).then(function () {
            return covenKeys.length > 0;
          });
        }),
      );
    }
    if (pending.length === 0) return;
    Promise.all(pending).then(function (results) {
      var removedStaleState = results.some(Boolean);
      if (!removedStaleState) {
        sessionStorage.removeItem(reloadKey);
        return;
      }
      if (sessionStorage.getItem(reloadKey) === "1") return;
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    }).catch(function () {});
  } catch (e) {}
})();
`.trim();

export function DevCacheResetScript() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <script
      id="dev-cache-reset"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: development-only stale SW cleanup before hydration
      dangerouslySetInnerHTML={{ __html: DEV_CACHE_RESET_SCRIPT }}
    />
  );
}
