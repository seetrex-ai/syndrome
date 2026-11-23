// The service worker served as /sw.js on the legacy host (edge/worker.ts).
//
// It lives in its own module because the Worker's main module (wrangler.jsonc
// `main`) may export nothing but `default`: workerd treats every named export
// of the entry point as an entrypoint and refuses to start on a string
// ("Incorrect type for map entry 'RETIRE_SW'"). The test
// test_intent_worker_main_exports_only_default pins that.

import { APP_BASE, CANONICAL_ORIGIN } from "./paths";

/**
 * Served as /sw.js on the legacy host. The browser checks the registered
 * script on every navigation; this one differs, installs, skips waiting and on
 * activation deletes every cache, unregisters itself and navigates each window
 * it controls to its own URL, which now goes to the network and gets the
 * redirect to the new origin (the fragment, where a challenge link keeps its
 * puzzle, survives a redirect). Same pattern as vite-plugin-pwa's
 * `selfDestroying`. Written against `self` only, so a test can run it.
 */
export const RETIRE_SW = `// Syndrome moved to ${CANONICAL_ORIGIN}${APP_BASE}: this worker retires the old one.
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      var keys = await self.caches.keys();
      await Promise.all(
        keys.map(function (key) {
          return self.caches.delete(key);
        }),
      );
      await self.registration.unregister();
      var windows = await self.clients.matchAll({ type: "window" });
      for (var i = 0; i < windows.length; i++) {
        windows[i].navigate(windows[i].url);
      }
    })(),
  );
});
`;
