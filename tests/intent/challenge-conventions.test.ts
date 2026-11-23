import { describe, expect, it, vi } from "vitest";
import {
  createRng,
  DISTANCES,
  identity,
  isStabilizerEquivalent,
  multiplyInto,
  pauliEquals,
  rotatedSurfaceCode,
  type ReadonlyPauli,
} from "../../src/core";
import {
  challengeReducer,
  initialChallengeState,
  type SubmittedGame,
} from "../../src/ui/challenge/challenge-machine";
import {
  decodePuzzle,
  drawPuzzle,
  encodePuzzle,
  maskLength,
  type Puzzle,
} from "../../src/ui/challenge/puzzle";
import { judge, LEVEL_P, TIME_LIMIT_S } from "../../src/ui/challenge/score";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";

// The module spy of test_intent_challenge_link_is_mask_not_seed: every
// `createRng` call of the core, wherever it comes from, is counted.
vi.mock("../../src/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/core")>();
  return { ...mod, createRng: vi.fn(mod.createRng) };
});

function times(a: ReadonlyPauli, b: ReadonlyPauli): ReadonlyPauli {
  return multiplyInto(identity(a.n), a, b);
}

/**
 * test_intent_challenge_accepts_equivalence_class
 *
 * INTENCIÓN: docs/spec.md §4.6 literal: se acepta cualquier corrección C cuyo residual E·C
 *   esté en el grupo de estabilizadores (síndrome nulo y conmuta con X_L y Z_L), es decir
 *   `isStabilizerEquivalent(E·C)`; no se exige coincidir con la corrección de MWPM.
 * CONTEXTO: varias correcciones de peso mínimo son equivalentes (difieren en un
 *   estabilizador); un juez que comparase C con C_MWPM rechazaría respuestas correctas y
 *   enseñaría al jugador que «correcto» es «lo que dijo el algoritmo», que es falso.
 *   Aserciones sobre 1 000 puzles aleatorios en d = 5: la aceptación de C_MWPM, de
 *   C_MWPM·S (S un estabilizador aleatorio), de C_MWPM·X_L y de C_MWPM·Z_L coincide una a
 *   una con `isStabilizerEquivalent(E·C)`; cuando el decodificador acierta (veredicto 0)
 *   eso es: las dos primeras aceptadas, las dos últimas rechazadas. Mutante que mata: un
 *   `judge` que compare C con C_MWPM (`pauliEquals`) rechaza C_MWPM·S.
 * EXPIRA SI: §4.6 cambia el criterio de aceptación.
 */
describe("test_intent_challenge_accepts_equivalence_class", () => {
  it("accepts exactly the corrections whose residual is a stabilizer, over 1 000 puzzles at d = 5", () => {
    const d = 5;
    const code = rotatedSurfaceCode(d);
    const ctx = createTraceContext(d);
    const scratch = new Uint8Array(code.stabilizers.length);
    let seed = 1;
    let corrected = 0;
    for (let i = 0; i < 1000; i++) {
      const puzzle = drawPuzzle(d, LEVEL_P[d], () => seed++);
      const trace = decodeTrace(ctx, puzzle.error);
      const mwpm = trace.correction;
      const stabilizer =
        code.stabilizers[i % code.stabilizers.length]!.operator;
      const candidates = [
        mwpm,
        times(mwpm, stabilizer),
        times(mwpm, code.logicalX),
        times(mwpm, code.logicalZ),
      ];
      const verdicts = candidates.map(
        (c) => judge(code, puzzle.error, c, mwpm, scratch).accepted,
      );
      const expected = candidates.map((c) =>
        isStabilizerEquivalent(code, times(puzzle.error, c)),
      );
      expect(verdicts, `puzzle ${i}`).toEqual(expected);
      if (trace.verdict === 0) {
        corrected++;
        expect(verdicts, `puzzle ${i}, decoder right`).toEqual([
          true,
          true,
          false,
          false,
        ]);
      } else {
        // The decoder failed: its own correction is wrong, and the class is
        // still what decides (the right logical fixes it).
        expect(verdicts[0], `puzzle ${i}, decoder wrong`).toBe(false);
        expect(verdicts[1]).toBe(false);
        // The logical(s) the verdict names fix it: X_L for bit 1, Z_L for
        // bit 2, both for a logical Y.
        let fixed = mwpm;
        if (trace.verdict & 1) fixed = times(fixed, code.logicalX);
        if (trace.verdict & 2) fixed = times(fixed, code.logicalZ);
        expect(judge(code, puzzle.error, fixed, mwpm, scratch).accepted).toBe(
          true,
        );
      }
    }
    // Control: the sample exercises both branches (sub-threshold, most are corrected).
    expect(corrected).toBeGreaterThan(900);
    expect(corrected).toBeLessThan(1000);
  });

  it("a correction equal to the decoder's up to a stabilizer wins the bonus only when its weight per type matches", () => {
    const code = rotatedSurfaceCode(3);
    const puzzle = decodePuzzle("i3.gAA")!;
    const trace = decodeTrace(createTraceContext(3), puzzle.error);
    // X on (0, 0) is corrected by one X flip to the top boundary. Times the
    // weight-2 top X stabilizer over (0,0),(0,1) it is X on the other of the
    // two qubits: another minimum (same class, same per-type weight), so the
    // bonus is earned without matching the decoder's support. Times the
    // interior Z stabilizer at (0,0) it gains four Z flips: accepted, heavier.
    const flip = trace.correction;
    expect(judge(code, puzzle.error, flip, flip).bonus).toBe(true);
    const top = code.stabilizers.find(
      (s) => s.type === "X" && s.boundary === "top",
    )!.operator;
    const other = times(flip, top);
    expect(pauliEquals(other, flip)).toBe(false);
    const sameWeight = judge(code, puzzle.error, other, flip);
    expect(sameWeight).toMatchObject({ accepted: true, bonus: true });
    const heavier = times(flip, code.stabilizers[0]!.operator);
    const r = judge(code, puzzle.error, heavier, flip);
    expect(r).toMatchObject({ accepted: true, bonus: false, flipsZ: 4 });
  });
});

/**
 * test_intent_challenge_link_is_mask_not_seed
 *
 * INTENCIÓN: el enlace compartido lleva la máscara de errores (2·d² bits en base64url,
 *   ≤ 27 caracteres en d = 9), nunca una semilla: cambiar el PRNG no rompe ningún enlace
 *   ya enviado (docs/spec.md §4.6, tasks/plans/phase2.md D11).
 * CONTEXTO: una semilla es más corta y tentadora; codifica el generador, no el puzle.
 *   Aserciones: `decodePuzzle(encodePuzzle(p))` no llama a `createRng` (espía por módulo
 *   sobre el núcleo); el texto tiene exactamente `ceil(2d²/6)` caracteres de máscara; y un
 *   puzle que ningún PRNG produjo (todo a uno salvo un bit) viaja igual. Mutante que mata:
 *   `encodePuzzle` que escriba una semilla (longitud distinta, `createRng` al decodificar).
 * EXPIRA SI: §4.6 cambia la codificación (nueva entrada en docs/decisiones.md).
 */
describe("test_intent_challenge_link_is_mask_not_seed", () => {
  it("encodes and decodes without touching the PRNG, with exactly ceil(2d²/6) mask characters", () => {
    const rng = vi.mocked(createRng);
    for (const d of DISTANCES) {
      const n = d * d;
      // Every component set except X on qubit 0 (all ones is a product of
      // logicals with no defect, which the codec rejects as no puzzle).
      const allButOne = identity(n);
      allButOne.x.fill(1);
      allButOne.z.fill(1);
      allButOne.x[0] = 0;
      const puzzles: Puzzle[] = [
        drawPuzzle(d, LEVEL_P[d], () => 7),
        { d, model: "independent", error: allButOne },
      ];
      rng.mockClear();
      for (const puzzle of puzzles) {
        const text = encodePuzzle(puzzle);
        const [head, mask, ...rest] = text.split(".");
        expect(rest).toEqual([]);
        expect(head).toBe(`i${d}`);
        expect(mask!.length).toBe(maskLength(d));
        expect(mask!.length).toBe(Math.ceil((2 * n) / 6));
        const back = decodePuzzle(text);
        expect(back).not.toBeNull();
        expect(pauliEquals(back!.error, puzzle.error)).toBe(true);
      }
      expect(rng).not.toHaveBeenCalled();
    }
    expect(maskLength(9)).toBe(27);
    // The order of the bits is part of the contract (a shared link is a
    // text): X on q = 1 = (0, 1) of d = 3 is the second bit of the first
    // sextet, "Q" (010000); a column-major order would write "E" (000100) and
    // every link ever shared would open another puzzle.
    const xOn1 = identity(9);
    xOn1.x[1] = 1;
    expect(encodePuzzle({ d: 3, model: "independent", error: xOn1 })).toBe(
      "i3.QAA",
    );
    expect(pauliEquals(decodePuzzle("i3.QAA")!.error, xOn1)).toBe(true);
    // Control: the spy does see the PRNG when a puzzle is drawn.
    drawPuzzle(3, LEVEL_P[3], () => 1);
    expect(rng).toHaveBeenCalled();
  });
});

/**
 * test_intent_challenge_timer_is_ui_only
 *
 * INTENCIÓN: el reloj nunca decide la aceptación: un envío con la misma C da el mismo
 *   veredicto a tiempo que fuera de tiempo; sólo cambian los puntos (D12: fallo o tiempo
 *   agotado ⇒ 0 puntos y racha 0).
 * CONTEXTO: el reloj es presión, no puntuación; si el juez mirase la hora, dos jugadores
 *   con la misma corrección verían veredictos distintos y la explicación del reto
 *   («se acepta cualquier corrección que deje un estabilizador») sería falsa.
 *   Aserciones: `judge` no recibe tiempo; con la hora del sistema muy pasado el límite,
 *   `submit` sigue aceptando C_MWPM con bonificación; `timeout` sobre el mismo estado da
 *   el mismo `result` con 0 puntos. Mutante que mata: un reductor que rechace cuando
 *   `Date.now() − startedAt` supera `TIME_LIMIT_S`.
 * EXPIRA SI: se decide puntuar por tiempo restante (D12, alternativa).
 */
describe("test_intent_challenge_timer_is_ui_only", () => {
  it("the same flips get the same verdict before and after the limit; only the points differ", () => {
    const puzzle = decodePuzzle("i3.gAA")!;
    const trace = decodeTrace(createTraceContext(3), puzzle.error);
    expect(trace.verdict).toBe(0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      let state = challengeReducer(initialChallengeState(), {
        type: "start",
        puzzle,
        trace,
        now: Date.now(),
        fromLink: false,
      });
      for (let q = 0; q < 9; q++) {
        if (trace.correction.x[q] === 1)
          state = challengeReducer(state, { type: "toggleX", q });
        if (trace.correction.z[q] === 1)
          state = challengeReducer(state, { type: "toggleZ", q });
      }
      const inTime = challengeReducer(state, { type: "submit" })
        .game as SubmittedGame;
      // Far past the limit on every clock the reducer could consult.
      vi.setSystemTime(1_000_000 + 100 * TIME_LIMIT_S[3] * 1000);
      const late = challengeReducer(state, { type: "submit" })
        .game as SubmittedGame;
      const timedOut = challengeReducer(state, { type: "timeout" })
        .game as SubmittedGame;
      expect(inTime.result).toEqual(late.result);
      expect(inTime.result).toEqual(timedOut.result);
      expect(inTime.result.accepted).toBe(true);
      expect(inTime.result.bonus).toBe(true);
      expect(late.points).toBe(inTime.points);
      expect(inTime.points).toBeGreaterThan(0);
      expect(timedOut.points).toBe(0);
      expect(timedOut.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("judge takes no clock: code, error, flips, decoder's correction and a scratch buffer", () => {
    // (code, error, flips, mwpm, scratch): five parameters, none a time.
    expect(judge.length).toBe(5);
  });
});
