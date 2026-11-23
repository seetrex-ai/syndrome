import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BOUNDARY,
  computeSyndrome,
  computeTypeSyndrome,
  createDecoder,
  createRng,
  createSpacetimeHistory,
  createSpacetimeShotContext,
  cumulativeErrorsOf,
  decode,
  decodeSpacetimeHistory,
  detectorsOf,
  identity,
  independentNoise,
  isStabilizerEquivalent,
  logicalEffect,
  LOGICAL_X,
  LOGICAL_Z,
  multiplyInto,
  nodeIndex,
  pauliEquals,
  pauliFrom,
  phenomenologicalNoise,
  qubitIndex,
  ratioInterval,
  rotatedSurfaceCode,
  sampleNoise,
  sampleSpacetimeHistory,
  spacetimeChains,
  readingsOf,
  WEIGHT_SCALE,
  weight,
  wilsonInterval,
  type DefectGraph,
  type Pauli,
  type ReadonlyPauli,
  type RotatedSurfaceCode,
  type StabilizerType,
} from "../../src/core";
import { exactMatchingWeight } from "../../src/core/decoder/oracle";
import { drawPuzzle } from "../../src/ui/challenge/puzzle";
import { judge, LEVEL_P } from "../../src/ui/challenge/score";
import { BASELINES } from "../../src/ui/chart/baseline";
import { lambdaAt, poolPoints } from "../../src/ui/chart/curves";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";
import { EXPLAIN_IDS } from "../../src/ui/explain/ids";
import { NOISE_KINDS, type NoiseKind } from "../../src/ui/model/noise-kinds";

/**
 * test_intent_explanations_are_predicates
 *
 * INTENCIÓN: cada frase de física de las explicaciones en contexto (`explain.*.body`) que
 *   se pueda formular como un predicado sobre el núcleo se mide contra el núcleo, no se
 *   lee «a ojo» (docs/spec.md §4.7 «pueden simplificar, nunca mentir»).
 *   El texto describe exactamente el predicado del test que lo acompaña.
 *   LÍMITE (medido): la barrera liga cada CLAVE a un
 *   predicado, no la REDACCIÓN; cambiar «impar» por «par» en `es.json` sigue en verde. Que
 *   las palabras digan lo que el predicado mide lo garantiza revisar cada texto enumerando
 *   casos, no este test.
 * CONTEXTO: el paso a paso tuvo dos veces seguidas un error grave en una frase escrita
 *   por quien sabía la física («un estabilizador nunca va de borde a borde», falso por
 *   X_L·X_L). La regla, en forma de barrera: `VERIFIABLE` es la lista, mantenida a mano y
 *   visible en el diff, de las claves marcadas «verificable» en el inventario D13 de
 *   `tasks/plans/phase2.md`; `PREDICATES` es la tabla {key, measuredBy, check}. El test
 *   falla si una clave verificable no tiene entrada, si una entrada no está en la lista,
 *   si una clave de la lista falta en `en.json` o `es.json`, si el fichero que la mide no
 *   existe, si un id de `EXPLAIN_IDS` no tiene título y cuerpo en ambos idiomas, o si
 *   `en.json` lleva un texto `explain.*` sin id (texto huérfano, nadie lo pinta). T-E1
 *   ejecuta cada `check` (enumera; no lee).
 *   Gráfica: `explain.{threshold, lambda, upperBound, phenomenological}.body` (T-E2
 *   `checkThreshold`, `checkLambdaDefinition`, T-E3 `checkUpperBound`, T-E4
 *   `checkPhenomenologicalDetectors`); `explain.logAxis.body` es sólo revisable (por qué un
 *   eje logarítmico: una razón de diseño, no un predicado). Reto: `explain.challengeRule.body`
 *   (`checkChallengeRule`, y `test_intent_challenge_accepts_equivalence_class`
 *   mide la misma regla sobre el juez).
 * EXPIRA SI: nunca (es la regla de la casa).
 */

type Tree = { [key: string]: string | Tree };

const ROOT = process.cwd();

function readLocale(code: string): Tree {
  return JSON.parse(
    readFileSync(join(ROOT, "src", "locales", `${code}.json`), "utf8"),
  ) as Tree;
}

function lookup(tree: Tree, key: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

const LOCALES = { en: readLocale("en"), es: readLocale("es") } as const;

// The keys of D13 marked "sí" whose text ships in this tree; one entry each in
// PREDICATES. Hand-maintained on purpose: a new verifiable text is a new line
// here AND a new predicate below, both visible in the diff.
const VERIFIABLE: readonly string[] = [
  "explain.stabilizer.body",
  "explain.matching.body",
  "explain.distance.body",
  "explain.verdictRule.body",
  "explain.yError.body",
  "explain.challengeRule.body",
  "explain.threshold.body",
  "explain.lambda.body",
  "explain.upperBound.body",
  "explain.phenomenological.body",
  "explain.measurementFlip.body",
  "explain.dataErrorPersists.body",
  "explain.finalPlane.body",
];

interface Predicate {
  readonly key: string;
  /** Repo-relative file of the test that measures the sentence. */
  readonly measuredBy: string;
  /** The predicate itself, run by T-E1 (enumerated against the core). */
  readonly check: () => void;
}

const SELF = "tests/intent/explanations.test.ts";
const TYPES: readonly StabilizerType[] = ["Z", "X"];

function randomError(code: RotatedSurfaceCode, seed: number, p: number) {
  const rng = createRng(seed);
  const noise = independentNoise(p);
  const error = identity(code.n);
  return { next: () => sampleNoise(noise, rng, error) };
}

// "A Z stabilizer flips when an odd number of its qubits carry an X component;
// an X stabilizer, when an odd number carry a Z component": the syndrome the
// core computes IS that parity, for every stabilizer of 10⁴ random errors in
// d = 5 at p = 0.15; and every stabilizer has 2 or 4 qubits.
function checkStabilizerParity(): void {
  const code = rotatedSurfaceCode(5);
  const errors = randomError(code, 20261018, 0.15);
  const out: Record<StabilizerType, Uint8Array> = {
    Z: new Uint8Array(code.stabilizersByType.Z.length),
    X: new Uint8Array(code.stabilizersByType.X.length),
  };
  for (const s of code.stabilizers) expect([2, 4]).toContain(s.qubits.length);
  let defects = 0;
  for (let shot = 0; shot < 10_000; shot++) {
    const error = errors.next();
    for (const type of TYPES) {
      const syndrome = computeTypeSyndrome(code, type, error, out[type]);
      const mask = type === "Z" ? error.x : error.z;
      for (const s of code.stabilizersByType[type]) {
        let odd = 0;
        for (const q of s.qubits) odd ^= mask[q]!;
        expect(syndrome[s.typeIndex]).toBe(odd);
        defects += odd;
      }
    }
  }
  expect(defects).toBeGreaterThan(0); // the enumeration saw real defects
}

// Same graph with the integer weights replaced by qubit counts: Σ W_q over a
// path is k·S + Σ frac with Σ frac < k·16 760 < S, so floor(dist / S) is the
// number of qubits on the path.
function hopGraph(graph: DefectGraph): DefectGraph {
  const hops = (table: ArrayLike<number>) =>
    Int32Array.from(table, (w) => Math.floor(w / WEIGHT_SCALE));
  return {
    ...graph,
    dist: hops(graph.dist),
    boundaryDist: hops(graph.boundaryDist),
  };
}

// "The decoder pairs every defect with another defect or with the boundary,
// choosing the pairing whose paths flip the fewest qubits in total; the
// correction flips the qubits along those paths": Blossom's weight equals the
// exact DP minimum (perturbed weights) AND the number of flipped qubits equals
// the exact minimum under hop counts, for 200 random syndromes with ≤ 12
// defects per type in d = 3 and d = 5.
function checkMatchingIsMinimum(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    for (const type of TYPES) {
      const dec = createDecoder(code, type);
      const hops = hopGraph(dec.graph);
      const m = dec.graph.m;
      const correction = identity(code.n);
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.nat(m - 1), { maxLength: 12 }),
          (defects) => {
            const syndrome = new Uint8Array(m);
            for (const i of defects) syndrome[i] = 1;
            const total = decode(dec, syndrome, correction);
            expect(total).toBe(exactMatchingWeight(dec.graph, defects));
            expect(weight(correction)).toBe(exactMatchingWeight(hops, defects));
            // The correction removes every defect of its type.
            const after = computeTypeSyndrome(
              code,
              type,
              correction,
              new Uint8Array(m),
            );
            expect(after).toEqual(syndrome);
          },
        ),
        { numRuns: 200, seed: 20261018 },
      );
    }
  }
}

function isLogical(code: RotatedSurfaceCode, p: ReadonlyPauli): boolean {
  const syndrome = computeSyndrome(
    code,
    p,
    new Uint8Array(code.stabilizers.length),
  );
  if (syndrome.some((bit) => bit !== 0)) return false;
  const effect = logicalEffect(code, p);
  return effect.x || effect.z;
}

// Every Pauli of weight ≤ maxWeight on code (each chosen qubit X, Z or Y).
function* paulisUpTo(
  code: RotatedSurfaceCode,
  maxWeight: number,
): Generator<Pauli> {
  const n = code.n;
  const components = [
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  const out = identity(n);
  const qubits: number[] = [];
  const choices: number[] = [];
  function* rec(from: number): Generator<Pauli> {
    if (qubits.length > 0) {
      out.x.fill(0);
      out.z.fill(0);
      qubits.forEach((q, k) => {
        const [x, z] = components[choices[k]!]!;
        out.x[q] = x;
        out.z[q] = z;
      });
      yield out;
    }
    if (qubits.length === maxWeight) return;
    for (let q = from; q < n; q++) {
      for (let c = 0; c < components.length; c++) {
        qubits.push(q);
        choices.push(c);
        yield* rec(q + 1);
        qubits.pop();
        choices.pop();
      }
    }
  }
  yield* rec(0);
}

function decodeResidual(
  code: RotatedSurfaceCode,
  decoders: Record<StabilizerType, ReturnType<typeof createDecoder>>,
  error: ReadonlyPauli,
  correction: Pauli,
  residual: Pauli,
): Pauli {
  for (const type of TYPES) {
    const dec = decoders[type];
    const syndrome = computeTypeSyndrome(
      code,
      type,
      error,
      new Uint8Array(dec.graph.m),
    );
    const part = identity(code.n);
    decode(dec, syndrome, part);
    if (type === "Z") correction.x.set(part.x);
    else correction.z.set(part.z);
  }
  return multiplyInto(residual, error, correction);
}

// "The distance d is the size of the smallest error that changes the encoded
// information while leaving no defect: it has d flips, for example X along one
// full column or Z along one full row. Any error with at most (d − 1)/2 flips
// is always corrected": in d = 3 no Pauli of weight ≤ 2 is a logical operator (so the
// minimum is exactly 3); in d = 5 this probes weight ≤ 2 only, and "minimum
// exactly 5" is measured by src/core/lattice/rotated.test.ts (T8b/T8c). X on a
// full column and Z on a full row (weight d) are logical with null syndrome:
// the example the text gives. The text does not claim every minimal logical
// operator is straight (most are not: 8 of weight 3 in d = 3, only 3 straight).
// Every error of weight ≤ (d − 1)/2 is corrected by the decoder.
function checkDistance(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const probe = d === 3 ? d - 1 : 2;
    let count = 0;
    for (const p of paulisUpTo(code, probe)) {
      count++;
      expect(isLogical(code, p)).toBe(false);
    }
    expect(count).toBeGreaterThan(0);
    expect(weight(code.logicalX)).toBe(d);
    expect(isLogical(code, code.logicalX)).toBe(true);
    expect(weight(code.logicalZ)).toBe(d);
    expect(isLogical(code, code.logicalZ)).toBe(true);

    const decoders = {
      Z: createDecoder(code, "Z"),
      X: createDecoder(code, "X"),
    };
    const correction = identity(code.n);
    const residual = identity(code.n);
    let corrected = 0;
    for (const error of paulisUpTo(code, (d - 1) / 2)) {
      decodeResidual(code, decoders, error, correction, residual);
      expect(isStabilizerEquivalent(code, residual)).toBe(true);
      corrected++;
    }
    expect(corrected).toBeGreaterThan(0);
  }
}

// "Y = X·Z: an X flip and a Z flip on the same qubit at once. The Z
// stabilizers see only its X part, the X stabilizers only its Z part, and the
// two parts are corrected separately": for every qubit of d = 3 and d = 5,
// multiplyInto(X_q, Z_q) is Y_q, its Z-type syndrome equals X_q's and its
// X-type syndrome equals Z_q's, and the decoded residual is a stabilizer.
function checkYIsXTimesZ(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const decoders = {
      Z: createDecoder(code, "Z"),
      X: createDecoder(code, "X"),
    };
    const correction = identity(code.n);
    const residual = identity(code.n);
    for (let q = 0; q < code.n; q++) {
      const xq = pauliFrom(code.n, [q], []);
      const zq = pauliFrom(code.n, [], [q]);
      const yq = multiplyInto(identity(code.n), xq, zq);
      expect(yq).toEqual(pauliFrom(code.n, [q], [q]));
      for (const type of TYPES) {
        const m = code.stabilizersByType[type].length;
        const ofY = computeTypeSyndrome(code, type, yq, new Uint8Array(m));
        const ofPart = computeTypeSyndrome(
          code,
          type,
          type === "Z" ? xq : zq,
          new Uint8Array(m),
        );
        expect(ofY).toEqual(ofPart);
        expect(ofY.some((bit) => bit !== 0)).toBe(true); // the part is seen
      }
      decodeResidual(code, decoders, yq, correction, residual);
      expect(isStabilizerEquivalent(code, residual)).toBe(true);
    }
  }
}

// "What is left is the error times the correction, with no defects. Count its
// X flips along any complete row and its Z flips along any complete column (a
// Y counts as both). Both counts even: a product of stabilizers, the logical
// qubit is intact. Either odd: a logical operator": enumerated over every X-only
// and Z-only error of d = 3 (2 × 2⁹) and 1 000 random X/Z errors of d = 5 and 7
// through the same decode path the walkthrough uses (decodeTrace); for EVERY
// row and column the parity equals the decoder's logical flag, the residual has
// no defect, and "both even" is exactly isStabilizerEquivalent. The same rule is
// measured on its own in src/ui/steps/verdict-rule.test.ts.
function lineParity(
  bits: ArrayLike<number>,
  d: number,
  line: number,
  alongRow: boolean,
): number {
  let parity = 0;
  for (let k = 0; k < d; k++) {
    parity ^= bits[alongRow ? qubitIndex(d, line, k) : qubitIndex(d, k, line)]!;
  }
  return parity;
}

function checkVerdictRuleOn(
  code: RotatedSurfaceCode,
  ctx: ReturnType<typeof createTraceContext>,
  error: { x: Uint8Array; z: Uint8Array },
): void {
  const d = code.d;
  const trace = decodeTrace(ctx, { n: code.n, x: error.x, z: error.z });
  const residual = trace.residual;
  const x = (trace.verdict & LOGICAL_X) !== 0 ? 1 : 0;
  const z = (trace.verdict & LOGICAL_Z) !== 0 ? 1 : 0;
  for (let line = 0; line < d; line++) {
    expect(lineParity(residual.x, d, line, true)).toBe(x);
    expect(lineParity(residual.z, d, line, false)).toBe(z);
  }
  const syndrome = computeSyndrome(
    code,
    residual,
    new Uint8Array(code.stabilizers.length),
  );
  expect(syndrome.every((bit) => bit === 0)).toBe(true);
  expect(isStabilizerEquivalent(code, residual)).toBe(x === 0 && z === 0);
}

function checkVerdictRule(): void {
  {
    const d = 3;
    const code = rotatedSurfaceCode(d);
    const ctx = createTraceContext(d);
    for (let mask = 0; mask < 1 << (d * d); mask++) {
      const bits = new Uint8Array(d * d);
      for (let q = 0; q < d * d; q++) bits[q] = (mask >> q) & 1;
      checkVerdictRuleOn(code, ctx, { x: bits, z: new Uint8Array(d * d) });
      checkVerdictRuleOn(code, ctx, { x: new Uint8Array(d * d), z: bits });
    }
  }
  for (const d of [5, 7] as const) {
    const code = rotatedSurfaceCode(d);
    const ctx = createTraceContext(d);
    const rng = createRng(20261017 + d);
    const noise = independentNoise(0.15);
    const error = {
      n: code.n,
      x: new Uint8Array(code.n),
      z: new Uint8Array(code.n),
    };
    let logical = 0;
    for (let shot = 0; shot < 1000; shot++) {
      sampleNoise(noise, rng, error);
      checkVerdictRuleOn(code, ctx, error);
      if (!isStabilizerEquivalent(code, decodeTrace(ctx, error).residual))
        logical++;
    }
    expect(logical).toBeGreaterThan(0); // both branches of the rule exercised
  }
}

function countType(mask: ArrayLike<number>): number {
  let w = 0;
  for (let q = 0; q < mask.length; q++) w += mask[q]! & 1;
  return w;
}

// "Any correction that leaves only a product of stabilizers is accepted: no
// defect left and the encoded information unchanged. It need not be the
// decoder's. The bonus needs the same number of X flips and the same number of
// Z flips as the decoder's correction": `judge` over 1 000 puzzles of d = 5 at
// LEVEL_P, on C_MWPM, C_MWPM·S (S a stabilizer), C_MWPM·X_L and C_MWPM·Z_L:
// accepted ⇔ the residual has no defect and no logical effect ⇔
// isStabilizerEquivalent; bonus ⇔ accepted and the per-type flip counts equal
// the decoder's. When the decoder is right (verdict 0): C_MWPM accepted with
// the bonus, C_MWPM·S accepted, the logicals rejected; and a C ≠ C_MWPM of the
// same class and the same per-type counts (S of weight 2 sharing one qubit
// with C_MWPM) earns the bonus, on hundreds of puzzles. Mutant: a judge that
// compares with C_MWPM rejects C_MWPM·S. (A bonus on the total weight is not
// distinguishable here: MWPM is minimal per type over every class, so an
// accepted answer has at least the decoder's flips of each type and equal
// totals force equal counts; the per-type wording is the exact rule, not a
// stricter one.)
function checkChallengeRule(): void {
  const d = 5;
  const code = rotatedSurfaceCode(d);
  const ctx = createTraceContext(d);
  const scratch = new Uint8Array(code.stabilizers.length);
  const times = (a: ReadonlyPauli, b: ReadonlyPauli) =>
    multiplyInto(identity(a.n), a, b);
  let seed = 1;
  let right = 0;
  let sameCountsOther = 0;
  for (let i = 0; i < 1000; i++) {
    const puzzle = drawPuzzle(d, LEVEL_P[d], () => seed++);
    const trace = decodeTrace(ctx, puzzle.error);
    const mwpm = trace.correction;
    const mwpmX = countType(mwpm.x);
    const mwpmZ = countType(mwpm.z);
    const stabilizer = code.stabilizers[i % code.stabilizers.length]!.operator;
    const candidates = [
      mwpm,
      times(mwpm, stabilizer),
      times(mwpm, code.logicalX),
      times(mwpm, code.logicalZ),
    ];
    const results = candidates.map((c) => {
      const r = judge(code, puzzle.error, c, mwpm, scratch);
      const residual = times(puzzle.error, c);
      const noDefect = computeSyndrome(
        code,
        residual,
        new Uint8Array(code.stabilizers.length),
      ).every((bit) => bit === 0);
      const effect = logicalEffect(code, residual);
      expect(r.accepted, `puzzle ${i}`).toBe(
        noDefect && !effect.x && !effect.z,
      );
      expect(r.accepted).toBe(isStabilizerEquivalent(code, residual));
      expect(r.bonus).toBe(
        r.accepted && countType(c.x) === mwpmX && countType(c.z) === mwpmZ,
      );
      return r;
    });
    if (trace.verdict !== 0) continue;
    right++;
    expect(results.map((r) => r.accepted)).toEqual([true, true, false, false]);
    expect(results[0]!.bonus).toBe(true);
    // A different correction of the same class and the same counts per type.
    for (const s of code.stabilizers) {
      if (s.qubits.length !== 2) continue;
      const part = s.type === "X" ? mwpm.x : mwpm.z;
      const overlap = s.qubits.filter((q) => part[q] === 1).length;
      if (overlap !== 1) continue;
      const other = times(mwpm, s.operator);
      expect(pauliEquals(other, mwpm)).toBe(false);
      const r = judge(code, puzzle.error, other, mwpm, scratch);
      expect(r).toMatchObject({ accepted: true, bonus: true });
      sameCountsOther++;
      break;
    }
  }
  expect(right).toBeGreaterThan(900);
  expect(right).toBeLessThan(1000);
  expect(sameCountsOther).toBeGreaterThan(100);
}

// T-E2. "Below a threshold a bigger code fails less often; above it, more
// often. Here each pair of sizes crosses at its own p, all between 9 and 10 %
// with perfect measurements and between 2 and 3 % with measurement failures
// (measured against PyMatching): left of a pair's crossing its Λ > 1, right of
// it Λ < 1": on each validated base (docs/validacion/browser*.json, N = 10⁵
// per point, compared with PyMatching), at the first p of its grid
// P_L(7) < P_L(5) < P_L(3) with the three Wilson intervals disjoint, at the
// last p the reverse order, also disjoint; the sign change of P_L(3) − P_L(5),
// of P_L(5) − P_L(7) and of P_L(3) − P_L(7) happens once each, inside the range
// the text states; and Λ(3→5), Λ(5→7) > 1 at the first p and < 1 at the last.
// CROSSING_RANGE is what the TEXT says, in p; test_intent_chart_texts_cite_
// the_measured_figures below checks it is exactly the union of the grid
// intervals where the three pairs change sign (computed from the bases, not
// copied) and that both locales print its two ends (the
// figures used to be tied to nothing; five false figures stayed green).
const CROSSING_RANGE: Readonly<Record<NoiseKind, readonly [number, number]>> = {
  independent: [0.09, 0.1],
  phenomenological: [0.02, 0.03],
};

const PAIRS: readonly (readonly [number, number])[] = [
  [3, 5],
  [5, 7],
  [3, 7],
];

/** The grid interval [p_i−1, p_i] where P_L(a) − P_L(b) changes sign. */
function crossingInterval(
  model: NoiseKind,
  [a, b]: readonly [number, number],
): readonly [number, number] {
  const base = BASELINES[model];
  const grid = base.probabilities;
  const at = (d: number, p: number) =>
    base.points.find((pt) => pt.d === d && pt.p === p)!;
  const signs = grid.map((p) =>
    Math.sign(at(a, p).estimate - at(b, p).estimate),
  );
  expect(signs[0], `${model} (${a}, ${b}) at the first p`).toBe(1);
  expect(signs.at(-1), `${model} (${a}, ${b}) at the last p`).toBe(-1);
  const changes = grid.filter((_, i) => i > 0 && signs[i] !== signs[i - 1]);
  expect(changes, `${model} (${a}, ${b})`).toHaveLength(1);
  const i = grid.indexOf(changes[0]!);
  return [grid[i - 1]!, grid[i]!];
}

function checkThreshold(): void {
  for (const model of NOISE_KINDS) {
    const base = BASELINES[model];
    const grid = base.probabilities;
    const at = (d: number, p: number) =>
      base.points.find((pt) => pt.d === d && pt.p === p)!;
    const first = grid[0]!;
    const last = grid.at(-1)!;
    // Order and disjoint intervals at the ends of the grid.
    expect(at(7, first).high).toBeLessThan(at(5, first).low);
    expect(at(5, first).high).toBeLessThan(at(3, first).low);
    expect(at(3, last).high).toBeLessThan(at(5, last).low);
    expect(at(5, last).high).toBeLessThan(at(7, last).low);
    // One crossing per pair, inside the stated range (the grid interval where
    // the difference changes sign lies within it).
    const [lo, hi] = CROSSING_RANGE[model];
    for (const pair of PAIRS) {
      const [below, above] = crossingInterval(model, pair);
      expect(below).toBeGreaterThanOrEqual(lo);
      expect(above).toBeLessThanOrEqual(hi);
    }
    // Λ on each side of the crossing.
    const points = poolPoints(base.points, []);
    for (const d of [3, 5]) {
      expect(lambdaAt(points, d, first)!.low).toBeGreaterThan(1);
      expect(lambdaAt(points, d, last)!.high).toBeLessThan(1);
    }
  }
}

// "Λ = P_L(d) / P_L(d + 2) at the chosen p: how many times fewer logical
// errors the next size makes. Λ > 1 means adding qubits helped; its interval
// combines the uncertainty of both rates": for every (d, p) of both bases, the
// Λ the chart shows (lambdaAt) is ratioInterval on the counts, its ratio is
// the quotient of the two estimates, Λ > 1 ⇔ P_L(d) > P_L(d + 2), and its
// interval contains the ratio. That interval is the delta method on log Λ
// (stats.ts: ratio · exp(±z·σ) with σ² = (1 − p₁)/k₁ + (1 − p₂)/k₂), NOT the
// quotients of the ends of the two Wilson intervals, which would be wider
// (measured [1.821, 2.109] against [1.769, 2.170]
// at p = 0.01, d = 3 → 5). The Willow figure (≈ 2.14) is a citation, not
// measured here.
function checkLambdaDefinition(): void {
  for (const model of NOISE_KINDS) {
    const base = BASELINES[model];
    const points = poolPoints(base.points, []);
    let seen = 0;
    for (const p of base.probabilities) {
      for (const d of [3, 5]) {
        const a = base.points.find((pt) => pt.d === d && pt.p === p)!;
        const b = base.points.find((pt) => pt.d === d + 2 && pt.p === p)!;
        const lambda = lambdaAt(points, d, p)!;
        const expected = ratioInterval(
          a.failures,
          a.shots,
          b.failures,
          b.shots,
        )!;
        expect(lambda).toEqual(expected);
        // The ratio of the two rates on the counts; a base point stopped by
        // failures carries the (k − 1)/(N − 1) estimate (docs/spec.md §3), 1 %
        // away at k = 100 and well inside the interval, and the sign of
        // Λ − 1 agrees with it at every point.
        expect(lambda.ratio).toBeCloseTo(
          a.failures / a.shots / (b.failures / b.shots),
          12,
        );
        expect(lambda.ratio > 1).toBe(a.estimate > b.estimate);
        expect(lambda.low).toBeLessThan(lambda.ratio);
        expect(lambda.ratio).toBeLessThan(lambda.high);
        seen++;
      }
    }
    expect(seen).toBe(16);
  }
}

// T-E3. "A point with no logical error yet in N shots is drawn as an open
// marker with an arrow at its upper bound, never as zero: with 95 % confidence
// the true rate is below about 4/N. More shots push the bound down until the
// first failure gives a measured point": wilsonInterval(0, N).high ≤ 4/N for
// every N in [1, 10³] and for N log-spaced up to 10⁷ (closed form z²/(N + z²)
// with z = 1.96: 3.84/(N + 3.84)), above 3/N from N = 20 on (so "about 4/N"
// is not an overstatement either), strictly decreasing in N, and low = 0; the
// first failure gives low > 0. The open marker itself is
// tests/intent/chart-conventions (test_intent_zero_failures_is_upper_bound).
function checkUpperBound(): void {
  const sizes = new Set<number>();
  for (let n = 1; n <= 1000; n++) sizes.add(n);
  for (let e = 3; e <= 7; e += 0.25) sizes.add(Math.round(10 ** e));
  let previous = Number.POSITIVE_INFINITY;
  for (const n of [...sizes].sort((a, b) => a - b)) {
    const { low, high } = wilsonInterval(0, n);
    expect(low).toBe(0);
    expect(high, `N = ${n}`).toBeLessThanOrEqual(4 / n);
    if (n >= 20) expect(high, `N = ${n}`).toBeGreaterThan(3 / n);
    expect(high).toBeLessThan(previous);
    previous = high;
  }
  expect(wilsonInterval(1, 1000).low).toBeGreaterThan(0);
}

// T-E4. "Each stabilizer measurement also fails with probability p, so it is
// repeated d times, closed by a perfect final readout. A misread shows as two
// defects on one stabilizer, a cycle apart; a data error shows once, in its
// cycle, on the stabilizers around it": with detectorsOf over cycles = d
// (d ∈ {3, 5, 7}), for every type, every stabilizer s and every cycle r, a history
// with no data error and one measurement flip at (s, r) has exactly the two
// detectors (r, s) and (r + 1, s); a history with one data error on qubit q
// from cycle r on (cumulative: present in every layer ≥ r) and no flip has, in
// layer r, exactly the one-cycle syndrome of that error and nothing in any
// other layer, including the final perfect readout. The last layer being
// perfect, a flip in the last cycle still shows twice (its second detector is
// the readout's).
function checkPhenomenologicalDetectors(): void {
  for (const d of [3, 5, 7]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    for (const type of TYPES) {
      const m = code.stabilizersByType[type].length;
      const layers = cycles + 1;
      const out = new Uint8Array(m * layers);
      const none = identity(code.n);
      const noFlips = () =>
        Array.from({ length: cycles }, () => new Uint8Array(m));
      // One measurement flip at (s, r).
      for (let r = 1; r <= cycles; r++) {
        for (let s = 0; s < m; s++) {
          const flips = noFlips();
          flips[r - 1]![s] = 1;
          const errors = Array.from({ length: cycles }, () => none);
          detectorsOf(code, type, cycles, errors, flips, out);
          const lit = [...out].flatMap((bit, i) => (bit ? [i] : []));
          expect(lit, `${type} flip (${s}, ${r}) d = ${d}`).toEqual([
            (r - 1) * m + s,
            r * m + s,
          ]);
        }
      }
      // One data error on q from cycle r on.
      for (let r = 1; r <= cycles; r++) {
        for (let q = 0; q < code.n; q++) {
          const error =
            type === "Z"
              ? pauliFrom(code.n, [q], [])
              : pauliFrom(code.n, [], [q]);
          const errors = Array.from({ length: cycles }, (_, i) =>
            i + 1 >= r ? error : none,
          );
          detectorsOf(code, type, cycles, errors, noFlips(), out);
          const syndrome = computeTypeSyndrome(
            code,
            type,
            error,
            new Uint8Array(m),
          );
          expect(syndrome.some((bit) => bit === 1)).toBe(true);
          for (let layer = 1; layer <= layers; layer++) {
            const slice = out.subarray((layer - 1) * m, layer * m);
            expect(
              [...slice],
              `${type} error on ${q} at cycle ${r}, layer ${layer}, d = ${d}`,
            ).toEqual(
              layer === r ? [...syndrome] : new Array<number>(m).fill(0),
            );
          }
        }
      }
    }
  }
}

// T-G8a (tasks/plans/phase2-g.md §4). "A measurement failure flips
// one reading of one stabilizer in one cycle; the qubits do not change.
// Because each detector compares a reading with the previous one, it shows as
// two defects on that stabilizer in consecutive layers (the second may be the
// final readout). The decoder joins them with a time edge and corrects no
// qubit": for d ∈ {3, 5}, cycles = d, every
// type, every check s and every cycle r, a history with that one flip has
// readingsOf lit at (r, s) only (the qubits' cumulative error is the identity
// in every layer), detectorsOf lit at (r, s) and (r + 1, s) only, and
// decodeSpacetimeHistory gives an empty correction, verdict 0 and exactly one
// chain of one edge whose edgeQubit is −1.
function checkMeasurementFlip(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const m = (code.n - 1) / 2;
    const out = new Uint8Array(m * (cycles + 1));
    for (const type of TYPES) {
      const g = ctx.decoders[type].graph;
      for (let r = 1; r <= cycles; r++) {
        for (let s = 0; s < m; s++) {
          const history = createSpacetimeHistory(code, cycles);
          history.flips[r - 1]![type][s] = 1;
          const cumulative = cumulativeErrorsOf(
            history,
            Array.from({ length: cycles }, () => identity(code.n)),
          );
          for (const c of cumulative) expect(weight(c)).toBe(0);
          const flips = history.flips.map((f) => f[type]);
          readingsOf(code, type, cycles, cumulative, flips, out);
          expect(lit(out), `reading ${type} (${s}, ${r}) d = ${d}`).toEqual([
            nodeIndex(g, r, s),
          ]);
          detectorsOf(code, type, cycles, cumulative, flips, out);
          expect(lit(out), `detectors ${type} (${s}, ${r}) d = ${d}`).toEqual([
            nodeIndex(g, r, s),
            nodeIndex(g, r + 1, s),
          ]);
          expect(decodeSpacetimeHistory(ctx, history)).toBe(0);
          expect(weight(ctx.correction)).toBe(0);
          const chains = spacetimeChains(ctx.decoders[type]);
          expect(chains).toHaveLength(1);
          expect(chains[0]!.edges).toHaveLength(1);
          expect(g.edgeQubit[chains[0]!.edges[0]!]).toBe(-1);
          const other = type === "Z" ? "X" : "Z";
          expect(spacetimeChains(ctx.decoders[other])).toHaveLength(0);
        }
      }
    }
  }
}

// T-G8b (the trap of the viewer's texts). "A data error stays on its qubit. From its
// cycle to the final readout, each neighbouring stabilizer reads the parity of
// the errors it detects around it: one error alone keeps it lit; a second
// equal error beside it, or a measurement failure, inverts that reading. The
// detector marks only the cycle in which the reading changed" (the
// first wording said the reading persists, full stop; with p = 0.01
// a quarter of the errors at d = 5 have a neighbour or a flip that inverts
// it). First half: for d ∈ {3, 5}, every qubit q and cycle r₀, a history with
// one X (Z) error on q in cycle r₀ and no flip has, in every layer ≥ r₀
// including the final one,
// readingsOf of the Z (X) type equal to the one-cycle syndrome of that error
// and zero before; detectorsOf equal to that syndrome in layer r₀ only (also
// T-E4); and the decoder corrects it: residual with null syndrome, verdict 0,
// a correction of exactly one qubit of that type.
function checkDataErrorPersists(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const m = (code.n - 1) / 2;
    const out = new Uint8Array(m * (cycles + 1));
    const syndrome = new Uint8Array(m);
    for (const type of TYPES) {
      for (let r0 = 1; r0 <= cycles; r0++) {
        for (let q = 0; q < code.n; q++) {
          const history = createSpacetimeHistory(code, cycles);
          const error = history.cycleErrors[r0 - 1]!;
          if (type === "Z") error.x[q] = 1;
          else error.z[q] = 1;
          const cumulative = cumulativeErrorsOf(
            history,
            Array.from({ length: cycles }, () => identity(code.n)),
          );
          computeTypeSyndrome(code, type, error, syndrome);
          const expected = lit(syndrome);
          expect(expected.length).toBeGreaterThan(0);
          const flips = history.flips.map((f) => f[type]);
          readingsOf(code, type, cycles, cumulative, flips, out);
          for (let layer = 1; layer <= cycles + 1; layer++) {
            const slice = lit(out.subarray((layer - 1) * m, layer * m));
            expect(
              slice,
              `reading ${type}, q = ${q} from ${r0}, layer ${layer}, d = ${d}`,
            ).toEqual(layer >= r0 ? expected : []);
          }
          detectorsOf(code, type, cycles, cumulative, flips, out);
          for (let layer = 1; layer <= cycles + 1; layer++) {
            const slice = lit(out.subarray((layer - 1) * m, layer * m));
            expect(
              slice,
              `detectors ${type}, q = ${q} from ${r0}, layer ${layer}, d = ${d}`,
            ).toEqual(layer === r0 ? expected : []);
          }
          expect(decodeSpacetimeHistory(ctx, history)).toBe(0);
          const mask = type === "Z" ? ctx.correction.x : ctx.correction.z;
          const otherMask = type === "Z" ? ctx.correction.z : ctx.correction.x;
          expect(lit(mask)).toHaveLength(1);
          expect(lit(otherMask)).toHaveLength(0);
          for (const t of TYPES) {
            computeTypeSyndrome(code, t, ctx.residual, syndrome);
            expect(lit(syndrome)).toEqual([]);
          }
        }
      }
    }
    // Second half, the parity: for every stabilizer s of the type and every
    // pair of its qubits, two equal errors on them in cycle r₀ ∈ {1, cycles}
    // leave s's reading at 0 in every layer (they cancel on the stabilizer
    // they share) while the checks touching only one of them stay lit from
    // r₀; and a measurement failure on one of those lit checks in cycle r₀
    // inverts that one reading in that layer only.
    for (const type of TYPES) {
      for (const s of code.stabilizers) {
        if (s.type !== type) continue;
        for (let a = 0; a < s.qubits.length; a++) {
          for (let b = a + 1; b < s.qubits.length; b++) {
            for (const r0 of [1, cycles]) {
              const history = createSpacetimeHistory(code, cycles);
              const error = history.cycleErrors[r0 - 1]!;
              const component = type === "Z" ? error.x : error.z;
              component[s.qubits[a]!] = 1;
              component[s.qubits[b]!] = 1;
              const cumulative = cumulativeErrorsOf(
                history,
                Array.from({ length: cycles }, () => identity(code.n)),
              );
              computeTypeSyndrome(code, type, error, syndrome);
              expect(syndrome[s.typeIndex]).toBe(0);
              const expected = lit(syndrome);
              const flipped = expected[0];
              if (flipped !== undefined)
                history.flips[r0 - 1]![type][flipped] = 1;
              const flips = history.flips.map((f) => f[type]);
              readingsOf(code, type, cycles, cumulative, flips, out);
              for (let layer = 1; layer <= cycles + 1; layer++) {
                const slice = lit(out.subarray((layer - 1) * m, layer * m));
                const want =
                  layer < r0
                    ? []
                    : layer === r0 && flipped !== undefined
                      ? expected.slice(1)
                      : expected;
                expect(
                  slice,
                  `reading ${type}, pair ${s.qubits[a]},${s.qubits[b]} from ${r0}, layer ${layer}, d = ${d}`,
                ).toEqual(want);
              }
            }
          }
        }
      }
    }
  }
}

// T-G8c. "The correction acts on the qubits after the last cycle: each qubit
// is flipped as many times as the chains' space edges cross it, from any
// cycle; an even number leaves it unchanged. Time edges flip no qubit. The
// final readout never fails, so each of its defects comes from a measurement
// failure in the last cycle" (the current wording): over 1 000
// random histories per d ∈ {3, 5, 7} (cycles = d, p ∈ [0.01, 0.2]),
// correction.x is exactly the XOR of edgeQubit ≥ 0 over every edge of every Z
// chain (and .z over X chains), the time edges of the chains (index ≥
// n·cycles) all carrying edgeQubit = −1; residual = C_cycles · correction; no
// space edge of either graph has an endpoint in the last layer (also T-A3);
// readingsOf in the last layer equals H·C_cycles even with every flip set;
// and the detectors of the last layer are EXACTLY the flips of the last
// cycle, D_L = f_cycles (the first wording said the
// opposite), also for one flip at every (s, cycles) and one data error in
// the last cycle on every qubit (D_L empty). "Flipped once" (an earlier
// wording) was false: the XOR is a parity, so a qubit crossed by TWO space edges is
// not flipped: pinned on a hand-built history (an X, then a Z, on the
// central qubit in cycles 1 and d, d ∈ {3, 5}: two chains of one space edge
// each over that qubit, correction 0, cumulative identity) and on the
// a random one (d = 5, createRng(4247), p = 0.01, shot 43: the X
// chains cross qubit 14 twice, correction.z[14] = 0).
function crossingsOf(
  ctx: ReturnType<typeof createSpacetimeShotContext>,
  type: StabilizerType,
  n: number,
): number[] {
  const g = ctx.decoders[type].graph;
  const crossings = new Array<number>(n).fill(0);
  for (const chain of spacetimeChains(ctx.decoders[type]))
    for (const e of chain.edges) {
      const q = g.edgeQubit[e]!;
      if (q >= 0) crossings[q]!++;
    }
  return crossings;
}

function checkEvenCrossingsCancel(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const q = (code.n - 1) / 2;
    for (const type of TYPES) {
      const history = createSpacetimeHistory(code, cycles);
      const first = history.cycleErrors[0]!;
      const last = history.cycleErrors[cycles - 1]!;
      if (type === "Z") {
        first.x[q] = 1;
        last.x[q] = 1;
      } else {
        first.z[q] = 1;
        last.z[q] = 1;
      }
      expect(decodeSpacetimeHistory(ctx, history)).toBe(0);
      const chains = spacetimeChains(ctx.decoders[type]);
      expect(chains.map((c) => c.edges.length)).toEqual([1, 1]);
      const crossings = crossingsOf(ctx, type, code.n);
      expect(crossings[q]).toBe(2);
      expect(crossings.reduce((a, b) => a + b, 0)).toBe(2);
      const mask = type === "Z" ? ctx.correction.x : ctx.correction.z;
      expect(mask[q]).toBe(0);
      expect(weight(ctx.correction)).toBe(0);
      expect(weight(ctx.cumulative)).toBe(0);
    }
  }
  const d = 5;
  const code = rotatedSurfaceCode(d);
  const ctx = createSpacetimeShotContext(
    code,
    phenomenologicalNoise(0, d),
    createRng(0),
  );
  const rng = createRng(4247);
  const history = createSpacetimeHistory(code, d);
  for (let shot = 0; shot <= 43; shot++)
    sampleSpacetimeHistory(phenomenologicalNoise(0.01, d), rng, code, history);
  decodeSpacetimeHistory(ctx, history);
  const crossings = crossingsOf(ctx, "X", code.n);
  expect(crossings[14]).toBe(2);
  expect(ctx.correction.z[14]).toBe(0);
}

function checkFinalPlane(): void {
  checkEvenCrossingsCancel();
  for (const d of [3, 5, 7]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const m = (code.n - 1) / 2;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const rng = createRng(20261017 + d);
    const history = createSpacetimeHistory(code, cycles);
    const cumulative = Array.from({ length: cycles }, () => identity(code.n));
    const expected = identity(code.n);
    const residual = identity(code.n);
    const out = new Uint8Array(m * (cycles + 1));
    const final = new Uint8Array(m);
    for (const type of TYPES) {
      const g = ctx.decoders[type].graph;
      for (let e = 0; e < g.edgeCount; e++) {
        if (g.edgeQubit[e]! >= 0) {
          expect(Math.floor(g.edgeU[e]! / m) + 1).toBeLessThanOrEqual(cycles);
          const v = g.edgeV[e]!;
          if (v >= 0) expect(Math.floor(v / m) + 1).toBeLessThanOrEqual(cycles);
        }
      }
    }
    const allFlips = Array.from({ length: cycles }, () =>
      new Uint8Array(m).fill(1),
    );
    const firstTimeEdge = code.n * cycles;
    // 1 000 histories at d = 3 and 5, 200 at d = 7 (the matcher, not the
    // predicate, is what a dense d = 7 syndrome costs: ≈ 6 s for 1 000).
    const histories = d === 7 ? 200 : 1000;
    let timeEdgesSeen = 0;
    for (let i = 0; i < histories; i++) {
      const p = 0.01 + rng.nextFloat() * 0.11;
      sampleSpacetimeHistory(
        phenomenologicalNoise(p, cycles),
        rng,
        code,
        history,
      );
      decodeSpacetimeHistory(ctx, history);
      cumulativeErrorsOf(history, cumulative);
      expected.x.fill(0);
      expected.z.fill(0);
      for (const type of TYPES) {
        const g = ctx.decoders[type].graph;
        const mask = type === "Z" ? expected.x : expected.z;
        for (const chain of spacetimeChains(ctx.decoders[type])) {
          for (const e of chain.edges) {
            const q = g.edgeQubit[e]!;
            if (e >= firstTimeEdge) {
              // A time edge: no qubit, ever.
              expect(q).toBe(-1);
              timeEdgesSeen++;
            } else {
              expect(q).toBeGreaterThanOrEqual(0);
              mask[q] = mask[q]! ^ 1;
            }
          }
        }
        // The last layer reads H·C_cycles whatever the flips say.
        readingsOf(code, type, cycles, cumulative, allFlips, out);
        computeTypeSyndrome(code, type, cumulative[cycles - 1]!, final);
        expect([...out.subarray(cycles * m)]).toEqual([...final]);
        // D_L = f_cycles: every defect of the final readout is a measurement
        // failure of the last cycle, and every such failure is a defect there.
        expect([...ctx.detectors[type].subarray(cycles * m)]).toEqual([
          ...history.flips[cycles - 1]![type],
        ]);
      }
      expect(pauliEquals(ctx.correction, expected)).toBe(true);
      multiplyInto(residual, cumulative[cycles - 1]!, ctx.correction);
      expect(pauliEquals(ctx.residual, residual)).toBe(true);
    }
    expect(timeEdgesSeen).toBeGreaterThan(0);
    // One mechanism at a time in the last cycle: a flip of (s, cycles) is the
    // one defect of the final readout; a data error there leaves it empty.
    for (const type of TYPES) {
      const g = ctx.decoders[type].graph;
      for (let s = 0; s < m; s++) {
        const one = createSpacetimeHistory(code, cycles);
        one.flips[cycles - 1]![type][s] = 1;
        decodeSpacetimeHistory(ctx, one);
        expect(lit(ctx.detectors[type].subarray(cycles * m))).toEqual([s]);
        expect(lit(ctx.detectors[type])).toEqual([
          nodeIndex(g, cycles, s),
          nodeIndex(g, cycles + 1, s),
        ]);
      }
      for (let q = 0; q < code.n; q++) {
        const one = createSpacetimeHistory(code, cycles);
        const error = one.cycleErrors[cycles - 1]!;
        if (type === "Z") error.x[q] = 1;
        else error.z[q] = 1;
        decodeSpacetimeHistory(ctx, one);
        expect(lit(ctx.detectors[type].subarray(cycles * m))).toEqual([]);
        expect(lit(ctx.detectors[type]).length).toBeGreaterThan(0);
      }
    }
  }
}

// T-G8d. The viewer's own matching text,
// `spacetime.explain.matching`: "so that the total weight of the paths, time
// edges included, is as small as possible: that can mean flipping more qubits
// than another pairing would". (i) Over 500 random histories per d ∈ {3, 5},
// the weight of the chains decodeSpacetimeHistory chose (Σ edgeWeight over
// every edge of every chain) is ≤ the weight of every defect matched to the
// boundary and ≤ three random perfect pairings of the same defects (consecutive
// pairs of a shuffle, the odd one out to the boundary), each path weighed
// with the graph's own dist / boundaryDist. (ii) A worst case: the same
// X check misread in all d cycles lights (1, s) and (L, s) only; the pure time
// chain costs d time edges, and the decoder never pays more than that; at d =
// 5 and 7 it goes to the boundary for EVERY X check (space edges, 0–6 qubits
// flipped by a shot with no data error at all) although at d = 3 it keeps the
// time chain for the interior checks (3 edges either way). Measured, not
// derived: 12/12 at d = 5, 24/24 at d = 7, 1/4 at d = 3 (the 2D text "fewest
// qubits in total" is false here, which is why the viewer no longer shows it).
function checkSpacetimeMatchingIsMinimum(): void {
  for (const d of [3, 5]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const rng = createRng(20261017 * d);
    const history = createSpacetimeHistory(code, cycles);
    for (let i = 0; i < 500; i++) {
      const p = 0.01 + rng.nextFloat() * 0.15;
      sampleSpacetimeHistory(
        phenomenologicalNoise(p, cycles),
        rng,
        code,
        history,
      );
      decodeSpacetimeHistory(ctx, history);
      for (const type of TYPES) {
        const g = ctx.decoders[type].graph;
        const M = g.nodes;
        const defects = lit(ctx.detectors[type]);
        let chosen = 0;
        for (const chain of spacetimeChains(ctx.decoders[type]))
          for (const e of chain.edges) chosen += g.edgeWeight[e]!;
        let allBoundary = 0;
        for (const u of defects) allBoundary += g.boundaryDist[u]!;
        expect(chosen).toBeLessThanOrEqual(allBoundary);
        for (let trial = 0; trial < 3; trial++) {
          const order = [...defects];
          for (let k = order.length - 1; k > 0; k--) {
            const j = Math.floor(rng.nextFloat() * (k + 1));
            [order[k], order[j]] = [order[j]!, order[k]!];
          }
          let alternative = 0;
          for (let k = 0; k + 1 < order.length; k += 2)
            alternative += g.dist[order[k]! * M + order[k + 1]!]!;
          if (order.length % 2 === 1)
            alternative += g.boundaryDist[order[order.length - 1]!]!;
          expect(chosen).toBeLessThanOrEqual(alternative);
        }
      }
    }
  }
  const toBoundary: Record<number, number> = {};
  const totals: Record<number, number> = {};
  let moreQubitsThanTimeChain = 0;
  for (const d of [3, 5, 7]) {
    const code = rotatedSurfaceCode(d);
    const cycles = d;
    const ctx = createSpacetimeShotContext(
      code,
      phenomenologicalNoise(0, cycles),
      createRng(0),
    );
    const g = ctx.decoders.X.graph;
    const m = (code.n - 1) / 2;
    toBoundary[d] = 0;
    totals[d] = 0;
    for (let s = 0; s < m; s++) {
      const history = createSpacetimeHistory(code, cycles);
      for (let r = 0; r < cycles; r++) history.flips[r]!.X[s] = 1;
      decodeSpacetimeHistory(ctx, history);
      expect(lit(ctx.detectors.X)).toEqual([
        nodeIndex(g, 1, s),
        nodeIndex(g, cycles + 1, s),
      ]);
      const chains = spacetimeChains(ctx.decoders.X);
      let chosen = 0;
      for (const chain of chains)
        for (const e of chain.edges) chosen += g.edgeWeight[e]!;
      let timeChain = 0;
      for (let r = 0; r < cycles; r++)
        timeChain += g.edgeWeight[code.n * cycles + r * m + s]!;
      expect(chosen).toBeLessThanOrEqual(timeChain);
      totals[d]!++;
      if (chains.every((chain) => chain.b === BOUNDARY)) {
        expect(chosen).toBeLessThan(timeChain);
        toBoundary[d]!++;
        if (weight(ctx.correction) > 0) moreQubitsThanTimeChain++;
      } else {
        expect(chains).toHaveLength(1);
        expect(chains[0]!.edges).toHaveLength(cycles);
        expect(weight(ctx.correction)).toBe(0);
      }
    }
  }
  expect(toBoundary).toEqual({ 3: 1, 5: 12, 7: 24 });
  expect(totals).toEqual({ 3: 4, 5: 12, 7: 24 });
  expect(moreQubitsThanTimeChain).toBeGreaterThan(0);
}

describe("T-G8d the viewer's matching text is a predicate on the 3D decoder", () => {
  it("spacetime.explain.matching says 'total weight, time edges included' in both languages and the viewer no longer shows the 2D explain.matching", () => {
    const en = lookup(LOCALES.en, "spacetime.explain.matching") as string;
    const es = lookup(LOCALES.es, "spacetime.explain.matching") as string;
    expect(en).toMatch(/total weight of the paths, time edges included/);
    expect(es).toMatch(
      /peso total de los caminos, tramos temporales incluidos/,
    );
    expect(en).not.toMatch(/fewest qubits/);
    const panel = readFileSync(
      join(ROOT, "src", "ui", "spacetime", "SpacetimePanel.tsx"),
      "utf8",
    );
    expect(panel).not.toMatch(/<Explain id="matching"/);
  });

  it("the chosen chains weigh no more than any other pairing, and the d-fold misread goes to the boundary at d = 5 and 7", () => {
    checkSpacetimeMatchingIsMinimum();
  });

  it("the correction texts say a qubit is flipped as many times as space edges cross it, never 'once'; the detectors text names the final readout as a possible second layer", () => {
    for (const key of [
      "spacetime.explain.correction",
      "explain.finalPlane.body",
    ]) {
      const en = lookup(LOCALES.en, key) as string;
      const es = lookup(LOCALES.es, key) as string;
      expect(en, key).toMatch(/\beven\b/);
      expect(en, key).not.toMatch(/\bonce\b/);
      expect(es, key).toMatch(/\bpar\b/);
      expect(es, key).not.toMatch(/una (sola )?vez/);
    }
    for (const key of [
      "spacetime.explain.detectors",
      "explain.measurementFlip.body",
    ]) {
      const en = lookup(LOCALES.en, key) as string;
      const es = lookup(LOCALES.es, key) as string;
      expect(en, key).toMatch(
        /consecutive layers \(the second may be the final readout\)/,
      );
      expect(es, key).toMatch(
        /capas consecutivas \(la segunda puede ser la lectura final\)/,
      );
    }
  });

  it("the reading texts say a persisting reading is a parity that a neighbouring error or a failure inverts, and the errors text says equal errors cancel", () => {
    for (const key of [
      "explain.dataErrorPersists.body",
      "spacetime.explain.measurements",
    ]) {
      const en = lookup(LOCALES.en, key) as string;
      const es = lookup(LOCALES.es, key) as string;
      expect(en, key).toMatch(/\bparity\b/);
      expect(en, key).toMatch(/\binverts\b/);
      expect(en, key).not.toMatch(/the reading persists/);
      expect(es, key).toMatch(/\bparidad\b/);
      expect(es, key).toMatch(/\binvierte\b/);
      expect(es, key).not.toMatch(/la lectura persiste/);
    }
    const en = lookup(LOCALES.en, "spacetime.explain.errors") as string;
    const es = lookup(LOCALES.es, "spacetime.explain.errors") as string;
    expect(en).toMatch(/\bcancel\b/);
    expect(en).not.toMatch(/pile up/);
    expect(es).toMatch(/se cancelan/);
    expect(es).not.toMatch(/se acumulan/);
  });

  it("explain.finalPlane.body blames the last cycle's measurement failures and never says 'none'", () => {
    const en = lookup(LOCALES.en, "explain.finalPlane.body") as string;
    const es = lookup(LOCALES.es, "explain.finalPlane.body") as string;
    expect(en).toMatch(/measurement failure in the last cycle/);
    expect(en).not.toMatch(/\bnone\b/);
    expect(es).toMatch(/fallo de medición del último ciclo/);
    expect(es).not.toMatch(/\bningun[oa]\b/);
    for (const code of ["en", "es"] as const) {
      const label = lookup(
        LOCALES[code],
        "spacetime.finalLayerLabel",
      ) as string;
      expect(label).not.toMatch(/perfect[ao]?\)/);
    }
  });
});

function lit(mask: { readonly length: number; readonly [i: number]: number }) {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) out.push(i);
  return out;
}

const PREDICATES: readonly Predicate[] = [
  {
    key: "explain.measurementFlip.body",
    measuredBy: SELF,
    check: checkMeasurementFlip,
  },
  {
    key: "explain.dataErrorPersists.body",
    measuredBy: SELF,
    check: checkDataErrorPersists,
  },
  { key: "explain.finalPlane.body", measuredBy: SELF, check: checkFinalPlane },
  {
    key: "explain.stabilizer.body",
    measuredBy: SELF,
    check: checkStabilizerParity,
  },
  {
    key: "explain.matching.body",
    measuredBy: SELF,
    check: checkMatchingIsMinimum,
  },
  { key: "explain.distance.body", measuredBy: SELF, check: checkDistance },
  {
    key: "explain.verdictRule.body",
    measuredBy: SELF,
    check: checkVerdictRule,
  },
  { key: "explain.yError.body", measuredBy: SELF, check: checkYIsXTimesZ },
  {
    key: "explain.challengeRule.body",
    measuredBy: SELF,
    check: checkChallengeRule,
  },
  { key: "explain.threshold.body", measuredBy: SELF, check: checkThreshold },
  {
    key: "explain.lambda.body",
    measuredBy: SELF,
    check: checkLambdaDefinition,
  },
  { key: "explain.upperBound.body", measuredBy: SELF, check: checkUpperBound },
  {
    key: "explain.phenomenological.body",
    measuredBy: SELF,
    check: checkPhenomenologicalDetectors,
  },
];

describe("T-E1 the verifiable explanations are predicates on the core", () => {
  it.each(PREDICATES.map((p) => [p.key, p] as const))(
    "%s holds when enumerated",
    (_key, predicate) => {
      predicate.check();
    },
  );
});

describe("test_intent_explanations_are_predicates", () => {
  it("every verifiable key has exactly one predicate and every predicate is listed", () => {
    const keys = PREDICATES.map((p) => p.key);
    expect([...keys].sort()).toEqual([...VERIFIABLE].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every verifiable key exists in en.json and es.json and its measuring file exists", () => {
    for (const predicate of PREDICATES) {
      for (const [code, tree] of Object.entries(LOCALES)) {
        expect(
          typeof lookup(tree, predicate.key),
          `${code}.json: ${predicate.key}`,
        ).toBe("string");
      }
      expect(
        existsSync(join(ROOT, predicate.measuredBy)),
        predicate.measuredBy,
      ).toBe(true);
    }
  });

  it("every EXPLAIN_IDS entry has a title and a body in both languages, and no explain.* text is orphaned", () => {
    for (const [code, tree] of Object.entries(LOCALES)) {
      for (const id of EXPLAIN_IDS) {
        for (const part of ["title", "body"]) {
          expect(
            typeof lookup(tree, `explain.${id}.${part}`),
            `${code}.json: explain.${id}.${part}`,
          ).toBe("string");
        }
      }
      const branch = lookup(tree, "explain");
      expect(typeof branch).toBe("object");
      expect(Object.keys(branch as Tree).sort()).toEqual(
        [...EXPLAIN_IDS].sort(),
      );
    }
  });

  it("the verifiable keys are explain.*.body keys of listed ids", () => {
    for (const key of VERIFIABLE) {
      const match = /^explain\.([a-zA-Z]+)\.body$/.exec(key);
      expect(match, key).not.toBeNull();
      expect(EXPLAIN_IDS).toContain(match![1]);
    }
  });
});

/**
 * test_intent_chart_texts_cite_the_measured_figures
 *
 * INTENCIÓN: las cifras que citan los textos de la gráfica salen de la medición, no de la
 *   memoria de quien escribe: `CROSSING_RANGE` (lo que dice el texto del umbral, en p) es
 *   exactamente la unión de los intervalos de la malla donde cambian de signo los tres
 *   pares (3, 5), (5, 7) y (3, 7) de cada base validada, calculada aquí; `en` y `es` imprimen
 *   sus dos extremos con la fórmula de su idioma («between 9 and 10 %», «entre el 9 y el
 *   10 %»); y el texto de los marcadores abiertos cita «4/N», la cota que T-E3 mide.
 * CONTEXTO: el rango del texto era una copia a mano y ninguna
 *   cifra del texto estaba atada a un test (mutante con cinco cifras falsas → verde).
 * EXPIRA SI: los textos dejan de citar cifras (decisión de redacción con su test).
 */
describe("test_intent_chart_texts_cite_the_measured_figures", () => {
  it.each(NOISE_KINDS)(
    "%s: CROSSING_RANGE is the union of the sign-change intervals of the three pairs, computed from the base",
    (model) => {
      const intervals = PAIRS.map((pair) => crossingInterval(model, pair));
      const union = [
        Math.min(...intervals.map(([below]) => below)),
        Math.max(...intervals.map(([, above]) => above)),
      ];
      expect(union).toEqual([...CROSSING_RANGE[model]]);
    },
  );

  const percent = (p: number): string => String(Math.round(p * 100));
  const RANGE_WORDING: Readonly<
    Record<keyof typeof LOCALES, (lo: string, hi: string) => string>
  > = {
    en: (lo, hi) => `between ${lo} and ${hi} %`,
    es: (lo, hi) => `entre el ${lo} y el ${hi} %`,
  };

  it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])(
    "%s: the threshold text prints both ends of CROSSING_RANGE of each model, and the open-marker text prints 4/N",
    (code) => {
      const body = lookup(LOCALES[code], "explain.threshold.body") as string;
      for (const model of NOISE_KINDS) {
        const [lo, hi] = CROSSING_RANGE[model];
        expect(body, `${code}: ${model}`).toContain(
          RANGE_WORDING[code](percent(lo), percent(hi)),
        );
      }
      // Both ranges are integers in percent; the text must not round them away.
      for (const model of NOISE_KINDS) {
        for (const end of CROSSING_RANGE[model]) {
          expect(Math.abs(end * 100 - Math.round(end * 100))).toBeLessThan(
            1e-9,
          );
        }
      }
      expect(
        lookup(LOCALES[code], "explain.upperBound.body") as string,
      ).toContain("4/N");
      // The direction of Λ is part of the claim (inverting it in one language
      // stayed green): "Λ > 1" comes first (left of the crossing), "Λ < 1"
      // after, in every language.
      const above = body.indexOf("Λ > 1");
      const below = body.indexOf("Λ < 1");
      expect(above, `${code}: Λ > 1`).toBeGreaterThanOrEqual(0);
      expect(below, `${code}: Λ < 1`).toBeGreaterThan(above);
    },
  );
});

/**
 * test_intent_no_walls_of_text
 *
 * INTENCIÓN: las explicaciones en contexto son breves (docs/spec.md §4.7 «sin muros de
 *   texto»): cada `explain.*.body` tiene ≤ 320 caracteres (≈ 3 frases) en todos los
 *   idiomas, y cada título ≤ 40.
 * CONTEXTO: un «?» que despliega un párrafo largo es un muro con otro nombre; la cifra
 *   la fija el plan de fase 2 (D13). Se mide sobre los JSON, no sobre la
 *   pantalla, para que valga para cualquier idioma añadido.
 * EXPIRA SI: el formato de las explicaciones deja de ser un párrafo desplegable (p. ej.
 *   un glosario aparte con su propio presupuesto).
 */
const MAX_BODY_LENGTH = 320;
const MAX_TITLE_LENGTH = 40;

describe("test_intent_no_walls_of_text", () => {
  it(`every explain.*.body is ≤ ${MAX_BODY_LENGTH} characters and every title ≤ ${MAX_TITLE_LENGTH}, in every language`, () => {
    for (const [code, tree] of Object.entries(LOCALES)) {
      const branch = lookup(tree, "explain") as Tree;
      for (const [id, entry] of Object.entries(branch)) {
        const { title, body } = entry as { title: string; body: string };
        expect(
          [...body].length,
          `${code}.json: explain.${id}.body has ${[...body].length} characters`,
        ).toBeLessThanOrEqual(MAX_BODY_LENGTH);
        expect(
          [...title].length,
          `${code}.json: explain.${id}.title`,
        ).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      }
    }
  });
});
