import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";

/** How often a long-lived tab asks the server for a new build. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Service worker notices (tasks/plans/phase2.md D14): "ready to work offline"
 * once the first precache completes, "update available" when a new build has
 * been installed and is waiting (`registerType: "prompt"`, vite.config.ts).
 *
 * Reload reloads THIS tab only. The library's prompt mode
 * registers, in every tab that saw the waiting worker, a `controlling`
 * listener that reloads the page unless `onNeedReload` is given; so when one
 * tab posted SKIP_WAITING the new worker took control everywhere and every
 * other tab reloaded too, state lost. Here `onNeedReload` reloads only when
 * this tab's Reload was clicked (`wantsReload`); a tab whose worker was
 * activated by another tab keeps its state, its toast and its old JS, and
 * reloads when its own user clicks. Its old JS asks the network for nothing
 * more: every lazy chunk is loaded at mount (App.tsx renders both Suspense
 * panels unconditionally) and the simulation Worker is created once per mount
 * and reused by every run (useSimulation; created per model change, it
 * requested its old hashed URL and got the SPA fallback). Should
 * the Worker still fail, the chart says so (`chart.workerLost`). In that tab
 * there is no waiting worker any more, so SKIP_WAITING would never fire
 * `controlling`: Reload then reloads directly. Closing the notice keeps the
 * current build until the next visit.
 *
 * A tab left open for days would never learn of a new build (the browser
 * checks for a new service worker on navigation): every UPDATE_CHECK_MS,
 * while online, the registration is asked to update.
 *
 * The live region (`aria-live`, not `role="status"`: App keeps the grid
 * verdict as its only status role) is always mounted and empty at rest, so a
 * notice is a change of content that screen readers announce;
 * index.css collapses the empty card.
 */
export interface UpdateToastProps {
  /** Tests inject a spy; the app reloads the window. */
  readonly reload?: () => void;
}

const reloadWindow = () => window.location.reload();

export function UpdateToast({ reload = reloadWindow }: UpdateToastProps) {
  const { t } = useTranslation();
  // Set by this tab's Reload click; read when the new worker takes control.
  const wantsReload = useRef(false);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const checker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (wantsReload.current) reload();
    },
    onRegisteredSW(_url, r) {
      registration.current = r;
      if (r === undefined || checker.current !== undefined) return;
      checker.current = setInterval(() => {
        if (navigator.onLine) void r.update();
      }, UPDATE_CHECK_MS);
    },
  });
  useEffect(
    () => () => {
      if (checker.current !== undefined) clearInterval(checker.current);
    },
    [],
  );

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const reloadThisTab = () => {
    wantsReload.current = true;
    const r = registration.current;
    if (r !== undefined && r.waiting === null) {
      // Another tab already activated the new worker: nothing to skip.
      reload();
      return;
    }
    // SKIP_WAITING; `controlling` then calls onNeedReload above.
    void updateServiceWorker();
  };

  const open = offlineReady || needRefresh;

  return (
    <div
      className="toast"
      aria-live="polite"
      aria-atomic="true"
      data-pwa-toast
      data-open={open ? 1 : 0}
    >
      {open && (
        <>
          <p className="toast__text">
            {needRefresh ? t("pwa.updateAvailable") : t("pwa.offlineReady")}
          </p>
          <div className="toast__actions">
            {needRefresh && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={reloadThisTab}
              >
                {t("pwa.reload")}
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={close}>
              {t("pwa.close")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
