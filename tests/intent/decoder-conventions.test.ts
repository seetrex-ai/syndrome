import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as core from "../../src/core/index";
import {
  computeTypeSyndrome,
  createDecoder,
  createRng,
  decode,
  defectGraph,
  identity,
  independentNoise,
  MAX_EDGE_WEIGHT,
  qubitWeight,
  rotatedSurfaceCode,
  sampleNoise,
  WEIGHT_EPSILON_DENOMINATOR,
  WEIGHT_SCALE,
  WEIGHT_SEED,
} from "../../src/core/index";

/**
 * test_intent_decoder_shared_integer_weights
 *
 * INTENCIÓN: el decodificador de TS y la referencia PyMatching deben ser el MISMO
 *   decodificador sobre los MISMOS enteros: W_q = S + floor(top53_q · S / (1000 · 2⁵³)) con
 *   S = 16 760 454, definidos sin ningún flotante, de modo que PyMatching (que usa los
 *   enteros tal cual y redondea los flotantes a 2²⁴ niveles) devuelva exactamente el mismo
 *   peso mínimo que docs/validacion/min-weights.json exige igualar sin tolerancia.
 * CONTEXTO: PyMatching 2.4.0 descarta en silencio toda arista con peso > 16 777 215 y
 *   discretiza flotantes con error ~10⁻⁸ (medido 2026-10-16); por el teorema de paridad
 *   P_L no depende del desempate, pero la igualdad de pesos mínimos sí exige los mismos
 *   enteros. La tabla de abajo se repite literalmente (no se importa del test del núcleo)
 *   para que un cambio de semilla, escala o divisor se vea aquí y en docs/decisiones.md.
 * EXPIRA SI: la referencia deja de ser PyMatching, o PyMatching cambia
 *   MAX_USER_EDGE_WEIGHT (entonces S cambia por decisión y con nueva validación), o se
 *   abandona min-weights.json.
 */
describe("test_intent_decoder_shared_integer_weights", () => {
  const TABLE: ReadonlyArray<[q: number, W: number]> = [
    [0, 16766926],
    [1, 16771381],
    [2, 16773715],
    [8, 16766194],
    [24, 16762760],
    [48, 16772826],
    [80, 16763322],
    [120, 16774950],
  ];

  it("constants of the contract", () => {
    expect(WEIGHT_SEED).toBe(0x53594e44n);
    expect(WEIGHT_SCALE).toBe(16_760_454);
    expect(WEIGHT_SCALE).toBe(Math.floor(((2 ** 24 - 1) * 1000) / 1001));
    expect(WEIGHT_EPSILON_DENOMINATOR).toBe(1000);
    expect(MAX_EDGE_WEIGHT).toBe(16_777_215);
  });

  it("the literal W_q table", () => {
    for (const [q, W] of TABLE) expect(qubitWeight(q)).toBe(W);
  });

  it("every W_q (q < 121) is an integer within PyMatching's ceiling", () => {
    let max = 0;
    for (let q = 0; q < 121; q++) {
      const W = qubitWeight(q);
      expect(Number.isInteger(W)).toBe(true);
      if (W > max) max = W;
    }
    expect(max).toBeLessThanOrEqual(MAX_EDGE_WEIGHT);
  });

  it("every dist and boundaryDist in d = 9 is an integer (both types)", () => {
    const code = rotatedSurfaceCode(9);
    for (const type of ["Z", "X"] as const) {
      const graph = defectGraph(code, type);
      for (const v of graph.dist) expect(Number.isInteger(v)).toBe(true);
      for (const v of graph.boundaryDist) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

/**
 * test_intent_decode_into_buffer
 *
 * INTENCIÓN: `decode` escribe en el `Pauli` del llamante y devuelve un `number`; las
 *   parejas quedan en un buffer del decodificador (`pairs`), no en un array nuevo. Así la
 *   tirada compone sin asignar nada entre ruido, síndrome, decodificación y veredicto.
 * CONTEXTO: el Worker ejecuta ~10⁶ decodificaciones por curva (docs/spec.md §7); un objeto
 *   por llamada sería presión de GC en el bucle caliente. Este test mide la FORMA de la
 *   firma (identidad de los buffers, tipo de retorno, validación de longitudes), no la
 *   ausencia de asignaciones: eso lo mide `npm run bench` (tools/bench).
 * EXPIRA SI: el decodificador pasa a WebAssembly o sale del bucle caliente.
 */
describe("test_intent_decode_into_buffer", () => {
  it("pairs is the same buffer across 100 decodes and correction the same object", () => {
    const code = rotatedSurfaceCode(5);
    const decoder = createDecoder(code, "Z");
    const pairs = decoder.pairs;
    const rng = createRng(7);
    const noise = independentNoise(0.15);
    const error = identity(code.n);
    const syndrome = new Uint8Array(decoder.graph.m);
    const correction = identity(code.n);
    for (let shot = 0; shot < 100; shot++) {
      sampleNoise(noise, rng, error);
      computeTypeSyndrome(code, "Z", error, syndrome);
      const total = decode(decoder, syndrome, correction);
      expect(typeof total).toBe("number");
      expect(decoder.pairs).toBe(pairs);
    }
    expect(pairs).toBeInstanceOf(Int32Array);
    expect(pairs.length).toBe(2 * decoder.graph.m);
  });

  it("rejects wrong lengths with RangeError", () => {
    const decoder = createDecoder(rotatedSurfaceCode(3), "X");
    expect(() => decode(decoder, new Uint8Array(8), identity(9))).toThrow(
      RangeError,
    );
    expect(() => decode(decoder, new Uint8Array(4), identity(8))).toThrow(
      RangeError,
    );
  });
});

/**
 * test_intent_oracle_test_only
 *
 * INTENCIÓN: el oráculo DP (`src/core/decoder/oracle.ts`) es exponencial en el número de
 *   defectos y sólo existe para verificar Blossom (docs/spec.md §5 «Oráculo del
 *   decodificador»); no forma parte de la API pública ni del bundle.
 * CONTEXTO: vive en `src/core` porque los tests del núcleo no pueden importar fuera de
 *   `src/core` (test_intent_core_purity). Es código muerto para la app sólo mientras
 *   ningún fichero no-test del núcleo lo importe: se recorre `src/core/**` con el parser
 *   de TypeScript, como hace core-purity.
 * EXPIRA SI: el oráculo pasa a `tests/` con una excepción explícita en core-purity.
 */
describe("test_intent_oracle_test_only", () => {
  const ROOT = process.cwd();
  const CORE_DIR = join(ROOT, "src", "core");
  const ORACLE = resolve(CORE_DIR, "decoder", "oracle");

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  }

  function importTargets(file: string): string[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const out: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith(".")
      ) {
        out.push(
          // ".ts" and ".js" both resolve to the .ts file under moduleResolution
          // "bundler"; normalise both (2026-10-16).
          resolve(dirname(file), node.moduleSpecifier.text).replace(
            /\.(ts|js)$/,
            "",
          ),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
  }

  it("the public API has no exactMatchingWeight / ORACLE_MAX_DEFECTS", () => {
    expect("exactMatchingWeight" in core).toBe(false);
    expect("ORACLE_MAX_DEFECTS" in core).toBe(false);
  });

  it("no non-test file of src/core imports decoder/oracle (and the test files that do are the expected ones)", () => {
    const files = walk(CORE_DIR).filter((f) => f.endsWith(".ts"));
    const importers = files
      .filter((f) => importTargets(f).includes(ORACLE))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(importers.length).toBeGreaterThan(0); // the walker sees the real imports
    const nonTest = importers.filter((f) => !f.endsWith(".test.ts"));
    expect(nonTest).toEqual([]);
  });

  it("the walker would catch an import of the oracle from a non-test file (self-check)", () => {
    const decoderFile = join(CORE_DIR, "decoder", "decoder.ts");
    const targets = importTargets(decoderFile);
    expect(targets).toContain(resolve(CORE_DIR, "decoder", "blossom"));
    expect(targets).not.toContain(ORACLE);
  });
});
