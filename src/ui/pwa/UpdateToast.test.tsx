// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegisterSWOptions } from "virtual:pwa-register/react";
import i18n from "../../i18n";
import { UPDATE_CHECK_MS, UpdateToast } from "./UpdateToast";

// The virtual module of vite-plugin-pwa, replaced by a hook that does what
// workbox-window's registerSW does in `prompt` mode: `onOfflineReady` and
// `onNeedRefresh` flip the two states from outside React; `onRegisteredSW`
// hands over the registration; `onNeedReload` fires when the new worker takes
// control of this tab, whichever tab posted SKIP_WAITING.
// The test fires them as the service worker would (pre-set
// state hid an auto-mode toast that could never open).
const update = vi.fn(() => Promise.resolve());
const fire: {
  offlineReady?: () => void;
  needRefresh?: () => void;
  needReload?: () => void;
  registered?: (waiting: boolean, update?: () => Promise<void>) => void;
} = {};

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: RegisterSWOptions = {}) => {
    const [offlineReady, setOfflineReady] = useState(false);
    const [needRefresh, setNeedRefresh] = useState(false);
    fire.offlineReady = () => setOfflineReady(true);
    fire.needRefresh = () => setNeedRefresh(true);
    fire.needReload = () => options.onNeedReload?.();
    fire.registered = (waiting, update = () => Promise.resolve()) =>
      options.onRegisteredSW?.("/sw.js", {
        waiting: waiting ? ({} as ServiceWorker) : null,
        update,
      } as unknown as ServiceWorkerRegistration);
    return {
      offlineReady: [offlineReady, setOfflineReady],
      needRefresh: [needRefresh, setNeedRefresh],
      updateServiceWorker: update,
    };
  },
}));

afterEach(() => {
  cleanup();
  update.mockClear();
});

const region = (): HTMLElement =>
  document.querySelector("[data-pwa-toast]") as HTMLElement;

const reloadButton = () =>
  screen.getByRole("button", { name: i18n.t("pwa.reload") });

describe("UpdateToast", () => {
  it("mounts an empty, closed live region while the service worker has nothing to say", () => {
    render(<UpdateToast />);
    expect(region()).not.toBeNull();
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().getAttribute("data-open")).toBe("0");
    expect(region().textContent).toBe("");
    // The grid's verdict stays the only role="status" of the app (App.test).
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces offline readiness in the SAME live region and closes", () => {
    render(<UpdateToast />);
    const before = region();
    act(() => fire.offlineReady!());
    expect(region()).toBe(before);
    expect(region().getAttribute("data-open")).toBe("1");
    expect(region().textContent).toContain(i18n.t("pwa.offlineReady"));
    expect(
      screen.queryByRole("button", { name: i18n.t("pwa.reload") }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pwa.close") }));
    expect(region().getAttribute("data-open")).toBe("0");
    expect(region().textContent).toBe("");
  });

  it("Reload with a waiting worker posts SKIP_WAITING and reloads only once the new worker controls this tab", () => {
    const reload = vi.fn();
    render(<UpdateToast reload={reload} />);
    act(() => fire.registered!(true));
    act(() => fire.needRefresh!());
    expect(region().textContent).toContain(i18n.t("pwa.updateAvailable"));
    fireEvent.click(reloadButton());
    expect(update).toHaveBeenCalledTimes(1);
    // Not yet: the worker has not taken control.
    expect(reload).not.toHaveBeenCalled();
    act(() => fire.needReload!());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("another tab's Reload does NOT reload this tab: onNeedReload without a click here is ignored, the toast stays", () => {
    const reload = vi.fn();
    render(<UpdateToast reload={reload} />);
    act(() => fire.registered!(true));
    act(() => fire.needRefresh!());
    act(() => fire.needReload!());
    expect(reload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(region().getAttribute("data-open")).toBe("1");
    expect(region().textContent).toContain(i18n.t("pwa.updateAvailable"));
  });

  it("Reload after another tab activated the worker (nothing waiting) reloads this tab directly", () => {
    const reload = vi.fn();
    render(<UpdateToast reload={reload} />);
    act(() => fire.registered!(true));
    act(() => fire.needRefresh!());
    // The other tab's SKIP_WAITING: the worker took control here too.
    act(() => fire.needReload!());
    act(() => fire.registered!(false));
    fireEvent.click(reloadButton());
    expect(reload).toHaveBeenCalledTimes(1);
    // SKIP_WAITING has nobody to reach; it would never fire `controlling`.
    expect(update).not.toHaveBeenCalled();
  });

  it("asks the registration for a new build every hour while online, never offline, and stops on unmount", () => {
    vi.useFakeTimers();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    try {
      const check = vi.fn(() => Promise.resolve());
      const { unmount } = render(<UpdateToast />);
      act(() => fire.registered!(false, check));
      expect(UPDATE_CHECK_MS).toBe(3_600_000);
      vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
      expect(check).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(check).toHaveBeenCalledTimes(1);
      onLine.mockReturnValue(false);
      vi.advanceTimersByTime(UPDATE_CHECK_MS);
      expect(check).toHaveBeenCalledTimes(1);
      onLine.mockReturnValue(true);
      vi.advanceTimersByTime(UPDATE_CHECK_MS);
      expect(check).toHaveBeenCalledTimes(2);
      unmount();
      vi.advanceTimersByTime(3 * UPDATE_CHECK_MS);
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      onLine.mockRestore();
      vi.useRealTimers();
    }
  });

  it("close keeps the current build: no updateServiceWorker call, no reload", () => {
    const reload = vi.fn();
    render(<UpdateToast reload={reload} />);
    act(() => fire.registered!(true));
    act(() => fire.needRefresh!());
    fireEvent.click(screen.getByRole("button", { name: i18n.t("pwa.close") }));
    act(() => fire.needReload!());
    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(region().getAttribute("data-open")).toBe("0");
  });
});
