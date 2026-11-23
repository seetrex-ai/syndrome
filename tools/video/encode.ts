// Encoding (tasks/plans/video.md D3, D10): one PNG per STATE, the concat
// demuxer gives each its duration, ffmpeg fills the frames. Fixed, measured
// settings: MP4 libx264 crf 18 (byte-identical across runs with -threads 1),
// WebM VP9 crf 32. After encoding, ffprobe counts the frames and the caller
// requires round(Σ duration · fps).

import { spawnSync } from "node:child_process";
import { basename, dirname } from "node:path";

export interface FrameFile {
  /** Relative to the directory of list.txt, with forward slashes. */
  readonly file: string;
  readonly seconds: number;
}

/**
 * The concat demuxer's list: `file` + `duration` per state and the last file
 * repeated without a duration, as the demuxer requires for the last image to
 * last its full duration.
 */
export function listText(frames: readonly FrameFile[]): string {
  if (frames.length === 0) throw new RangeError("no frames to list");
  const lines: string[] = [];
  for (const f of frames) {
    lines.push(`file '${f.file}'`, `duration ${f.seconds}`);
  }
  lines.push(`file '${frames[frames.length - 1]!.file}'`);
  return `${lines.join("\n")}\n`;
}

/** Frames the encoded file must have: round(Σ seconds · fps). */
export function expectedFrames(
  frames: readonly { readonly seconds: number }[],
  fps: number,
): number {
  const total = frames.reduce((sum, f) => sum + f.seconds, 0);
  return Math.round(total * fps);
}

function run(binary: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${binary} ${args.join(" ")} exited with ${result.status}:\n${result.stderr.slice(-2000)}`,
    );
  }
  return result.stdout;
}

// The concat demuxer does not end the stream at Σ duration: measured on the
// 18-state list (52 s), the last image lasts 3.47 s longer with the repeated
// entry and 0.53 s longer without it (1 664 / 1 576 frames instead of 1 560).
// `-frames:v` cuts the output at exactly the frame count the states add up to.
const inputArgs = (listFile: string, fps: number, frames: number): string[] => [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  basename(listFile),
  "-vf",
  `fps=${fps},format=yuv420p`,
  "-frames:v",
  String(frames),
];

/**
 * H.264 MP4 of exactly `frames` frames, byte-identical across runs (single
 * thread). High profile, level 4.1 explicitly: `-preset slow` takes 5 reference
 * frames, which at 1080p pushed the automatic level to 5.0 (measured
 * 2026-10-18); 4.1 is what every hardware decoder of a phone plays and x264
 * trims the references to fit it. `out` is absolute.
 */
export function encodeMp4(
  listFile: string,
  out: string,
  fps: number,
  frames: number,
  ffmpeg: string,
): void {
  run(
    ffmpeg,
    [
      ...inputArgs(listFile, fps, frames),
      ...["-c:v", "libx264", "-preset", "slow", "-crf", "18"],
      ...["-profile:v", "high", "-level", "4.1"],
      ...["-movflags", "+faststart", "-threads", "1", out],
    ],
    dirname(listFile),
  );
}

/** VP9 WebM of exactly `frames` frames for the web. `out` is absolute. */
export function encodeWebm(
  listFile: string,
  out: string,
  fps: number,
  frames: number,
  ffmpeg: string,
): void {
  run(
    ffmpeg,
    [
      ...inputArgs(listFile, fps, frames),
      ...["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0"],
      ...["-row-mt", "1", "-deadline", "good", "-cpu-used", "2", out],
    ],
    dirname(listFile),
  );
}

/** Decoded frame count of the first video stream. */
export function countFrames(file: string, ffprobe: string): number {
  const out = run(
    ffprobe,
    [
      ...["-v", "error", "-count_frames", "-select_streams", "v:0"],
      ...["-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file],
    ],
    dirname(file),
  );
  const n = Number(out.trim());
  if (!Number.isInteger(n))
    throw new Error(`ffprobe gave no frame count for ${file}: ${out}`);
  return n;
}

/** Container duration in seconds. */
export function durationOf(file: string, ffprobe: string): number {
  const out = run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    dirname(file),
  );
  const s = Number(out.trim());
  if (!Number.isFinite(s))
    throw new Error(`ffprobe gave no duration for ${file}: ${out}`);
  return s;
}
