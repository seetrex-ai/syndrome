// Stand-in for `virtual:pwa-register/react` under Vitest (vite.config.ts,
// `test.alias`): vite-plugin-pwa serves that virtual module to the bundler,
// not to Node, so the UI tests that mount <App> get a hook with nothing to
// say (the options, `onNeedReload` included, are accepted and never fired).
// UpdateToast.test.tsx mocks the module itself to drive every callback.
import { useState } from "react";
import type { RegisterSWOptions } from "virtual:pwa-register/react";

export function useRegisterSW(options: RegisterSWOptions = {}) {
  void options;
  const offlineReady = useState(false);
  const needRefresh = useState(false);
  return {
    offlineReady,
    needRefresh,
    updateServiceWorker: () => Promise.resolve(),
  };
}
