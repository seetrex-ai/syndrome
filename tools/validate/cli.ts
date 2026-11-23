// npm run validate [-- --model independent|phenomenological|all] [--compare-only]
//                  [--no-docs] [--seed N] [--out DIR] [--docs FILE]
//
// 0. checks the arguments (--model is one of the three values, default all; --seed is a
//    decimal integer in [0, 2^52); --out and --docs take a value), that the input files
//    of every selected model exist in DIR (reference*.json, min-weights*.json,
//    verdicts-phenomenological.json; browser*.json too with --compare-only) and that
//    the directory of FILE exists, before simulating anything: a bad input must not
//    cost the minutes of a grid first;
// 1. runs src/core on the grid of each selected model and writes DIR/browser*.json
//    (skipped with --compare-only; --seed only makes sense when simulating, so the two
//    together are an error, not a silently ignored seed);
// 2. reads the files of each model, builds its report (compare.ts), prints the tables
//    and writes docs/validacion.md with one section per model (skipped with
//    --no-docs; CI does not write documents).
// Exit code 1 when any verdict is FALLA, a file is missing or an argument is wrong.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { dirname, join } from "node:path";
import { VALIDATION_STOP_RULE } from "../../src/core/index";
import {
  buildReport,
  renderDocuments,
  renderTable,
  type DocumentSection,
  type RunInfo,
} from "./compare";
import {
  fileNamesOf,
  readMinWeightsFixture,
  readValidationFile,
  readVerdictsFixture,
  VALIDATION_NOISES,
  type ValidationNoise,
} from "./format";
import { runGrid, writeBrowserJson } from "./run";

interface Args {
  models: readonly ValidationNoise[];
  compareOnly: boolean;
  docs: boolean;
  seed: number;
  seedGiven: boolean;
  out: string;
  docsPath: string;
}

const DEFAULT_SEED = 20261016;
/** Seeds are decimal integers in [0, 2⁵²): exact in a double and in the JSON. */
const SEED_LIMIT = 2 ** 52;

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    models: VALIDATION_NOISES,
    compareOnly: false,
    docs: true,
    seed: DEFAULT_SEED,
    seedGiven: false,
    out: join("docs", "validacion"),
    docsPath: join("docs", "validacion.md"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // The value of a flag is the next token, which must exist, be non-empty and not be
    // a flag itself ("--out --no-docs" is a missing value, not a directory).
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v === "" || v.startsWith("--"))
        throw new Error(`${a} needs a value`);
      i++;
      return v;
    };
    if (a === "--compare-only") args.compareOnly = true;
    else if (a === "--no-docs") args.docs = false;
    else if (a === "--model") {
      const v = next();
      if (v === "all") args.models = VALIDATION_NOISES;
      else if (v === "independent" || v === "phenomenological")
        args.models = [v];
      else
        throw new Error(
          `--model needs independent, phenomenological or all, got "${v}"`,
        );
    } else if (a === "--seed") {
      const v = next();
      if (!/^\d+$/.test(v) || Number(v) >= SEED_LIMIT) {
        throw new Error(
          `--seed needs a decimal integer in [0, 2^52), got "${v}"`,
        );
      }
      args.seed = Number(v);
      args.seedGiven = true;
    } else if (a === "--out") args.out = next();
    else if (a === "--docs") args.docsPath = next();
    else throw new Error(`unknown argument ${a}`);
  }
  if (args.compareOnly && args.seedGiven) {
    throw new Error(
      "--seed and --compare-only together: the seed only applies when the grid is simulated",
    );
  }
  return args;
}

/** sha256 (hex) of each file, keyed by its base name, for the document. */
function sha256Of(paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    out[basename(path)] = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
  }
  return out;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  const paths = args.models.map((noise) => {
    const names = fileNamesOf(noise);
    return {
      noise,
      browser: join(args.out, names.browser),
      reference: join(args.out, names.reference),
      minWeights: join(args.out, names.minWeights),
      verdicts: names.verdicts === null ? null : join(args.out, names.verdicts),
    };
  });

  // Inputs first: a missing file is reported before the minutes of simulation.
  for (const p of paths) {
    const inputs = [p.reference, p.minWeights];
    if (p.verdicts !== null) inputs.push(p.verdicts);
    if (args.compareOnly) inputs.push(p.browser);
    for (const path of inputs) {
      if (!existsSync(path)) {
        console.error(`missing ${path}`);
        return 1;
      }
    }
  }
  // The document is written last: its directory must exist before the simulation,
  // or the minutes of the grid end in an ENOENT.
  if (args.docs && !existsSync(dirname(args.docsPath))) {
    console.error(
      `missing directory ${dirname(args.docsPath)} for --docs ${args.docsPath}`,
    );
    return 1;
  }
  // And the document itself must not be a directory (an EISDIR after the
  // minutes of simulation).
  if (
    args.docs &&
    existsSync(args.docsPath) &&
    statSync(args.docsPath).isDirectory()
  ) {
    console.error(`--docs ${args.docsPath} is a directory, not a file`);
    return 1;
  }

  const sections: DocumentSection[] = [];
  let pass = true;
  for (const p of paths) {
    let simulation: RunInfo["simulation"] = null;
    if (!args.compareOnly) {
      const byDistance: Record<string, number> = {};
      const t0 = performance.now();
      console.log(
        `simulating the ${p.noise} grid with seed ${args.seed}, rule {${VALIDATION_STOP_RULE.minFailures}, ${VALIDATION_STOP_RULE.minShots}, ${VALIDATION_STOP_RULE.maxShots}}`,
      );
      const file = runGrid({
        seed: args.seed,
        rule: VALIDATION_STOP_RULE,
        model: p.noise,
        onPoint: (e, seconds) => {
          byDistance[String(e.d)] = (byDistance[String(e.d)] ?? 0) + seconds;
          console.log(
            `d = ${e.d}  p = ${e.p.toFixed(3)}  shots = ${String(e.shots).padStart(7)}  failures = ${String(e.failures).padStart(6)}  estimate = ${e.estimate.toFixed(5)}  [${e.low.toFixed(5)}, ${e.high.toFixed(5)}]  ${(e.stopReason ?? "running").padEnd(8)} ${seconds.toFixed(2).padStart(6)} s`,
          );
        },
      });
      writeBrowserJson(file, p.browser);
      simulation = { total: (performance.now() - t0) / 1000, byDistance };
      console.log(`wrote ${p.browser} in ${simulation.total.toFixed(1)} s\n`);
    }
    const report = buildReport(
      readValidationFile(p.reference),
      readValidationFile(p.browser),
      readMinWeightsFixture(p.minWeights),
      undefined,
      p.verdicts === null ? null : readVerdictsFixture(p.verdicts),
    );
    process.stdout.write(renderTable(report));
    process.stdout.write("\n");
    sections.push({
      report,
      run: {
        nodeVersion: process.version,
        simulation,
        files: sha256Of(
          [p.reference, p.browser, p.minWeights, p.verdicts].filter(
            (f): f is string => f !== null,
          ),
        ),
      },
    });
    pass &&= report.pass;
  }
  if (args.docs) {
    writeFileSync(args.docsPath, renderDocuments(sections, new Date()), "utf8");
    console.log(`wrote ${args.docsPath}`);
  }
  return pass ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
