// Vitest setup (vite.config.ts `setupFiles`): testing-library's async
// utilities wait 4 s instead of 1 s. The deferred panels (chart, viewer) are
// `lazy` imports that the suite's 97 parallel workers can starve past one
// second (measured 2026-10-18: video-hooks and video-camera red under the
// commit guard, green alone). The per-test timeout of Vitest (5 s) still
// bounds every wait.
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 4000 });
