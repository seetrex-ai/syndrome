# Syndrome by SEEQuant

An interactive visualizer and game about **quantum error correction** with the rotated
surface code, in the browser. Nothing to install, works on a phone, makes sense in 30
seconds.

The one message it exists to make tangible is the one Google demonstrated with Willow
(Nature, Dec. 2024): **adding more qubits makes the logical error rate go down**, as long
as the hardware is below the threshold.

> "Syndrome" is the technical term for the signature an error leaves in an
> error-correcting code.

**Live app:** [seequant.app/syndrome](https://seequant.app/syndrome/) (English;
Spanish at [seequant.app/syndrome/es/](https://seequant.app/syndrome/es/)).

## Status

Phases 1 (prototype) and 2 (shareable version) are complete and deployed at
[seequant.app/syndrome](https://seequant.app/syndrome/). Phase 1: the rotated surface
code lattice (`src/core/lattice/`), the seeded noise model (`src/core/noise/`), the exact
MWPM decoder (`src/core/decoder/`), the Monte Carlo statistics (`src/core/sim/`), the
interactive grid, the step-by-step mode, the Web Worker and the threshold chart, in
English and Spanish, mobile first. Phase 2: the phenomenological noise model, the chart by
model, the isometric spacetime viewer, the challenge mode, the in-context explanations, a
light/dark/auto theme, animations that respect `prefers-reduced-motion`, an OpenGraph card
and a PWA that works offline after the first visit, plus a deterministic video script
(`npm run video`, see [Video](#video)) that ships nothing to the app.

Both noise models are validated against PyMatching (and, for the phenomenological model,
checked against Stim): the report in `docs/validacion.md` passes with |z| ≤ 3 on every
point, Σz² < 43, and every minimum weight equal to the reference's. See
[Reproducing the validation](#reproducing-the-validation).

## Specification

The physics conventions, requirements, validation criteria and performance targets are in
[`docs/spec.md`](docs/spec.md) (in Spanish). Its sections keep the numbering §1–§8 that
the code cites as `docs/spec.md §N`.

Comments cite internal design notes and the decision log by decision id; they are not
published. The rules they justify are in `docs/spec.md` and in the tests' docstrings.

## Reproducing the validation

Requires Node 24 (`.nvmrc`); the reference side also needs [uv](https://docs.astral.sh/uv/).

```sh
npm ci && npm test && npm run validate
```

`npm run validate` reruns the TypeScript core on both validation grids and compares it
with the committed PyMatching reference (details in [Running it](#running-it)). To
regenerate the reference itself:

```sh
uv run tools/reference/run.py                            # independent X/Z noise
uv run tools/reference/run.py --model phenomenological   # phenomenological noise
```

## Interface

One page, five panels, two shared values: the distance `d` (3, 5, 7, 9) and the physical
error probability `p` (slider, 0–20 %); the spacetime viewer has a `p` of its own.

**Look and controls** (2026-10-18). The first screen is the
SEEQuant brand bar (the brand mark and "SEEQuant" to the brand's home, "Products ▾" with the
Syndrome pages, Lab, Classroom, About and the "EN ES" language switch; a "Menu" button below
900 px), then Syndrome's header (the name "Syndrome" and the theme), the
tagline and the threshold chart with the two Λ tiles; the lattice and the walkthroughs
follow. A section nav (`src/ui/nav/`, the five panel headings as in-page links to
`#panel-chart` … `#panel-challenge`, `aria-current` on the section in view, re-observed
when a deferred panel replaces its skeleton) sits between the hero and the lattice: a
scrollable row on a phone, a bar stuck to the top of the viewport from 640 px whose
measured height goes to `--nav-height` on `<html>` (`scroll-padding-top`: an anchor
jump or a focused control never lands under it); the chart's Suspense skeleton reserves
the loaded panel's height so nothing below it jumps when the chunk arrives. Palette
"Tinta y vino": warm paper / deep ink as `--bg`, panels as `--surface` cards from 640 px
with the figures (chart, lattice, viewer) on `--bg` inside them, a wine accent in light
and a plum one in dark (`--accent`: Λ figures, slider fill, the current nav link, the
brand's Z plaquettes) and `--ink` for the selected segment, the primary button and the
"?" disc; every colour is a `light-dark()` token (`src/index.css`, `src/ui/*/**.css`),
every text token pinned on both `--bg` and `--surface` by `tests/intent/theme-contrast`,
the display face is a self-hosted Space Grotesk subset (`public/fonts/`, SIL OFL). No
native `<select>`, `<details>` or visible radio:
`src/ui/controls/` has `SegmentedControl` (a fieldset of visually hidden radios: Tab into
the group, arrows between options), `Slider` (a native range with the track filled up to
the thumb), `Disclosure` (`button[aria-expanded]` + a body that stays in the DOM) and
`Clamp` (an intro cut to two lines with a "Show more" toggle, aria-only, shown only when
the text overflows); buttons are `.btn` with `--primary`, `--ghost` and `--chip`
variants, the step lists a `.stepper`. The chart shades the sub-threshold region up to
the crossing of the two smallest distances and marks each crossing (`crossingOf` in
`src/ui/chart/curves.ts`); defects pop in and chains draw themselves on a step change
(≤ 400 ms, all off under `prefers-reduced-motion`). The favicon, the PWA icons and
`og.png` are the brand mark in the tokens (`tools/og/`).

- **Surface code** (`src/ui/grid/`): the lattice as SVG. Data qubits are the circles,
  plaquettes the squares (Z, blue: detect X errors) and (X, orange: detect Z errors), the
  weight-2 stabilizers the half discs on the edges. Tap a qubit to toggle an X error;
  hold it, or Shift+click, to toggle a Z (both make a Y). "Random errors" draws a shot at
  `p`. Every change is decoded at once: flipped stabilizers light up as defects, the
  matching is drawn as dashed edges and the correction as chains; the verdict line says
  whether the residual (error · correction) is a stabilizer or a logical X, Z or Y.
- **Step by step** (`src/ui/steps/`): one random shot replayed in five layers (errors →
  defects → matching → correction → verdict) with play, pause, back and repeat. The panel
  mounts on a random shot and draws a new one on a new distance; the shot is decoded
  once and the steps only choose which layers are drawn.
- **Space and time** (`src/ui/spacetime/`, loaded lazily): the phenomenological model
  made visible. One shot of `d` noisy cycles plus the perfect final readout is drawn as
  an isometric stack (cycle 1 at the back, the final readout in front, opaque) and
  replayed in six steps: errors (the accumulated error per layer, a ring on the new ones,
  a cross on a misread plaquette) → readings (what each stabilizer read: the neighbours
  of a data error stay lit until the final readout, a misread lights one layer) →
  detectors (a reading that differs from the cycle before: a data error once, a misread
  twice, a cycle apart) → matching (space edges within a layer, time edges between
  layers) → correction (on the final plane, each qubit flipped as many times as space
  edges cross it: an even number leaves it unchanged) → verdict. Three presets isolate the mechanisms (one measurement failure, one data error,
  both), "new random shot" draws one at the viewer's own `p` (default 1 %; the app's `d`),
  two views turn the board a quarter turn and a slider spreads the layers (both kept in
  `localStorage`). A shot is shared as `#v=f<d>.<mask>` with the whole history
  (`d·(2n + 2m)` bits in base64url: 13 / 62 / 171 / 363 characters), never a seed; a
  textual list under the figure gives the counts per layer for screen readers. The shot
  is decoded once (`decodeSpacetimeHistory` of the core, the shot's own code path) and the
  steps only choose what is drawn. DOM hooks (the contract of the video script and the
  tests): `section.panel--spacetime[data-step][data-view][data-gap][data-verdict]
  [data-from-link][data-distance]`, `svg[data-distance][data-view][data-gap]`; one plane
  `[role="img"][data-layer=ℓ]` per layer with its readings
  (`[data-plaquette][data-type][data-measured]`) and its qubits at rest
  (`[data-qubit][data-row][data-col][data-rest="1"]`, no history); the whole story in
  `[data-overlay]`, painted in two passes so that no opaque defect hides a mark of
  another layer: first the defects of every layer, `[data-overlay] > [data-defects] >
  [data-layer=ℓ] > [data-defect][data-type][data-plaquette]`, then one group per layer
  `[data-overlay] > [data-layer=ℓ]` with, in this order, `[data-flip][data-type]
  [data-plaquette]`, `[data-qubit][data-pauli][data-new][data-correction][data-residual]`
  (the last two non-`I` on the final plane only) and `[data-between=ℓ] >
  [data-edge="space"|"time"][data-type="X"|"Z"]`; the step list
  `.spacetime__steps [data-done="0"|"1"]` with `aria-current="step"` on the current one;
  `[data-layer-summary]` per layer under the figure, `.spacetime__verdict[data-verdict]`,
  the three `[data-preset]` buttons and the buttons by accessible name
  (`spacetime.prev/next/play/pause/restart/newShot/copy`).
- **Challenge** (`src/ui/challenge/`): you are the decoder. A random error at the
  distance's level `p` is drawn, you see its defects (never the errors) and draw a
  correction against the clock: tap for an X flip, hold or Shift+click for a Z. Any
  correction whose residual (error · correction) is a stabilizer is accepted, not only
  the decoder's; a bonus if your flips per type match the decoder's weight; points
  `10·d (+5·d)` times a streak multiplier, with best, streak and puzzles played kept in
  `localStorage`. After the verdict the decoder's matching and chains are overlaid. A
  puzzle is shared as a link, `#c=i<d>.<mask>` with the `2·d²` error bits in base64url
  (≤ 27 characters), or as a PNG of the grid; opening a link (at load or pasted into the
  open page) shows that puzzle with a Start button and the clock begins with that gesture,
  outside your streak; a link whose error leaves no defect is rejected. A forfeit (time up
  or give up) reads as failed, with no bonus or points, even when the flips were valid, and
  so does abandoning a puzzle (reloading the page or pasting a link mid-game: streak 0, one
  more played); when the decoder itself fails a puzzle, the panel says so instead of calling
  its correction lighter. Clock, level `p`, announcement times and points live in one block
  of `score.ts`.
- **Logical error rate** (`src/ui/chart/`): `P_L` against `p` for d = 3, 5, 7 on a log
  axis with 95 % Wilson intervals; a point with no failure is an open marker at its
  upper bound. A selector picks the noise model: **perfect measurements** (the phase 1
  model: independent X/Z errors, one cycle; axis 0–20 %) or **measurement failures**
  (the phenomenological model: each stabilizer measurement also fails with probability
  `p`, d cycles, perfect final readout; axis 0–5 %, stretched to the user's `p` beyond
  it). The curves start from the validated base of that model
  (`docs/validacion/browser.json` or `browser-phenomenological.json`, the files
  `npm run validate` compares with PyMatching) and are refined live by a Web Worker
  (`src/worker/`) that samples the 24 grid points of the model round-robin plus a lane
  at the user's `p`; the table gives live shots and shots/s per distance, and Λ =
  `P_L(d) / P_L(d + 2)` at the user's `p` with its propagated interval. The noise model
  is always named in the caption. Switching models moves `p` to that model's default
  once (5 % and 1 %, both below the measured crossings, so the first view shows Λ > 1)
  and the slider stays free afterwards; the choice is kept in `localStorage`. The
  lattice, the walkthrough and the challenge stay in the one-cycle model.

- **In-context explanations** (`src/ui/explain/`): a row of "?" buttons under the lattice
  (data qubit, stabilizer, Y error, matching, distance), under the walkthrough
  (perfect measurements, matching, why this verdict) and under the chart (threshold,
  Λ, why a log axis, open markers, and measurement failures under that model). Each
  opens a paragraph of at most 320 characters; one open per row, Escape closes it. Each
  verifiable claim is tied to a predicate enumerated against the core
  (`tests/intent/explanations.test.ts`: odd parity ⇔ defect, Blossom = exact minimum and
  fewest flips, no logical operator below weight d, Y = X·Z, the row/column verdict
  rule, the order and crossing of the validated curves of both models, Λ as the ratio of
  the two rates, the 95 % bound ≈ 4/N of a point with no failure, one measurement flip
  = two defects a cycle apart and one data error = its syndrome in its cycle); the
  wording itself is checked by reading it, not by the test. The other texts are
  definitions. Adding an explanation = an id in
  `src/ui/explain/ids.ts`, `explain.<id>.{title, body}` in every locale and, when the
  text is verifiable, a predicate in that test.

Everything the panels show is computed by `src/core/`, the same code the validation
runs in Node; the UI never adjusts a number.

Around the panels (phase 2):

- **Theme** (`src/ui/theme/`): a three-state control in the header, auto (the OS),
  light, dark. Every colour is a CSS token written as `light-dark(light, dark)` in a
  `:root` block of its stylesheet, and `<html data-theme>` picks the side through
  `color-scheme`; the choice is kept in `localStorage` (`syndrome.theme`) and applied
  by a three-line inline script in `index.html` before the first paint, the one script
  outside React. `tests/intent/theme-tokens.test.ts` fails on any literal colour outside
  a token block or on a token with one side only.
- **Motion**: matching edges, chains and defects fade in; every transition and
  animation is cancelled under `prefers-reduced-motion: reduce`, sheet by sheet
  (`tests/intent/reduced-motion.test.ts` derives the list from the CSS).
- **Sharing**: `index.html` carries the OpenGraph and Twitter card tags; the card
  image is `public/og.png` (1200 × 630, English): `node tools/og/og-svg.ts` writes
  `tools/og/og.svg` (a d = 5 grid with two X errors, their defects, the matching edge
  and the chain, in the light palette read from the stylesheets) and the PNG is a
  Chromium screenshot of it at 1200 × 630; `tests/intent/opengraph.test.ts` reads its
  size from the PNG header.
- **Offline** (`src/ui/pwa/`, `vite.config.ts`): `vite-plugin-pwa` generates a service
  worker that precaches the whole build, the deferred chunks and the simulation Worker
  included, so after the first visit the grid, the walkthrough, the viewer and the chart
  work without network. A new build is installed on the next visit and **waits**
  (`registerType: "prompt"`): a toast says a new version is available and its Reload
  button switches this tab to it. The new worker then controls every open tab, but only
  the tab that clicked reloads: the others keep their state (and their toast) and reload
  when their own user clicks Reload (the library's default would have reloaded them all;
  `UpdateToast` passes `onNeedReload` and reloads only after its own click, or directly
  when another tab already activated the worker). `tests/intent/pwa-precache.test.ts` builds the site and
  checks every `assets/*.js|css` is in the precache list, the navigate fallback is a
  real route, the worker never skips waiting on its own, and the manifest has the 192
  and 512 icons. The app lives under `/syndrome/` of a domain it shares with the
  brand site, so the manifest's `id`, `start_url` and `scope`, the service worker's
  scope and its navigate fallback are all `/syndrome/` (the same test checks that no
  URL of `index.html` or of a stylesheet escapes it). `edge/_headers` (copied to
  `dist/_headers` by the build) tells Cloudflare not to cache `sw.js` and the
  manifest.

## Running it

Requires Node 24 (see `.nvmrc`).

```sh
npm install
npm run dev        # local dev server at http://localhost:5173/syndrome/
npm test           # Vitest, non-interactive (unit + property tests)
npm run lint       # ESLint + Prettier --check
npm run typecheck  # tsc -b (core, app and node projects)
npm run bench      # shots per second of the core in Node, per distance and p
npm run validate   # core on the validation grid + statistical comparison with PyMatching
npm run build      # production build in dist/syndrome/ + dist/_headers (includes typecheck)
npm run preview    # serves the build at http://localhost:4173/syndrome/
npm run format     # Prettier --write
npm run deploy     # build + wrangler deploy to Cloudflare (needs `npx wrangler login`)
uv run tools/reference/run.py   # regenerates docs/validacion/{reference,min-weights}.json
uv run tools/reference/run.py --model phenomenological   # …/{reference,min-weights,verdicts}-phenomenological.json
```

`npm run bench` runs `tools/bench/decoder.bench.ts` (Vitest benchmark mode): one
iteration is one Monte Carlo shot, so the `hz` column is shots per second and `mean` is
milliseconds per shot; it also prints the number of GC events during 10⁵ shots at d = 9.

`npm run validate` (`tools/validate/`, run with `tsx`, ≈ 20 s on a laptop) simulates the
validation grid (d ∈ {3, 5, 7}, eight values of p, ≥ 100 failures and ≥ 10⁵ shots per
point) with the TypeScript core, writes `docs/validacion/browser.json` (the precomputed
base curves of the app; deterministic, byte-identical across machines) and compares it
with `docs/validacion/reference.json`, generated by `uv run tools/reference/run.py` with
PyMatching 2.4.0 and the same integer weights: |z| ≤ 3 on every point, Σz² < 43 over the
24 points, the reference against the exact d = 3 enumeration, the 10⁴ minimum weights of
`min-weights.json` equal to the decoder's, the geometry and weight tables of both files
equal to the core's, and the internal consistency of every point of both files with its
own counts (estimate, Wilson intervals, X/Z detail, upper-bound flag, and the stop rule
the file declares: the JSON files are regenerated, never edited). The curve crossing is
reported but is not a gate. It prints the table and writes `docs/validacion.md`
(Spanish). Exit code 1 on any failing gate or bad input: the curves are never adjusted,
the simulation is fixed.

The same command validates the **phenomenological model** (phase 2: `cycles = d` noisy
cycles with measurement flips at `q = p`, a perfect final readout, MWPM on the
spacetime graph with the integer weights indexed by edge): grid `d ∈ {3, 5, 7}`,
`p ∈ {0.005, …, 0.04}`, same stop rule (≈ 5.5 min on a laptop; `d = 7, p = 0.005` stops
by failures after ≈ 5·10⁵ shots), files `browser-phenomenological.json` against
`reference-phenomenological.json`, generated by `uv run tools/reference/run.py --model
phenomenological` (PyMatching on the same explicit spacetime graph; Stim is used only
to check that the graph is the detector error model of a circuit written from the text
and that the two samplers agree). Gates added for this model: the exact enumeration of
the one-cycle model (`exactProbe`: the 2¹³ patterns of d = 3 give the same failure
table on both sides, and three Monte Carlo points of the reference match the exact
curve), the 10⁴ spacetime minimum weights of `min-weights-phenomenological.json`, and
`verdicts-phenomenological.json`: 10⁴ sampled syndromes whose minimum weight the core
must equal in every case and whose logical parity it must equal in at least 9 995 (a
tie between two minimum matchings of different parity is possible here; every
mismatch is listed). The phase 1 files are never regenerated by this (their sha256 is
pinned in the tests). Flags (after `--`):

- `--model independent|phenomenological|all`: which model(s) to simulate and compare
  (default `all`; the document then has one section per model).
- `--compare-only`: skip the simulation, compare the committed `browser*.json`.
- `--no-docs`: do not write `docs/validacion.md` (what CI does).
- `--seed N`: base seed of the simulation (decimal integer in [0, 2⁵²); default
  20261016; not allowed with `--compare-only`).
- `--out DIR`: directory of the JSON files (default `docs/validacion`).
- `--docs FILE`: path of the report (default `docs/validacion.md`; its directory must
  exist).

Inputs are checked before the grid is simulated. The `validate` workflow repeats the run
in CI on every push that touches `src/core/`, `tools/validate/`, `docs/validacion/`,
`package*.json`, `.nvmrc` or the workflow itself, as a matrix with one job per model
(`independent`, `phenomenological`), and requires the regenerated `browser*.json` of
each job to have no diff.

### Video

`npm run video` (`tools/video/`, run with `tsx`) renders the explainer video from the
built app, deterministically: the same `dist/`, the same browser and the same
`tools/video/scenes.ts` give byte-identical PNG frames (sha256 in each `manifest.json`)
and a byte-identical MP4. Scenes: title card → the step-by-step walkthrough (d = 3, a
fixed shot) → the spacetime viewer (d = 3, the preset with one data error and one
measurement failure) → the logical error rate chart in both noise models (validated base
curves only; the simulation Worker is removed, so nothing refines live) → closing card.
Every text on screen is the app's own (`src/locales/<lang>.json`); the script adds no
captions, music or narration. ≈ 52 s, 30 fps, 1920 × 1080 and 1080 × 1920, in English and
Spanish, light theme.

Requirements: `npm run build` first (the script never builds; it serves
`dist/syndrome/` under `/syndrome/` from inside the browser context, no server, no port), Google Chrome or Microsoft Edge installed
(or `npx playwright install chromium`; `playwright` is a devDependency without browsers),
and `ffmpeg` with `ffprobe` on `PATH` (or `FFMPEG=/path/to/ffmpeg`). Outputs go to
`out/video/` (git-ignored): `syndrome-<lang>-<16x9|9x16>.{mp4,webm}` and, per variant,
`<lang>-<format>/{frames/NNNN.png, list.txt, manifest.json}`. Flags (after `--`):

- `--lang en|es|all`, `--format landscape|portrait|all` (default `all`).
- `--dry`: no browser, no ffmpeg; checks the scenes against the core and prints the
  states, their durations and the total.
- `--frames-only`: capture and write `list.txt` / `manifest.json`, no encoding.
- `--allow-console-errors`: record a console or page error in the manifest instead of
  failing the variant (the default fails, from the first byte of the app on).
- `--scene ID`: only that scene (to adjust `tools/video/camera.css`).
- `--out DIR` (default `out/video`), `--fps N` (30), `--browser chrome|msedge|chromium`.

The DOM hooks the script uses (`tools/video/hooks.ts`) are checked against the rendered
panels in both languages by `tests/intent/video-hooks.test.tsx`, and every selector of
`tools/video/camera.css` (and of `card.html`) against the panel it targets by
`tests/intent/video-camera.test.tsx`; the zero impact on the
bundle and the validity of the scenes by `tests/intent/video-conventions.test.ts`. The
browser smoke test (two captures, identical frames) runs only with `VIDEO_SMOKE=1 npm
test`.

## Deploying

The app is served at `https://seequant.app/syndrome/` by the Cloudflare Worker
`syndrome` (`wrangler.jsonc`). Every SEEQuant app lives under a path of the brand domain,
one repo and one Worker per app; the brand site (another repo) owns the rest of
`seequant.app`.

- **Static assets first, by full path.** Vite builds with `base: "/syndrome/"` into
  `dist/syndrome/`, and `tools/deploy/stage.ts` (the last step of `npm run build`) leaves
  `dist/` with exactly `syndrome/` and `_headers` (from `edge/_headers`). Cloudflare's
  asset server answers `/syndrome/…` directly; nothing strips a prefix.
- **The Worker (`edge/worker.ts`) only sees what has no asset:** `/syndrome` without its
  slash (301 to `/syndrome/`), unknown paths (404) and the old origin.
- **Two routes:** `seequant.app/syndrome*` (the app) and the custom domain
  `syndrome.seequant.app`. The token needs **Workers Routes: Edit** on the zone
  `seequant.app` besides Workers Scripts: Edit.
- **The root belongs to the brand site.** Everything else on `seequant.app`, `/`
  included, is served by the brand site's Worker (`seequant.app/*`, another repo). The
  most specific route pattern wins, so this repo must never add a route outside
  `/syndrome`. Until 2026-10-20 the root gave a provisional `302` to `/syndrome/`.
- **The old origin.** Every request to `syndrome.seequant.app` answers `301` to the same
  path and query under `https://seequant.app/syndrome/` (challenge links keep their
  puzzle: it lives in the `#fragment`, which browsers carry across the redirect). Its
  `/sw.js` answers `200` with a service worker that deletes the old caches, unregisters
  itself and reloads its windows, which then follow the redirect: a PWA installed on
  the old origin is not stranded, but it has to be reinstalled, and what it kept in
  `localStorage` (language, theme, challenge record) stays behind on the old origin.
  A path already under the base (`/syndrome`, `/syndrome/…`) moves to the same path on
  `https://seequant.app`, never `/syndrome/syndrome/…`. Accepted gap: static assets win
  before the Worker on every host, so a `/syndrome/…` path that is an asset
  (`/syndrome/`, `/syndrome/assets/…`, `/syndrome/sw.js`…) is still served as the app
  from the old origin, not redirected; closing it would need `run_worker_first` for all
  assets (one Worker invocation per asset request).

Pushes to `main` deploy to production and other branches get a preview URL, both from
GitHub Actions once the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets
exist. Locally, after `npx wrangler login`:

```sh
npm run deploy     # build + stage dist/ + wrangler deploy
npm run deploy -- --var LEGACY_STATUS:302   # first move only: the old origin answers
                                            # 302 everywhere and leaves its service worker
                                            # alone, until the new location is measured
npx wrangler deploy --dry-run --outdir <dir>   # bundle the Worker without uploading
```

**Release order for the move to `/syndrome/`.** CI's production step runs a plain
`wrangler deploy`, which is phase 2 (301s and the retiring service worker). So the move
is released locally first: merge to `main` locally, deploy phase 1 from `main`
(`npm run deploy -- --var LEGACY_STATUS:302`) and measure the new location, deploy
phase 2 (`npm run deploy`) and measure the old origin, and only then push `main`; CI
then redeploys the identical configuration. Pushing first would skip phase 1.

## Analytics

Cookieless page views and events with [Umami](https://umami.is) Cloud, shared with the
brand site. The tracker is vendored byte for byte in
`vendor/umami/` (sha256 pinned by a test) and served by the app itself; nothing is
counted unless the build has a website ID.

- **`VITE_UMAMI_WEBSITE_ID`** (public, not a secret): with it, `npm run build` emits
  `assets/umami-<hash>.js` and adds one `<script defer>` to `index.html` with
  `data-domains="seequant.app"` (localhost, previews and the old host never count) and
  `data-exclude-hash="true"` (the `#fragment` carries puzzle masks and is never sent).
  Without it nothing is injected. A value that is not a UUID fails the build. `npm run dev`
  never injects it. In CI it is the repo variable `vars.VITE_UMAMI_WEBSITE_ID` of the
  deploy job; locally, `.env.production.local`.
- **`UMAMI_READY`** in `tools/deploy/accounts.ts`: `true` since 2026-10-19 (the Umami
  account exists); setting it to `false` accepts production without analytics.
- **The production gate:** `npm run check:prod` reports; `-- --production` blocks (exit 1)
  a `dist/` that does not match the state: `UMAMI_READY = true` without the ID, an ID that
  is not a UUID, a build whose counter is missing, duplicated, carries another ID or is
  not the pinned tracker, or a counter in a build without the ID. `npm run deploy` and
  CI's production step run it before `wrangler deploy`.
- **To turn it on:** create the repo variable `VITE_UMAMI_WEBSITE_ID` (the brand site's
  website ID) and, in the same push, set `UMAMI_READY = true`. To check locally:
  `VITE_UMAMI_WEBSITE_ID=<id> npm run build && npm run check:prod -- --production`.

## Adding a language

1. Copy `src/locales/en.json` to `src/locales/<code>.json` and translate every value.
2. Import it in `src/locales/index.ts` and add it to the `LOCALES` map. The language
   list and the i18next resources are derived from that map.
3. Give it its own URL: add `<code>: "<code>/"` to `LANGUAGE_DIRS` in `edge/paths.ts`
   and the same entry to its copy, `LANGUAGE_PATHS` in `src/locale-path.ts` (the client
   may not import from outside `src/`; a test keeps the two equal). The build then
   writes `dist/syndrome/<code>/index.html`, the service worker precaches it, and the
   edge Worker redirects `/syndrome/<code>` to `/syndrome/<code>/`. Add
   `"/syndrome/<code>"` to `run_worker_first` in `wrangler.jsonc` (the test lists the
   exact array it expects) and the language to the table check of
   `tests/intent/path-routing.test.ts`.
4. Add its OpenGraph locale (`xx_YY`) to `OG_LOCALE` in `tools/seo/locale-pages.ts`.
5. Translate `meta.title` (at most 65 characters, with "Syndrome" and "SEEQuant"),
   `meta.description` (70–155 characters) and `meta.about` (the summary shown without
   JavaScript): they become that page's `<title>`, description, OpenGraph tags and
   JSON-LD, and every page lists every language in its `hreflang` links.

Each language has one indexable URL: English at `/syndrome/` (also the `x-default`),
Spanish at `/syndrome/es/`. The path decides the language; at `/syndrome/` the stored
choice decides, then the browser language, and the page never redirects. The language
selector stores the choice and moves the URL to that language's page with
`history.replaceState`, without reloading (the puzzle, the chart and the `#…` fragment
stay).

Plural forms use i18next's CLDR suffixes (`key_one`, `key_other`, and `key_many` where
the language has it); `npm test` checks that each language has exactly the plural
categories `Intl.PluralRules` gives for it.

`npm test` fails if a locale file is missing a key, has an empty value, uses different
`{{placeholders}}` than English, has the wrong plural forms (`_zero` is optional), or is
not in `LOCALES`; if a language in `LOCALES` is not loaded into i18next or detection is
disabled; and if any `.ts` or `.tsx` file under `src/ui/` (tests excluded) contains a
string literal with letters outside the positions the detector knows are not visible:
arguments of `t()`, non-visible attributes of native elements (`className`, `type`…;
`children`, `dangerouslySetInnerHTML`, `download` and the `aria-*` names are visible;
`value` and `defaultValue` are visible on `input` and `textarea` unless `type` is
literally `hidden`, `checkbox`, `radio`, `range`, `color` or `file`, and data on
`button` (its caption is its children), `option` and the rest), the plumbing props of
our own components (`key`, `ref`, `className`, `id`, `htmlFor`, `role`, `lang`, `dir`,
`href`, `src`, `rel`, `target`, `data-*`, `aria-hidden`, `i18nKey`; any other prop
with letters, `value` or `variant` included, is reported), comparison operands, lookup
keys, type positions, module specifiers (static `import` / `export` and `import()`),
tags, that is literals whose declared type resolves to an alias in the test's
`TAG_TYPES` list (`Layer`, `Step`, `PauliName`, `StabilizerType`,
`GridAction["type"]`, `StepAction["type"]`, each with its reason; the alias must be
exactly the one declared in the file the list names, matched by declaration, so a
local alias that only shares the name exempts nothing: `layers.has("errors")`,
`dispatch({ type: "toggleX" })`, `new Set<Layer>([...])`, `useState<Layer>("errors")`
and its setter, a `readonly Layer[]`, a `Layer`-typed prop, variable, return or
assignment, and an inline union of listed aliases only (`Layer | StabilizerType`);
the literal must be a value of the alias (`const a: Layer = "A20 Hello"` is reported,
`@ts-expect-error` or not); any other union of literals is reported, named or not; a
parameter whose declared type is a type parameter of the signature never exempts
unless the type argument is explicit, so `id("…")`, `useDeferredValue("…")` and
`Object.freeze({…})` are reported; `as` / `satisfies` do not count; a new alias is
added to the list by hand, with its file and its reason), and direct
arguments of a short white list of callees (`toLocaleString`, `Intl.*`,
`classList.*`, `addEventListener`, `Error` / `RangeError` / `TypeError`, `console.*`,
`matchMedia`, `querySelector*`, and the first argument of `getAttribute` /
`setAttribute` / `localStorage.*Item`). The argument of any other call is reported:
`String("…")`, `useState("…")`, `setLabel("…")`, `[x].concat("…")`, `fmt("…")`.
Literals built inside callbacks such as `.map()`, `ref` or `onClick`
(`el.textContent = "…"`, `document.title = "…"`) are checked: the attribute's name only
exempts a value handed to it directly. HTML entities do not count as letters. A
presentation constant with letters (a CSS class list, a hex colour) is reported too;
exempt it on purpose with a trailing or preceding comment `// i18n-exempt: <reason>`
(the reason is mandatory, a bare marker still reports).

`npm test` also fails if a `t()` / `i18n.t()` call or a `<Trans i18nKey>` in `src/ui/`
names a key that is not a leaf of `en.json` (plural suffixes count as their base key),
uses a template other than `` `branch.${x}` `` with an existing branch, passes a key
that cannot be checked statically (a variable, no argument), or carries a
`defaultValue`: a fallback text in a component is text outside i18n.

## Core API

Everything in `src/core/` is pure TypeScript, re-exported from `src/core/index.ts`.
The lattice module (`src/core/lattice/`) is the geometry everything else builds on:

- `Pauli` is `{ n, x: Uint8Array, z: Uint8Array }`, one 0/1 byte per qubit and
  component (`Y` = both), phases ignored; `ReadonlyPauli` is the same shape with
  `Readonly<Uint8Array>` masks, which is what every reader accepts and what the code's
  shared operators expose (an index write into them is a type error). `identity`,
  `pauliFrom` (set semantics), `copyPauli` (editable copy), `clearPauli`,
  `multiplyInto(out, a, b)` (XOR, `out` may alias), `commutes`, `weight`, `pauliEquals`.
- Coordinates: `qubitIndex(d, row, col)` / `qubitRowCol(d, q)` are inverses;
  `plaquetteType(i, j)` is the colouring rule; `incidentStabilizers(code, type, q)` gives
  the one or two stabilizers of that type on a qubit (`-1` for none).
- `rotatedSurfaceCode(d)` builds the rotated surface code of odd distance `d ≥ 3`:
  `d²` data qubits (`q = row·d + col`, row 0 at the top, col 0 on the left) and `d² − 1`
  stabilizers. Plaquette `(i, j)` of the board extended by one row and column on each
  side is type Z when `i + j` is even and X when odd; the extended rows carry only the
  X-type plaquettes (weight 2, `boundary: "top" | "bottom"`), the extended columns only
  the Z-type ones (`"left" | "right"`), and the corners do not exist. Stabilizers are
  indexed Z block first, then X block, each in row-major order of `(i, j)`; this order
  and the qubit index are a contract with the Python reference and the validation
  fixtures (`tests/intent/lattice-conventions.test.ts`). `logicalX` is X on column 0,
  `logicalZ` is Z on row 0; `logicalXOnColumn` / `logicalZOnRow` give the equivalent
  representatives. `supportOffsets` / `supportQubits` (CSR) and `checksOfQubit` (the
  one or two stabilizers of each type on every qubit, `-1` for the boundary) are the
  hot-path tables the syndrome and the defect graph use.
- `computeSyndrome(code, error, out)` and `computeTypeSyndrome(code, type, error, out)`
  write into the caller's `Uint8Array` and return it (no allocation per call);
  `logicalEffect(code, residual)` gives `{ x, z }` for a residual with null syndrome
  (`x`: anticommutes with `Z_L`); `isStabilizerEquivalent(code, p, scratch?)` is the
  challenge mode's acceptance test (`scratch` is an optional `d² − 1` syndrome buffer).
  The shared tables of a code (`logicalX`, `logicalZ`, each `operator`, the CSR and
  `checksOfQubit` arrays) are read-only: copy before editing.

The noise module (`src/core/noise/`) draws the errors of a shot:

- `createRng(seed)` is a seeded `xoshiro128**` (`nextUint32()`, `nextFloat()`), seeded
  through `splitmix64`; the same seed always gives the same sequence.
- `independentNoise(p)` is the phase-1 model (independent X and Z with probability `p`
  each, perfect measurements); `sampleNoise(noise, rng, out)` fills every entry of the
  caller's `Pauli` and returns it.
- `phenomenologicalNoise(p, cycles)` is the phase-2 model: `cycles` noisy cycles
  (`cycles = d` by default), each with independent X/Z data errors at `p` and a flip of
  every stabilizer outcome with probability `q = p`, then a perfect final readout of
  the data qubits. `sampleCycleNoise(noise, rng, code, out, flips)` draws ONE cycle:
  the `2n` data draws exactly as `sampleNoise`, then `m` flips of the Z checks, then
  `m` of the X checks (this order is the contract that makes the published curves
  reproducible). `NoiseModel` is the union of both, discriminated by `kind`.
- `splitmix64`, `splitmix64Step`, `uniform53` are the mixer shared bit for bit with the
  Python reference.

The decoder module (`src/core/decoder/`) is an exact minimum-weight perfect matching
decoder, one per stabilizer type:

- `qubitWeight(q)` / `qubitWeights(n)` are the generic integer weights `W_q` shared with
  PyMatching (`WEIGHT_SEED`, `WEIGHT_SCALE`, `WEIGHT_EPSILON_DENOMINATOR`,
  `MAX_EDGE_WEIGHT`); `qubitWeightReal` is the real-valued form of the spec, for
  documentation only. `edgeWeight(e)` is the same formula over an edge index of the
  spacetime graph (`qubitWeight(q) === edgeWeight(q)`); `spaceEdgeIndex(code, q, cycle,
  cycles)` = `q + n·(cycle − 1)` and `timeEdgeIndex(code, typeIndex, cycle, cycles)` =
  `n·cycles + (cycle − 1)·m + typeIndex` name the edges. Test vector shared with the
  reference: `W_81 = 16 764 263`, `W_343 = 16 770 859`, `W_511 = 16 774 866`,
  `W_1088 = 16 773 412`.
- `defectGraph(code, type)` precomputes, once, the shortest paths between the
  stabilizers of a type and to its boundary (`dist`, `via`, `boundaryDist`,
  `boundaryVia`); `xorPathInto` XORs a path into a mask without allocating,
  `pathQubits` lists it (`BOUNDARY = -1` is the boundary endpoint).
- `createMatcher(maxVertices)` is a generic Edmonds blossom matcher on a dense matrix
  (`weight`, `NO_EDGE`, `solve(v)` returns the minimum total weight and fills `mate`).
- `createDecoder(code, type)` and `decode(decoder, syndrome, correction)`: the syndrome
  is the `Uint8Array` of one type by `typeIndex`; `decode` clears `correction.x` (type
  `"Z"`, which corrects X errors) or `correction.z` (type `"X"`), XORs the correction
  chains in, records the pairs in `decoder.pairs` (`-1` = boundary) and returns the
  integer matching weight, with no allocation per call; `correctionChains(decoder)`
  gives the chains as qubit lists for the UI.
- `spacetimeGraph(code, type, cycles)` is the 3D defect graph of the phenomenological
  model: `m·(cycles + 1)` detector nodes (`nodeIndex(graph, cycle, typeIndex)`), one
  edge per error mechanism (`edgeU`, `edgeV` with `BOUNDARY`, `edgeQubit` = `-1` for a
  measurement flip, `edgeWeight`), the last layer perfect (no space edges) and no time
  boundary; `dist` / `via` / `boundaryDist` / `boundaryVia` by dense Dijkstra, cached
  per `(code, type, cycles)`. `xorSpacetimePathInto` XORs only the qubits of the space
  edges of a path. `createSpacetimeDecoder(code, type, cycles, initialVertices?)` and
  `decodeSpacetime(decoder, detectors, correction)` have the contract of `decode` over
  a detector vector; the Blossom matcher starts at `2·min(M, 32)` vertices
  (`matcherVertices`) and grows to the next power of two in defects when a syndrome
  needs it, never refusing one. `spacetimePathEdges(graph, from, to)` lists the edge
  indices of a shortest path and `spacetimeChains(decoder)` one entry per pair of the
  last decode with those edges (UI only; a space edge carries `edgeQubit ≥ 0`, a time
  edge `−1`; the XOR of the space-edge qubits over the chains of a type is the mask the
  decode left in the correction).

The simulation module (`src/core/sim/`) runs the Monte Carlo:

- `createShotContext(code, independentNoise(p), rng)` and `runShot(ctx)` are the
  phase-1 shot (`sampleNoise` → `computeTypeSyndrome` and `decode` for `"Z"` and `"X"`
  into the same correction → `multiplyInto(residual, error, correction)` → verdict bits
  `LOGICAL_X | LOGICAL_Z`); `decodeShot` decodes an injected `ctx.error`.
- `createSpacetimeShotContext(code, phenomenologicalNoise(p, cycles), rng)` and
  `runSpacetimeShot(ctx)` are the phase-2 shot: per cycle `sampleCycleNoise`, the
  accumulated error `cumulative`, readings with flips and detectors by difference
  (`D_r = s_r ⊕ s_{r−1}`, `s_0 = 0`), a perfect last layer, two `decodeSpacetime`,
  residual and the same verdict bits. `decodeSpacetimeShot` decodes the detectors in
  the context; `detectorsOf(code, type, cycles, errors, flips, out)` computes the
  detectors of an explicit history (tests and the exact enumeration).
- Explicit histories, for the spacetime viewer (cold path): `createSpacetimeHistory(code,
  cycles)` allocates `{ cycles, cycleErrors: E_r[], flips: { Z, X }[] }`;
  `sampleSpacetimeHistory(noise, rng, code, history)` draws one with the shot's exact PRNG
  consumption; `cumulativeErrorsOf(history, out)` gives `C_r = C_{r−1}·E_r`;
  `readingsOf(code, type, cycles, errors, flips, out)` gives the measured readings
  `s_r = H·C_r ⊕ f_r` (perfect last layer; `detectorsOf` is its layer difference with
  `s_0 = 0`); `decodeSpacetimeHistory(ctx, history)` fills `ctx.cumulative` and
  `ctx.detectors` through the shot's own `layerDetectors` and decodes
  (`decodeSpacetimeShot`), returning the verdict bits. `runSpacetimeShot` is untouched:
  `tests/intent/spacetime-conventions.test.ts` pins two published counts of the
  phenomenological model and `src/core/sim/spacetime-shot.test.ts` checks a history
  decodes byte for byte like the shot that drew it.
- `createPointSampler(code, p, seed, rule, model?)`, `step`, `stop`, `estimate` and
  `estimatePoint(code, p, seed, rule, model?)` sample one point `(d, p)` under a
  `StopRule` (`VALIDATION_STOP_RULE` is `≥ 100` failures and `≥ 10⁵` shots, cap `10⁶`).
  `model` is a `ModelSpec`: `INDEPENDENT_MODEL` (the default; the phase-1 draws are
  untouched, `tests/intent/spacetime-conventions.test.ts` pins two published counts)
  or `PHENOMENOLOGICAL_MODEL` (`cycles = d`; `{ kind: "phenomenological", cycles }`
  overrides it). `sampler.ctx` is a `ShotContext` or a `SpacetimeShotContext`;
  TypeScript does not narrow the union on the nested `ctx.noise.kind`, so narrow with
  `"detectors" in ctx` (true only for the spacetime context) or branch on
  `sampler.model.kind`. An unknown `kind` at runtime is a `RangeError`.
- `wilsonInterval`, `ratioInterval`, `pointRate`, `pointSeed` are the statistics;
  `exactFailureCounts` / `exactLogicalRates` enumerate the `2⁹` patterns per type of
  `d = 3` in the phase-1 model, `exactSpacetimeFailureCounts(code3, type, 1)` /
  `exactSpacetimeRates` the `2¹³` mechanisms per type of the phenomenological model
  with one noisy cycle (which reduces exactly to the phase-1 decoder: the perfect
  readout reveals the flips).

All buffers of a shot are created once; `step` allocates nothing per shot (the only
allocation of the 3D path is the documented matcher growth).

Grid coordinates are exposed in lattice units; the UI maps qubit `(r, c)` to
`(x = c, y = r)` and plaquette `(i, j)` to its centre `(j + 0.5, i + 0.5)`.

## Layout

```
src/
  core/      # Pure TypeScript simulation core (no React, no DOM). Runs in browser, Worker and Node.
    lattice/ # Rotated surface code: Pauli algebra, geometry, syndrome, logical verdict
    noise/   # Seeded PRNG (xoshiro128** via splitmix64), independent X/Z and phenomenological noise models
    decoder/ # Generic integer weights (by qubit and by edge), 2D defect graph, 3D spacetime graph, Edmonds blossom, MWPM decoders; DP oracle (tests only)
    sim/     # Monte Carlo shots (2D and spacetime), Wilson interval, adaptive point sampler with ModelSpec, exact enumerations (d = 3; cycles = 1)
  worker/    # Web Worker over the core: typed protocol, round-robin sampler of the grid plus the user's p
  ui/        # React components; every visible string goes through i18n
    model/   # UI state without React DOM: decoded shot trace, grid reducer, long-press gesture
    grid/    # The lattice as SVG (geometry, qubits, plaquettes, chains) and its panel with the controls
    controls/# Distance select and noise controls (p slider, random, clear)
    steps/   # Step-by-step mode: step machine and panel
    chart/   # Threshold chart: validated base, live pooling, scales, SVG chart, Worker hook, panel
  locales/   # en.json, es.json
tests/
  helpers/     # A fake Worker for the chart and scenario tests
  intent/      # Tests that protect architectural decisions (see docstrings)
  scenario/    # End-to-end flows across several decisions (noise → syndrome → decode → verdict; UI flows)
  validation/  # The committed validation files: min-weights equality, grid comparison, run and compare tests
tools/
  bench/       # npm run bench
  reference/   # uv run tools/reference/run.py: PyMatching reference (geometry self-test, min-weights, grid)
  validate/    # npm run validate: grid run (browser.json), statistical comparison, docs/validacion.md
docs/
  validacion/  # reference.json, min-weights.json (Python), browser.json (TypeScript); no timestamps
  validacion.md, spec.md   # Validation report and specification (Spanish)
```

The purity of `src/core/` is enforced three ways, and each barrier is tested against a
mutant in `tests/intent/core-purity.test.ts`: every file there is plain `.ts`, no relative
import may leave `src/core`, no package may enter it outside an explicit (currently empty)
allowlist, and there is no dynamic `import()` in any form; an ESLint override rejects
React, i18n, UI imports, `import()` and every browser-only global; and
`tsconfig.core.json` compiles the core without the DOM lib, so `location` or
`HTMLElement` are type errors there.

## Science

- Google Quantum AI, _Quantum error correction below the surface code threshold_, Nature
  638, 920 (2025).
- Fowler, Mariantoni, Martinis, Cleland, _Surface codes: Towards practical large-scale
  quantum computation_, Phys. Rev. A 86, 032324 (2012).
- Dennis, Kitaev, Landahl, Preskill, _Topological quantum memory_, J. Math. Phys. 43,
  4452 (2002).
- Wang, Harrington, Preskill, _Confinement-Higgs transition in a disordered gauge theory
  and the accuracy threshold for quantum memory_, Ann. Phys. 303, 31 (2003) — MWPM
  thresholds: ≈ 10.3 % with perfect measurements, ≈ 2.9 % with the phenomenological model.
- Higgott, _PyMatching_, ACM TQC 3, 16 (2022) — the reference decoder we validate against.
- Gidney, _Stim: a fast stabilizer circuit simulator_, Quantum 5, 497 (2021) — used by the
  reference to check that the spacetime graph is the detector error model of the circuit.

## License

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
