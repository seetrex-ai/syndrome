// npm run video [-- --lang en|es|all] [--format landscape|portrait|all] [--out DIR]
//               [--fps N] [--browser chrome|msedge|chromium] [--scene ID]
//               [--dry | --frames-only] [--allow-console-errors]
//
// The deterministic explainer video (tasks/plans/video.md D12): the scenes of
// scenes.ts are checked against the core, then dist/ (built beforehand by
// `npm run build`; this script never builds) is loaded in a headless browser,
// one PNG per state is captured and ffmpeg encodes an MP4 and a WebM per
// (lang, format). Outputs: DIR/<lang>-<format>/{frames/NNNN.png, list.txt,
// manifest.json} and DIR/syndrome-<lang>-<16x9|9x16>.{mp4,webm}.
// --dry: no browser, no ffmpeg; prints the states and the total length.
// --frames-only: captures and writes list.txt/manifest.json, no encoding.
// --allow-console-errors: a console or page error is recorded in the manifest
// and warned about instead of failing the variant.
// Exit code 1 on any failed check (arguments, dist, ffmpeg, a hook, a console
// or page error, the frame count after encoding).

import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_DIR } from "../deploy/stage";
import {
  FFMPEG_HELP,
  findFfmpeg,
  isChannel,
  launchBrowser,
  type Channel,
} from "./browser";
import { captureVariant, type Manifest } from "./capture";
import { checkScenes } from "./check";
import { countFrames, durationOf, encodeMp4, encodeWebm } from "./encode";
import { isLang, LANGS, type Lang } from "./i18n";
import {
  FORMATS,
  isFormat,
  SCENES,
  sceneSeconds,
  statesOf,
  totalSeconds,
  type Format,
} from "./scenes";
import { assertDist } from "./serve";

export interface Args {
  readonly langs: readonly Lang[];
  readonly formats: readonly Format[];
  readonly out: string;
  readonly fps: number;
  readonly browser: Channel | undefined;
  readonly dry: boolean;
  readonly framesOnly: boolean;
  readonly allowConsoleErrors: boolean;
  readonly scene: string | undefined;
}

export const DEFAULT_OUT = join("out", "video");
export const DEFAULT_FPS = 30;

/** The arguments after `--`; throws on anything wrong, before any browser opens. */
export function parseArgs(argv: readonly string[]): Args {
  let langs: readonly Lang[] = LANGS;
  let formats: readonly Format[] = FORMATS;
  let out = DEFAULT_OUT;
  let fps = DEFAULT_FPS;
  let browser: Channel | undefined;
  let dry = false;
  let framesOnly = false;
  let allowConsoleErrors = false;
  let scene: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v === "" || v.startsWith("--")) {
        throw new Error(`${a} needs a value`);
      }
      i++;
      return v;
    };
    if (a === "--dry") dry = true;
    else if (a === "--frames-only") framesOnly = true;
    else if (a === "--allow-console-errors") allowConsoleErrors = true;
    else if (a === "--lang") {
      const v = next();
      if (v === "all") langs = LANGS;
      else if (isLang(v)) langs = [v];
      else throw new Error(`--lang must be ${LANGS.join("|")}|all, got ${v}`);
    } else if (a === "--format") {
      const v = next();
      if (v === "all") formats = FORMATS;
      else if (isFormat(v)) formats = [v];
      else
        throw new Error(`--format must be ${FORMATS.join("|")}|all, got ${v}`);
    } else if (a === "--out") out = next();
    else if (a === "--fps") {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 1 || v > 120) {
        throw new Error(`--fps must be an integer in [1, 120], got ${v}`);
      }
      fps = v;
    } else if (a === "--browser") {
      const v = next();
      if (!isChannel(v))
        throw new Error(`--browser must be chrome|msedge|chromium, got ${v}`);
      browser = v;
    } else if (a === "--scene") {
      const v = next();
      if (!SCENES.some((s) => s.id === v)) {
        throw new Error(
          `--scene must be one of ${SCENES.map((s) => s.id).join(", ")}, got ${v}`,
        );
      }
      scene = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (dry && framesOnly)
    throw new Error("--dry and --frames-only exclude each other");
  return {
    langs,
    formats,
    out,
    fps,
    browser,
    dry,
    framesOnly,
    allowConsoleErrors,
    scene,
  };
}

const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;

function printDry(fps: number): void {
  for (const scene of SCENES) {
    console.log(
      `${scene.id} (${scene.panel}) ${sceneSeconds(scene).toFixed(2)} s`,
    );
    for (const state of statesOf(scene)) {
      console.log(
        `  ${state.seconds.toFixed(2).padStart(6)} s  ${state.label}`,
      );
    }
  }
  const total = totalSeconds(SCENES);
  const states = SCENES.reduce((n, s) => n + statesOf(s).length, 0);
  console.log(
    `total ${total.toFixed(2)} s, ${states} states, ${Math.round(total * fps)} frames at ${fps} fps`,
  );
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const problems = checkScenes(SCENES);
  if (problems.length > 0) {
    throw new Error(`scenes.ts is not valid:\n  ${problems.join("\n  ")}`);
  }
  if (args.dry) {
    printDry(args.fps);
    return;
  }
  const scenes =
    args.scene === undefined
      ? SCENES
      : SCENES.filter((s) => s.id === args.scene);
  // The app's build (vite.config.ts outDir), served under its base path.
  const distDir = resolve("dist", APP_DIR);
  const dist = assertDist(distDir);
  console.log(
    `dist/${APP_DIR}/index.html sha256 ${dist.indexSha256.slice(0, 12)}… built ${dist.indexMtime}`,
  );
  const ffmpeg = findFfmpeg();
  if (ffmpeg === null && !args.framesOnly) throw new Error(FFMPEG_HELP);
  const started = performance.now();
  const launched = await launchBrowser(args.browser);
  console.log(
    `browser ${launched.channel} ${launched.version}; ffmpeg ${ffmpeg?.version ?? "not used"}`,
  );
  try {
    for (const lang of args.langs) {
      for (const format of args.formats) {
        const variantDir = resolve(args.out, `${lang}-${format}`);
        const t0 = performance.now();
        const manifest = await captureVariant(
          launched.browser,
          scenes,
          lang,
          format,
          variantDir,
          {
            fps: args.fps,
            distDir,
            dist,
            browser: { channel: launched.channel, version: launched.version },
            ffmpeg: ffmpeg?.version ?? null,
            allowConsoleErrors: args.allowConsoleErrors,
          },
        );
        console.log(
          `${lang}-${format}: ${manifest.frames.length} states, ${manifest.totalSeconds.toFixed(2)} s, ` +
            `${manifest.expectedFrames} frames expected, captured in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
        );
        for (const e of manifest.consoleErrors) console.warn(`  console: ${e}`);
        if (!args.framesOnly && ffmpeg !== null)
          encode(manifest, variantDir, args, ffmpeg);
      }
    }
  } finally {
    await launched.browser.close();
  }
  console.log(`done in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

function encode(
  manifest: Manifest,
  variantDir: string,
  args: Args,
  ffmpeg: { readonly ffmpeg: string; readonly ffprobe: string },
): void {
  const listFile = join(variantDir, "list.txt");
  const aspect = manifest.format === "landscape" ? "16x9" : "9x16";
  const base = resolve(args.out, `syndrome-${manifest.lang}-${aspect}`);
  for (const [ext, run] of [
    ["mp4", encodeMp4],
    ["webm", encodeWebm],
  ] as const) {
    const out = `${base}.${ext}`;
    const t0 = performance.now();
    run(listFile, out, args.fps, manifest.expectedFrames, ffmpeg.ffmpeg);
    const frames = countFrames(out, ffmpeg.ffprobe);
    const seconds = durationOf(out, ffmpeg.ffprobe);
    console.log(
      `  ${out}: ${frames} frames, ${seconds.toFixed(2)} s, ${kB(statSync(out).size)}, ` +
        `encoded in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
    if (frames !== manifest.expectedFrames) {
      throw new Error(
        `${out} has ${frames} frames, expected ${manifest.expectedFrames}`,
      );
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
