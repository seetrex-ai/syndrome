# Vendored: Umami tracker

- **What:** `script.js`, the official Umami tracker as built and served by Umami Cloud at
  `https://cloud.umami.is/script.js`, downloaded 2026-10-19 (HTTP `last-modified: Sun, 18 Oct 2026
  03:25:02 GMT`). Not modified: byte for byte. Copied into Syndrome on 2026-10-19 from the brand
  site's copy (same sha256 for `script.js` and `LICENSE`).
- **Version:** built from `src/tracker/index.ts` of umami-software/umami **v3.4.0** (release
  2026-09-17). The last commit touching that file on `master` is the same as at `v3.4.0`
  (2026-09-11, "Support distinct ID tracker attribute"), and the build has the `distinct-id`
  attribute of that commit. The only build-time value is `__COLLECT_API_HOST__ =
  https://gateway.umami.is` (Umami Cloud's build), which `data-host-url` overrides.
- **sha256:** `91a876d767646fd5b7701b6fabf97f8a99ae53b94e7e5b58d465bad1e5d763e0` (4 810 bytes),
  pinned by `tests/intent/analytics-tracker.test.ts` and checked in the built `dist/` by
  `tools/deploy/check-prod.ts` (`TRACKER_SHA256` of `tools/deploy/umami-plugin.ts`).
- **Licence:** MIT, Copyright (c) 2022 Umami Software, Inc. — `LICENSE` here, copied from the
  `v3.4.0` tag (sha256 `d59f69c3a56253a150adfc42b41acd49e9024410ad087c58a23d506623258dfe`).
- **Attributes it reads** (checked in the v3.4.0 source): `data-website-id`, `data-host-url`,
  `data-domains`, `data-auto-track`, `data-auto-pageview`, `data-tag`, `data-exclude-search`,
  `data-exclude-hash`, `data-do-not-track`, `data-before-send`, `data-distinct-id`,
  `data-fetch-credentials`, `data-performance` (Syndrome sets the first three and
  `data-exclude-hash="true"`: the fragment carries puzzle masks), and on elements
  `data-umami-event` / `data-umami-event-*`. Storage: it only reads
  `localStorage["umami.disabled"]` (opt-out); it writes nothing.
- **How it is served (Syndrome):** not imported by the app. The Vite plugin
  `tools/deploy/umami-plugin.ts` (build only, and only when `VITE_UMAMI_WEBSITE_ID` is set)
  emits it as the asset `/syndrome/assets/umami-<hash>.js`, unchanged (sha256 measured equal in
  `dist/`), cached as immutable by `edge/_headers` and precached by the service worker, and
  prepends one classic `<script defer>` with its attributes to the `<head>` of `index.html`.
  Without the ID nothing is emitted or injected. `vendor/` is ignored by Prettier and ESLint.
- **Refresh:** download the new `script.js`, check the tracker source diff on GitHub, update the
  hash here, in `tools/deploy/umami-plugin.ts`, in `tests/intent/analytics-tracker.test.ts` and
  in `docs/decisiones.md` (the brand site refreshes its own copy the same way).
