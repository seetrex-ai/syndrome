import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  edgeWeight,
  qubitWeight,
  rotatedSurfaceCode,
  VALIDATION_STOP_RULE,
} from "../../src/core/index";
import { checkMetadata } from "../../tools/validate/compare";
import {
  asValidationFile,
  GEOMETRY_DISTANCES,
  WEIGHT_SAMPLE_EDGES,
  WEIGHT_SAMPLE_QUBITS,
  weightSampleOf,
} from "../../tools/validate/format";

const DIR = join(process.cwd(), "docs", "validacion");

function load(name: string): {
  raw: Record<string, unknown>;
  file: ReturnType<typeof asValidationFile>;
} {
  const raw = JSON.parse(readFileSync(join(DIR, name), "utf8")) as Record<
    string,
    unknown
  >;
  return { raw, file: asValidationFile(raw, name) };
}

const TOP_LEVEL_KEYS = [
  "schema",
  "generator",
  "engine",
  "noise",
  "stopRule",
  "seed",
  "weights",
  "geometry",
  "points",
];
const TOP_LEVEL_KEYS_PHENOMENOLOGICAL = [
  "schema",
  "generator",
  "engine",
  "noise",
  "model",
  "stopRule",
  "seed",
  "weights",
  "geometry",
  "exactProbe",
  "points",
];

/**
 * test_intent_validation_files_share_one_shape
 *
 * INTENCIÓN: `docs/validacion/reference*.json` (Python, PyMatching) y
 *   `docs/validacion/browser*.json` (TypeScript, `src/core`) son EL MISMO tipo
 *   (`ValidationFile`, `tools/validate/format.ts`), para que `compare.ts` y la gráfica
 *   lean uno u otro sin ramas; y los metadatos (`weights`, `geometry`) que cada
 *   generador emite desde SU implementación permiten detectar una geometría especular
 *   o unos pesos distintos sin ejecutar Python (P_L es invariante bajo transposición
 *   más intercambio X↔Z: la estadística no lo vería nunca). Con dos modelos (fase 2,
 *   `tasks/plans/phase2.md` D9) la forma sigue siendo una: `schema` 1, `noise` como
 *   discriminante, y los ficheros fenomenológicos añaden exactamente `model` y
 *   `exactProbe`; los de fase 1 no cambian ni un byte.
 * CONTEXTO: tasks/plans/validation.md D6 y R1; tests/intent/lattice-conventions
 *   («dos implementaciones sin leerse»: la referencia reimplementa §3 desde el texto).
 * EXPIRA SI: la referencia lee la geometría de un JSON exportado por el núcleo (ya no
 *   habría dos implementaciones que contrastar).
 */
describe("test_intent_validation_files_share_one_shape", () => {
  const ref = load("reference.json");
  const ts = load("browser.json");
  const ref3 = load("reference-phenomenological.json");
  const ts3 = load("browser-phenomenological.json");

  it("schema 1 and the same top-level keys in the same order, per model; the phenomenological files add exactly model and exactProbe", () => {
    for (const { file } of [ref, ts, ref3, ts3]) expect(file.schema).toBe(1);
    expect(Object.keys(ts.raw)).toEqual(Object.keys(ref.raw));
    expect(Object.keys(ref.raw)).toEqual(TOP_LEVEL_KEYS);
    expect(Object.keys(ts3.raw)).toEqual(Object.keys(ref3.raw));
    expect(Object.keys(ref3.raw)).toEqual(TOP_LEVEL_KEYS_PHENOMENOLOGICAL);
    expect(
      TOP_LEVEL_KEYS_PHENOMENOLOGICAL.filter(
        (k) => !TOP_LEVEL_KEYS.includes(k),
      ),
    ).toEqual(["model", "exactProbe"]);
    // Points too: same keys in the same order in every point of the four files
    // (and of the probe points).
    const pointKeys = Object.keys(
      (ref.raw["points"] as Record<string, unknown>[])[0]!,
    );
    for (const { raw } of [ref, ts, ref3, ts3]) {
      for (const pt of raw["points"] as Record<string, unknown>[]) {
        expect(Object.keys(pt)).toEqual(pointKeys);
      }
    }
    for (const { file } of [ref3, ts3]) {
      for (const pt of file.exactProbe!.points) {
        expect(Object.keys(pt)).toEqual(pointKeys);
      }
    }
  });

  it("checkMetadata is empty for the four: geometry and weights are the core's", () => {
    for (const { file } of [ref, ts, ref3, ts3]) {
      expect(checkMetadata(file)).toEqual([]);
    }
  });

  it("24 points in the same (d, p) order per model, the validation stop rule, no timestamp", () => {
    for (const [a, b] of [
      [ref, ts],
      [ref3, ts3],
    ] as const) {
      expect(a.file.points).toHaveLength(24);
      expect(b.file.points.map((pt) => [pt.d, pt.p])).toEqual(
        a.file.points.map((pt) => [pt.d, pt.p]),
      );
      expect(a.file.stopRule).toEqual(VALIDATION_STOP_RULE);
      expect(b.file.stopRule).toEqual(VALIDATION_STOP_RULE);
    }
    for (const name of [
      "reference.json",
      "browser.json",
      "reference-phenomenological.json",
      "browser-phenomenological.json",
    ]) {
      expect(readFileSync(join(DIR, name), "utf8")).not.toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
      );
    }
  });

  it("weights.sample = edgeWeight on the sampled indices of each model (8 qubits; 12 edges with the 3D ones) and geometry = rotatedSurfaceCode, in all four", () => {
    expect(weightSampleOf("independent")).toEqual([...WEIGHT_SAMPLE_QUBITS]);
    expect(weightSampleOf("phenomenological")).toEqual([
      ...WEIGHT_SAMPLE_EDGES,
    ]);
    expect([...WEIGHT_SAMPLE_EDGES]).toEqual(
      expect.arrayContaining([...WEIGHT_SAMPLE_QUBITS, 81, 343, 511, 1088]),
    );
    for (const { file } of [ref, ts, ref3, ts3]) {
      const want = weightSampleOf(file.noise);
      expect(
        Object.keys(file.weights.sample)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([...want]);
      for (const e of want) {
        expect(file.weights.sample[String(e)]).toBe(edgeWeight(e));
        if (e < 121) expect(edgeWeight(e)).toBe(qubitWeight(e));
      }
      for (const d of GEOMETRY_DISTANCES) {
        const table = rotatedSurfaceCode(d).stabilizers.map((s) => [
          s.type,
          s.row,
          s.col,
        ]);
        expect(file.geometry[String(d)]).toEqual(table);
      }
    }
    // Positive control, in the test: the transposed table of d = 3 is NOT the core's.
    const transposed = ref.file.geometry["3"]!.map(([t, i, j]) => [t, j, i]);
    expect(transposed).not.toEqual(
      rotatedSurfaceCode(3).stabilizers.map((s) => [s.type, s.row, s.col]),
    );
  });
});
