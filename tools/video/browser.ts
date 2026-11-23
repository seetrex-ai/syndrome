// The browser and ffmpeg (tasks/plans/video.md D2): the system Chrome first,
// then Edge, then Playwright's own Chromium (not installed by `npm ci`: the
// `playwright` package ships no browser). ffmpeg from PATH or $FFMPEG, with
// ffprobe beside it. Both are recorded in the manifest: the PNG hashes are
// only comparable at equal browser (tasks/plans/video.md R2).

import { spawnSync } from "node:child_process";
import { chromium, type Browser } from "playwright";

export type Channel = "chrome" | "msedge" | "chromium";
export const CHANNELS: readonly Channel[] = ["chrome", "msedge", "chromium"];

export function isChannel(value: unknown): value is Channel {
  return (CHANNELS as readonly unknown[]).includes(value);
}

/**
 * Raster the page the same way every time: no low-resolution tiles painted
 * first and replaced later, no checker-imaging, software compositing. With
 * GPU raster a frame captured right after a click could carry a tile not yet
 * re-rasterised (a few anti-aliased pixels, 1 of 6 captures; 2026-10-18).
 */
export const LAUNCH_ARGS: readonly string[] = [
  "--disable-gpu",
  "--disable-low-res-tiling",
  "--disable-checker-imaging",
  "--disable-partial-raster",
];

export interface Launched {
  readonly browser: Browser;
  readonly channel: Channel;
  readonly version: string;
}

/** Launch the first browser that starts: `preferred` alone, or chrome → msedge → chromium. */
export async function launchBrowser(preferred?: Channel): Promise<Launched> {
  const order = preferred === undefined ? CHANNELS : [preferred];
  const failures: string[] = [];
  for (const channel of order) {
    try {
      const browser = await chromium.launch(
        channel === "chromium"
          ? { headless: true, args: [...LAUNCH_ARGS] }
          : { channel, headless: true, args: [...LAUNCH_ARGS] },
      );
      return { browser, channel, version: browser.version() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${channel}: ${message.split("\n")[0] ?? message}`);
    }
  }
  throw new Error(
    `no browser could be launched:\n  ${failures.join("\n  ")}\n` +
      "Install Google Chrome or Microsoft Edge, or run: npx playwright install chromium",
  );
}

export interface Ffmpeg {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly version: string;
}

export const FFMPEG_HELP =
  "ffmpeg (and ffprobe) not found: install it (winget install Gyan.FFmpeg | " +
  "apt install ffmpeg | brew install ffmpeg) or point FFMPEG (and FFPROBE) at the binaries";

function runs(binary: string): string | null {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout.split(/\r?\n/)[0] ?? "";
}

/** ffmpeg and ffprobe, or null when either does not run. */
export function findFfmpeg(): Ffmpeg | null {
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  const version = runs(ffmpeg);
  if (version === null) return null;
  const ffprobe =
    process.env.FFPROBE ??
    ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_m, ext: string | undefined) =>
      ext === undefined ? "ffprobe" : `ffprobe${ext}`,
    );
  if (runs(ffprobe) === null) return null;
  return { ffmpeg, ffprobe, version };
}
