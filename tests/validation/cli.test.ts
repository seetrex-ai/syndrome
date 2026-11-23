import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every case spawns tsx + the CLI (≈ 0.7 s each, several per case): under the
// full suite on a loaded machine (a build or a browser running beside it) two
// cases crossed Vitest's default 5 s (2026-10-18). The budget
// is for process start-up, not for simulation: expectBeforeSimulation keeps
// the «fails fast» claim on `seconds`.
vi.setConfig({ testTimeout: 30_000 });

/**
 * T-L1 — `tools/validate/cli.ts` checks its inputs and arguments before simulating.
 * Measured before the fix: a missing reference.json cost the 21 s of the grid and then
 * failed; `--seed` with `--compare-only` was silently ignored. The CLI is run as
 * `npm run validate` does (tsx), against a temporary directory, so a run that
 * simulates first is visible as time: the grid takes ≥ 15 s on any machine, the limit
 * below is well under that.
 *
 * T-L2 — the exit code follows the verdict: `--compare-only` on the three committed
 * files is 0 with «VEREDICTO: PASA»; the same with one edited count in browser.json is
 * 1 with «VEREDICTO: FALLA» (≈ 1 s each: no grid, only the exact d = 3 enumeration and
 * the 10⁴ minimum weights).
 */

const TSX = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const CLI = join(process.cwd(), "tools", "validate", "cli.ts");
const VALIDACION = join(process.cwd(), "docs", "validacion");
const SIMULATION_SECONDS_LOWER_BOUND = 10;
const COMPARE_ONLY_TIMEOUT_MS = 30_000;

function run(args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
  seconds: number;
} {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    seconds: (performance.now() - t0) / 1000,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh temporary directory holding copies of the named committed validation files. */
function dirWith(...files: readonly string[]): string {
  const d = mkdtempSync(join(tmpdir(), "syndrome-validate-"));
  dirs.push(d);
  for (const f of files) copyFileSync(join(VALIDACION, f), join(d, f));
  return d;
}

/** The checks that `main` did not simulate: fast, nothing written, «simulating» never printed. */
function expectBeforeSimulation(r: ReturnType<typeof run>, out: string): void {
  expect(r.status).toBe(1);
  expect(r.stdout).not.toContain("simulating");
  expect(existsSync(join(out, "browser.json"))).toBe(false);
  expect(r.seconds).toBeLessThan(SIMULATION_SECONDS_LOWER_BOUND);
}

describe("T-L1 cli.ts fails fast on a missing input or a bad argument", () => {
  it("tsx is where npm run validate expects it", () => {
    expect(existsSync(TSX)).toBe(true);
  });

  it("a directory without reference.json: exit 1 naming the file, before the simulation", () => {
    const out = dirWith();
    const r = run(["--out", out, "--no-docs"]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("missing");
    expect(r.stderr).toContain("reference.json");
  });

  it("reference.json alone: exit 1 naming min-weights.json, before the simulation", () => {
    const out = dirWith("reference.json");
    const r = run(["--out", out, "--no-docs"]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("missing");
    expect(r.stderr).toContain("min-weights.json");
    expect(r.stderr).not.toContain("reference.json");
  });

  it("--compare-only with reference.json and min-weights.json but no browser.json: exit 1 naming browser.json", () => {
    const out = dirWith("reference.json", "min-weights.json");
    const r = run(["--compare-only", "--out", out, "--no-docs"]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("missing");
    expect(r.stderr).toContain("browser.json");
  });

  it("--compare-only with --seed: exit 1 with a message naming both flags, nothing read or written", () => {
    const out = dirWith();
    const r = run(["--compare-only", "--seed", "7", "--out", out, "--no-docs"]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("--seed");
    expect(r.stderr).toContain("--compare-only");
    expect(r.stderr).not.toContain("missing");
  });

  // Seven child processes in series (tsx + the CLI each): ≈ 0.7 s each on
  // this machine, 5.2 s once in three under the full suite, over Vitest's
  // default 5 s (docs/decisiones.md):
  // hence the 30 s budget.
  it("--seed accepts only a decimal integer in [0, 2^52): '', 1e3, 0x10, -1 and 2^52 are exit 1 naming --seed", () => {
    const out = dirWith();
    for (const bad of ["", "1e3", "0x10", "-1", String(2 ** 52), "7.0"]) {
      const r = run(["--seed", bad, "--out", out, "--no-docs"]);
      expectBeforeSimulation(r, out);
      expect(r.stderr, JSON.stringify(bad)).toContain("--seed");
      expect(r.stderr, JSON.stringify(bad)).not.toContain("missing");
    }
    // 2^52 − 1 parses: the run gets past the arguments to the missing reference.
    const ok = run(["--seed", String(2 ** 52 - 1), "--out", out, "--no-docs"]);
    expectBeforeSimulation(ok, out);
    expect(ok.stderr).toContain("missing");
    expect(ok.stderr).not.toContain("--seed");
  }, 30_000);

  it("--out and --docs need a value that is not a flag: exit 1 naming the flag", () => {
    const out = dirWith();
    for (const argv of [
      ["--no-docs", "--out"],
      ["--out", "--no-docs"],
      ["--out", out, "--docs"],
      ["--out", out, "--docs", "--no-docs"],
    ]) {
      const r = run(argv);
      expectBeforeSimulation(r, out);
      const flag = argv.includes("--docs") ? "--docs" : "--out";
      expect(r.stderr, argv.join(" ")).toContain(`${flag} needs a value`);
    }
  });

  it("--docs in a directory that does not exist: exit 1 naming it, before the simulation", () => {
    const out = dirWith("reference.json", "min-weights.json");
    const docs = join(out, "no-such-dir", "validacion.md");
    const r = run(["--model", "independent", "--out", out, "--docs", docs]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("missing directory");
    expect(r.stderr).toContain(join(out, "no-such-dir"));
    expect(r.stderr).toContain("--docs");
  });

  it("--docs naming an existing directory: exit 1 before the simulation", () => {
    const out = dirWith("reference.json", "min-weights.json");
    const r = run(["--model", "independent", "--out", out, "--docs", out]);
    expectBeforeSimulation(r, out);
    expect(r.stderr).toContain("is a directory, not a file");
    expect(r.stderr).toContain("--docs");
  });

  it("an unknown argument: exit 1", () => {
    const r = run(["--bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown argument --bogus");
  });
});

const PHENO_FILES = [
  "reference-phenomenological.json",
  "min-weights-phenomenological.json",
  "verdicts-phenomenological.json",
  "browser-phenomenological.json",
] as const;
/** --model all with --compare-only decodes 3·10⁴ fixture cases (≈ 6 s measured): margin for CI. */
const ALL_MODELS_TIMEOUT_MS = 120_000;

describe("T-L3 --model selects the files (tasks/plans/phase2.md T-CLI)", () => {
  it("--model accepts independent, phenomenological and all (default), rejects anything else before touching a file", () => {
    const out = dirWith();
    for (const bad of ["depolarizing", "", "ALL"]) {
      const r = run(["--model", bad, "--out", out, "--no-docs"]);
      expectBeforeSimulation(r, out);
      expect(r.stderr, JSON.stringify(bad)).toContain("--model");
      expect(r.stderr, JSON.stringify(bad)).not.toContain("missing");
    }
    // The default is all: with the three phase 1 files present, the first missing
    // input is the phenomenological reference.
    const three = dirWith("reference.json", "min-weights.json", "browser.json");
    const all = run(["--compare-only", "--out", three, "--no-docs"]);
    expect(all.status).toBe(1);
    expect(all.stdout).not.toContain("modelo:");
    expect(all.seconds).toBeLessThan(SIMULATION_SECONDS_LOWER_BOUND);
    expect(all.stderr).toContain("missing");
    expect(all.stderr).toContain("reference-phenomenological.json");
    // --model phenomenological needs verdicts-phenomenological.json too.
    const noVerdicts = dirWith(
      "reference-phenomenological.json",
      "min-weights-phenomenological.json",
    );
    const r = run([
      "--model",
      "phenomenological",
      "--out",
      noVerdicts,
      "--no-docs",
    ]);
    expectBeforeSimulation(r, noVerdicts);
    expect(r.stderr).toContain("verdicts-phenomenological.json");
  });

  it(
    "--model all --compare-only on the seven committed files: exit 0, two tables, one validacion.md with both sections",
    () => {
      const out = dirWith(
        "reference.json",
        "min-weights.json",
        "browser.json",
        ...PHENO_FILES,
      );
      const docsPath = join(out, "validacion.md");
      const r = run(["--compare-only", "--out", out, "--docs", docsPath]);
      expect(r.status).toBe(0);
      expect(r.stdout.match(/VEREDICTO: PASA/g)).toHaveLength(2);
      expect(r.stdout).not.toContain("FALLA");
      expect(r.stdout).toContain("modelo: ruido independiente");
      expect(r.stdout).toContain("modelo: ruido fenomenológico");
      const doc = readFileSync(docsPath, "utf8");
      expect(doc).toContain("**Veredicto global: PASA**");
      expect(doc).toContain("## Modelo de fase 1");
      expect(doc).toContain("## Modelo de fase 2");
      expect(doc.match(/^\| [357] \| 0\.\d+ \|/gm)).toHaveLength(48);
      // The document pins the bytes it describes: sha256 of every JSON it read.
      expect(doc.match(/^### Ficheros \(sha256\)$/gm)).toHaveLength(2);
      expect(doc).toMatch(/- `browser\.json`: `[0-9a-f]{64}`/);
      expect(doc).toMatch(
        /- `verdicts-phenomenological\.json`: `[0-9a-f]{64}`/,
      );
      // One model only: one table, one section.
      const one = run([
        "--model",
        "phenomenological",
        "--compare-only",
        "--out",
        out,
        "--docs",
        docsPath,
      ]);
      expect(one.status).toBe(0);
      expect(one.stdout.match(/VEREDICTO: PASA/g)).toHaveLength(1);
      expect(one.stdout).not.toContain("modelo: ruido independiente");
      expect(readFileSync(docsPath, "utf8")).not.toContain(
        "## Modelo de fase 1",
      );
    },
    ALL_MODELS_TIMEOUT_MS,
  );
});

describe("T-L2 the exit code is the verdict", () => {
  it(
    "--compare-only on the committed files: exit 0 and VEREDICTO: PASA; one edited count in browser.json: exit 1 and VEREDICTO: FALLA",
    () => {
      const out = dirWith("reference.json", "min-weights.json", "browser.json");
      const ok = run([
        "--model",
        "independent",
        "--compare-only",
        "--out",
        out,
        "--no-docs",
      ]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("VEREDICTO: PASA");
      expect(ok.stdout).not.toContain("FALLA");
      // The gate that fires is the internal consistency of the browser file: one
      // count moved, every derived field left as it was.
      const browserPath = join(out, "browser.json");
      const file = JSON.parse(readFileSync(browserPath, "utf8")) as {
        points: { failures: number }[];
      };
      file.points[0]!.failures += 100;
      writeFileSync(browserPath, JSON.stringify(file, null, 1), "utf8");
      const bad = run([
        "--model",
        "independent",
        "--compare-only",
        "--out",
        out,
        "--no-docs",
      ]);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain("VEREDICTO: FALLA");
      expect(bad.stdout).toContain("coherencia interna del núcleo");
      expect(bad.stdout).toContain("d = 3, p = 0.03");
      expect(existsSync(join(out, "validacion.md"))).toBe(false);
    },
    COMPARE_ONLY_TIMEOUT_MS,
  );

  it(
    "--docs writes the report where it says, and only there",
    () => {
      const out = dirWith("reference.json", "min-weights.json", "browser.json");
      const docsPath = join(out, "report", "r.md");
      const noDir = run([
        "--model",
        "independent",
        "--compare-only",
        "--out",
        out,
        "--docs",
        docsPath,
      ]);
      expect(noDir.status).toBe(1);
      expect(noDir.stderr).toContain("--docs");
      expect(existsSync(docsPath)).toBe(false);
      mkdirSync(join(out, "report"));
      const committed = readFileSync(join("docs", "validacion.md"), "utf8");
      const ok = run([
        "--model",
        "independent",
        "--compare-only",
        "--out",
        out,
        "--docs",
        docsPath,
      ]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain(`wrote ${docsPath}`);
      expect(existsSync(docsPath)).toBe(true);
      expect(readFileSync(docsPath, "utf8")).toContain("PASA");
      expect(readFileSync(join("docs", "validacion.md"), "utf8")).toBe(
        committed,
      );
    },
    COMPARE_ONLY_TIMEOUT_MS,
  );
});
