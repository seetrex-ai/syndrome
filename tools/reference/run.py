# /// script
# requires-python = ">=3.12"
# dependencies = ["pymatching==2.4.0", "numpy>=2", "stim>=1.14"]
# ///
"""PyMatching reference for Syndrome (docs/spec.md §3, §6; tasks/plans/validation.md D9/D10;
phase 2: tasks/plans/phase2.md D1/D3/D6–D9).

Reimplements the rotated surface code of docs/spec.md §3 from the text, without reading
src/core: geometry and numbering, the integer generic weights W_q (splitmix64), the
independent X/Z code-capacity noise, the per-shot stop rule and the Wilson interval.
Decoding is PyMatching's exact MWPM over the same integer weights, so the minimum
matching weight must equal src/core's exactly (min-weights.json) and the logical error
rates must agree statistically (reference.json, compared by tools/validate).

Phase 2 adds the phenomenological model (`--model phenomenological`): d noisy cycles of
data errors plus measurement flips at q = p, a perfect final readout, detectors by
difference, and PyMatching on the explicit spacetime graph with the same integer weights
indexed by edge (W_e). Stim is used as an independent check of the graph (S1: the
detector error model of a circuit written from the text has exactly the edges of the
graph) and as a second sampler (S2), never as the decoder.

    uv run tools/reference/run.py [--model independent|phenomenological]
                                  [--out docs/validacion] [--seed N]
                                  [--only grid|min-weights|verdicts] [--selftest]

selftest() always runs before anything is generated; every check is a `check(cond, msg)`
that raises AssertionError explicitly, so `python -O` / PYTHONOPTIMIZE cannot silence it.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import sys
import time
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pymatching
import stim

# PyMatching does NOT rescale an edge whose weight exceeds 2^24 - 1: it drops the edge and
# only emits a UserWarning ("... exceeds maximum edge weight 16777215 and has not been added
# to the matching graph"), which would silently change the graph: make every warning fatal.
warnings.simplefilter("error")


def check(cond: object, msg: object = "") -> None:
    """Hard assertion. Unlike `assert`, it survives `python -O` / PYTHONOPTIMIZE=1."""
    if not cond:
        raise AssertionError(str(msg))


MASK64 = (1 << 64) - 1
STABILIZER_TYPES = ("Z", "X")

# --- Generic integer weights (docs/spec.md §3 "Pesos y desempate") ---------------------------

WEIGHT_SEED = 0x53594E44
WEIGHT_EPSILON_DENOMINATOR = 1000
MAX_EDGE_WEIGHT = (1 << 24) - 1
# S = floor((2^24 - 1) · 1000 / 1001): the largest scale with S · (1 + 1/1000) ≤ 2^24 - 1.
WEIGHT_SCALE = (MAX_EDGE_WEIGHT * WEIGHT_EPSILON_DENOMINATOR) // (
    WEIGHT_EPSILON_DENOMINATOR + 1
)
SPLITMIX64_GAMMA = 0x9E3779B97F4A7C15


def splitmix64(seed: int) -> int:
    """First output of SplitMix64 seeded with `seed` (state += gamma, then mix)."""
    z = (seed + SPLITMIX64_GAMMA) & MASK64
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
    return z ^ (z >> 31)


def top53(out: int) -> int:
    return out >> 11


def uniform53(out: int) -> float:
    return top53(out) / float(1 << 53)


def qubit_weight(q: int) -> int:
    """W_q = floor(S · (1 + u_q / 1000)) in exact integer arithmetic, u_q = top53 / 2^53."""
    if q < 0:
        raise ValueError(f"qubit index must be >= 0, got {q}")
    t = top53(splitmix64(WEIGHT_SEED + q))
    return WEIGHT_SCALE + (WEIGHT_SCALE * t) // (WEIGHT_EPSILON_DENOMINATOR << 53)


# --- Geometry (docs/spec.md §3 "Geometría del código de superficie rotado") -------------------


@dataclass(frozen=True)
class Stabilizer:
    index: int
    type_index: int
    type: str
    i: int
    j: int
    boundary: str | None
    qubits: tuple[int, ...]


def plaquette_type(i: int, j: int) -> str:
    return "Z" if (i + j) % 2 == 0 else "X"


def qubit_index(d: int, row: int, col: int) -> int:
    return row * d + col


def plaquette_qubits(d: int, i: int, j: int) -> tuple[int, ...]:
    qs = []
    for r in (i, i + 1):
        for c in (j, j + 1):
            if 0 <= r < d and 0 <= c < d:
                qs.append(qubit_index(d, r, c))
    return tuple(sorted(qs))


def stabilizers(d: int) -> list[Stabilizer]:
    """Z block then X block; within a block, sweep i = -1..d-1, j = -1..d-1 (no corners)."""
    out: list[Stabilizer] = []
    for stab_type in STABILIZER_TYPES:
        type_index = 0
        for i in range(-1, d):
            for j in range(-1, d):
                row_edge = i == -1 or i == d - 1
                col_edge = j == -1 or j == d - 1
                if row_edge and col_edge:
                    continue  # corners of the extended board do not exist
                t = plaquette_type(i, j)
                if t != stab_type:
                    continue
                if row_edge and t != "X":
                    continue  # top/bottom boundaries carry only X checks
                if col_edge and t != "Z":
                    continue  # left/right boundaries carry only Z checks
                boundary = None
                if i == -1:
                    boundary = "top"
                elif i == d - 1:
                    boundary = "bottom"
                elif j == -1:
                    boundary = "left"
                elif j == d - 1:
                    boundary = "right"
                out.append(
                    Stabilizer(
                        index=len(out),
                        type_index=type_index,
                        type=t,
                        i=i,
                        j=j,
                        boundary=boundary,
                        qubits=plaquette_qubits(d, i, j),
                    )
                )
                type_index += 1
    return out


def parity_matrix(d: int, stab_type: str) -> np.ndarray:
    """H (m × n, uint8): row typeIndex has a 1 on every qubit of that check."""
    checks = [s for s in stabilizers(d) if s.type == stab_type]
    n = d * d
    H = np.zeros((len(checks), n), dtype=np.uint8)
    for s in checks:
        for q in s.qubits:
            H[s.type_index, q] = 1
    return H


def checks_of_qubit(H: np.ndarray) -> list[list[int]]:
    return [list(np.flatnonzero(H[:, q])) for q in range(H.shape[1])]


def logical_support(d: int, stab_type: str) -> list[int]:
    """Qubits whose residual parity decides the verdict for errors seen by `stab_type` checks.

    Z checks see X errors; an X error is logical iff it anticommutes with Z_L (row 0).
    X checks see Z errors; a Z error is logical iff it anticommutes with X_L (column 0).
    """
    if stab_type == "Z":
        return [qubit_index(d, 0, c) for c in range(d)]
    return [qubit_index(d, r, 0) for r in range(d)]


# --- PyMatching graphs (D10, M1, M2) -------------------------------------------------------


def expected_edges(d: int, stab_type: str) -> dict[tuple[int, int | None], tuple[int, int]]:
    """Distinct edges after merging parallel boundary edges by smallest weight.

    Key (a, b) with a < b or (a, None); value (weight, fault qubit). Two checks of the
    same type share at most one qubit, so only boundary edges can be parallel.
    """
    H = parity_matrix(d, stab_type)
    edges: dict[tuple[int, int | None], tuple[int, int]] = {}
    for q, checks in enumerate(checks_of_qubit(H)):
        check(1 <= len(checks) <= 2, (d, stab_type, q, checks))
        key: tuple[int, int | None]
        if len(checks) == 2:
            a, b = sorted(checks)
            key = (a, b)
            check(key not in edges, ("parallel interior edge", d, stab_type, key))
        else:
            key = (checks[0], None)
        w = qubit_weight(q)
        if key not in edges or w < edges[key][0]:
            edges[key] = (w, q)
    return edges


def build_matching(d: int, stab_type: str) -> pymatching.Matching:
    H = parity_matrix(d, stab_type)
    g = pymatching.Matching()
    for q, checks in enumerate(checks_of_qubit(H)):
        w = qubit_weight(q)
        if len(checks) == 2:
            g.add_edge(
                int(checks[0]),
                int(checks[1]),
                fault_ids={q},
                weight=w,
                merge_strategy="smallest-weight",
            )
        else:
            g.add_boundary_edge(
                int(checks[0]),
                fault_ids={q},
                weight=w,
                merge_strategy="smallest-weight",
            )
    # A dropped parallel qubit of high index would shrink decode_batch's width (M2).
    g.ensure_num_fault_ids(d * d)
    return g


# --- Statistics (D1, D2) --------------------------------------------------------------------

WILSON_Z95 = 1.959963984540054


def wilson_interval(k: int, n: int, z: float = WILSON_Z95) -> tuple[float, float]:
    if not (0 <= k <= n):
        raise ValueError(f"need 0 <= k <= n, got k = {k}, n = {n}")
    if n == 0:
        return 0.0, 1.0
    p = k / n
    z2n = z * z / n
    centre = (p + z2n / 2) / (1 + z2n)
    half = z * math.sqrt(p * (1 - p) / n + z2n / (4 * n)) / (1 + z2n)
    low = 0.0 if k == 0 else centre - half
    high = 1.0 if k == n else centre + half
    return low, high


def point_rate(failures: int, shots: int, stop_reason: str) -> float:
    """k/N for "shots" | "cap" | "budget"; Haldane's (k-1)/(N-1) for "failures"; 0 for N = 0."""
    if shots == 0:
        return 0.0
    if stop_reason == "failures":
        return 0.0 if shots == 1 else (failures - 1) / (shots - 1)
    return failures / shots


@dataclass(frozen=True)
class StopRule:
    min_failures: int
    min_shots: int
    max_shots: int

    def __post_init__(self) -> None:
        check(self.min_failures >= 2)
        check(1 <= self.min_shots <= self.max_shots)


# The rule of the validation grid (docs/spec.md §3, §6): ≥ 100 failures AND ≥ 1e5 shots, cap 1e6.
VALIDATION_STOP_RULE = StopRule(min_failures=100, min_shots=100_000, max_shots=1_000_000)


def stop_per_shot(rule: StopRule, shots: int, failures: int) -> str | None:
    """The rule checked after one shot (src/core/sim/adaptive.ts): first match wins."""
    if shots >= rule.min_shots:
        if failures >= rule.min_failures:
            return "shots" if shots == rule.min_shots else "failures"
        if shots == rule.max_shots:
            return "cap"
    return None


def apply_batch(
    rule: StopRule, shots0: int, failures0: int, fail: np.ndarray
) -> tuple[int, str | None]:
    """Shots of the batch to keep and the stop reason, equal to running stop_per_shot
    after every shot of the batch (T-P5)."""
    B = len(fail)
    if B == 0:
        return 0, None
    shots = shots0 + np.arange(1, B + 1)
    failures = failures0 + np.cumsum(fail, dtype=np.int64)
    fired = (shots >= rule.min_shots) & (
        (failures >= rule.min_failures) | (shots == rule.max_shots)
    )
    hits = np.flatnonzero(fired)
    if len(hits) == 0:
        return B, None
    cut = int(hits[0])
    reason = stop_per_shot(rule, int(shots[cut]), int(failures[cut]))
    check(reason is not None)
    return cut + 1, reason


# --- Monte Carlo of one grid point (D10) ----------------------------------------------------

BATCH_SHOTS = 100_000


def point_seed(base: int, d: int, p: float) -> list[int]:
    return [base, d, round(p * 1e6)]


@dataclass(frozen=True)
class Tally:
    """Shots and failures of one point, truncated at the shot where the rule fired."""

    shots: int
    failures: int
    failures_x: int
    failures_z: int
    reason: str


def accumulate(rule: StopRule, draw, batch_shots: int = BATCH_SHOTS) -> Tally:
    """Batch accumulation under the per-shot stop rule (T-P5).

    `draw(B)` returns the (fail_x, fail_z) vectors of the next B shots; every batch is cut
    at the shot where `stop_per_shot` would have fired, so the result equals a loop shot
    by shot over the same vectors.
    """
    shots = failures = failures_x = failures_z = 0
    reason: str | None = None
    while reason is None:
        B = min(batch_shots, rule.max_shots - shots)
        fail_x, fail_z = draw(B)
        fail = fail_x | fail_z
        keep, reason = apply_batch(rule, shots, failures, fail)
        shots += keep
        failures += int(fail[:keep].sum())
        failures_x += int(fail_x[:keep].sum())
        failures_z += int(fail_z[:keep].sum())
    check(reason is not None)
    return Tally(shots, failures, failures_x, failures_z, reason)


def point_estimates(t: Tally) -> dict:
    """Estimates and Wilson intervals of a tally, combined and per type (PointEstimate)."""
    estimate = point_rate(t.failures, t.shots, t.reason)
    low, high = wilson_interval(t.failures, t.shots)

    def share(k_type: int) -> float:
        # Per-type detail: with a stop by failures the combined estimate is Haldane's and
        # the types split it in proportion (adaptive.ts); otherwise kX/N.
        if t.reason == "failures":
            return estimate * k_type / t.failures
        return point_rate(k_type, t.shots, "shots")

    low_x, high_x = wilson_interval(t.failures_x, t.shots)
    low_z, high_z = wilson_interval(t.failures_z, t.shots)
    return {
        "shots": t.shots,
        "failures": t.failures,
        "failuresX": t.failures_x,
        "failuresZ": t.failures_z,
        "estimate": estimate,
        "low": low,
        "high": high,
        "estimateX": share(t.failures_x),
        "lowX": low_x,
        "highX": high_x,
        "estimateZ": share(t.failures_z),
        "lowZ": low_z,
        "highZ": high_z,
        "stopReason": t.reason,
        "upperBoundOnly": t.failures == 0,
    }


def sample_errors(
    rng: np.random.Generator, B: int, n: int, p: float
) -> tuple[np.ndarray, np.ndarray]:
    """B shots of independent X/Z code-capacity noise (docs/spec.md §3 "Modelo de ruido"):
    the X pattern is drawn first, then the Z pattern, each qubit flipped with probability p."""
    EX = (rng.random((B, n)) < p).astype(np.uint8)
    EZ = (rng.random((B, n)) < p).astype(np.uint8)
    return EX, EZ


def make_verdicts(d: int):
    """verdicts(EX, EZ) -> (fail_x, fail_z): syndromes, MWPM per type, residual parity on
    the logical support. Shared by the simulation and by the exact enumeration of T-P4."""
    HZ = parity_matrix(d, "Z")  # Z checks detect X errors
    HX = parity_matrix(d, "X")  # X checks detect Z errors
    mZ = build_matching(d, "Z")
    mX = build_matching(d, "X")
    rowZL = logical_support(d, "Z")  # row 0: X residual parity ⇒ logical X
    colXL = logical_support(d, "X")  # column 0: Z residual parity ⇒ logical Z

    def verdicts(EX: np.ndarray, EZ: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        SZ = (EX @ HZ.T) & 1
        SX = (EZ @ HX.T) & 1
        CX = mZ.decode_batch(SZ)
        CZ = mX.decode_batch(SX)
        RX = EX ^ CX
        RZ = EZ ^ CZ
        fail_x = RX[:, rowZL].sum(axis=1) & 1
        fail_z = RZ[:, colXL].sum(axis=1) & 1
        return fail_x, fail_z

    return verdicts


def simulate_point(d: int, p: float, base_seed: int, rule: StopRule) -> dict:
    n = d * d
    verdicts = make_verdicts(d)
    rng = np.random.default_rng(point_seed(base_seed, d, p))

    def draw(B: int) -> tuple[np.ndarray, np.ndarray]:
        return verdicts(*sample_errors(rng, B, n, p))

    return {"d": d, "p": p, **point_estimates(accumulate(rule, draw))}


# --- Output files (D6, decoder.md §3) --------------------------------------------------------

GRID_DISTANCES = (3, 5, 7)
GRID_PROBABILITIES = (0.03, 0.05, 0.07, 0.09, 0.10, 0.11, 0.13, 0.15)
WEIGHT_SAMPLE_QUBITS = (0, 1, 2, 8, 24, 48, 80, 120)
MIN_WEIGHTS_DISTANCES = (3, 5, 7, 9)
MIN_WEIGHTS_CASES_PER_D = 2500
MIN_WEIGHTS_NOISE = (0.05, 0.10, 0.15, 0.25)


def weights_block() -> dict:
    return {
        "seed": f"0x{WEIGHT_SEED:08X}",
        "scale": WEIGHT_SCALE,
        "epsilonDenominator": WEIGHT_EPSILON_DENOMINATOR,
        "maxEdgeWeight": MAX_EDGE_WEIGHT,
    }


def geometry_block() -> dict:
    return {
        str(d): [[s.type, s.i, s.j] for s in stabilizers(d)] for d in (3, 5)
    }


def engine_block() -> dict:
    return {
        "name": "pymatching",
        "version": pymatching.__version__,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "batchShots": str(BATCH_SHOTS),
    }


def generate_grid(base_seed: int, log) -> dict:
    rule = VALIDATION_STOP_RULE
    points = []
    for d in GRID_DISTANCES:
        for p in GRID_PROBABILITIES:
            t0 = time.perf_counter()
            pt = simulate_point(d, p, base_seed, rule)
            dt = time.perf_counter() - t0
            points.append(pt)
            log(
                f"d = {d}  p = {p:.2f}  shots = {pt['shots']:>7}  failures = {pt['failures']:>6}"
                f"  estimate = {pt['estimate']:.5f}  [{pt['low']:.5f}, {pt['high']:.5f}]"
                f"  {pt['stopReason']:<8} {dt:6.2f} s"
            )
    return {
        "schema": 1,
        "generator": "tools/reference/run.py",
        "engine": engine_block(),
        "noise": "independent",
        "stopRule": {
            "minFailures": rule.min_failures,
            "minShots": rule.min_shots,
            "maxShots": rule.max_shots,
        },
        "seed": base_seed,
        "weights": {
            **weights_block(),
            "sample": {str(q): qubit_weight(q) for q in WEIGHT_SAMPLE_QUBITS},
        },
        "geometry": geometry_block(),
        "points": points,
    }


def generate_min_weights(base_seed: int) -> dict:
    rng = np.random.default_rng([base_seed, 1])
    cases = []
    for d in MIN_WEIGHTS_DISTANCES:
        n = d * d
        graphs = {t: build_matching(d, t) for t in STABILIZER_TYPES}
        Hs = {t: parity_matrix(d, t) for t in STABILIZER_TYPES}
        weights = np.array([qubit_weight(q) for q in range(n)], dtype=np.int64)
        for c in range(MIN_WEIGHTS_CASES_PER_D):
            stab_type = STABILIZER_TYPES[c % 2]
            H = Hs[stab_type]
            m = H.shape[0]
            if c < MIN_WEIGHTS_CASES_PER_D // 2:
                # Syndromes of random errors of the detected type at p (cycled).
                p = MIN_WEIGHTS_NOISE[(c // 2) % len(MIN_WEIGHTS_NOISE)]
                error = (rng.random(n) < p).astype(np.uint8)
                syndrome = (error @ H.T) & 1
            else:
                # Uniform subsets of the checks of a random size in [0, m] (any subset is a
                # valid syndrome in the planar code; k = 0 gives weight 0).
                size = int(rng.integers(0, m + 1))
                chosen = rng.choice(m, size=size, replace=False)
                syndrome = np.zeros(m, dtype=np.uint8)
                syndrome[chosen] = 1
            correction, w = graphs[stab_type].decode(syndrome, return_weight=True)
            check(float(w).is_integer(), (d, stab_type, w))
            check(correction.shape == (n,), correction.shape)
            check(int(w) == int(weights[correction.astype(bool)].sum()), (d, stab_type, w))
            residual_syndrome = (correction.astype(np.uint8) @ H.T) & 1
            check(np.array_equal(residual_syndrome, syndrome), (d, stab_type))
            cases.append(
                {
                    "d": d,
                    "type": stab_type,
                    "defects": [int(i) for i in np.flatnonzero(syndrome)],
                    "weight": int(w),
                }
            )
    return {
        "schema": 1,
        "generator": "tools/reference/run.py",
        "pymatching": pymatching.__version__,
        "weights": weights_block(),
        "cases": cases,
    }


# --- Phenomenological model (phase 2: docs/spec.md §3 "Ruido fenomenológico", phase2.md D1/D3) --
#
# One shot = `cycles` noisy cycles (cycles = d on the grid). In cycle r = 1 … cycles every
# data qubit suffers X with probability p and, independently, Z with probability p
# (accumulated: C_r = C_{r−1} ⊕ E_r), then every stabilizer is measured and each outcome
# flipped with probability q = p: s_r = H·C_r ⊕ f_r. After the last cycle a PERFECT
# readout gives s_{cycles+1} = H·C_cycles. Detectors D_r = s_r ⊕ s_{r−1}, s_0 = 0, node
# index (r − 1)·m + typeIndex. Mechanisms = edges: a data error (q, r) joins the ≤ 2 checks
# of q in layer r (boundary if one); a flip (s, r) joins (r, s) and (r + 1, s). The last
# layer has no space edges and there is no time boundary. Weight of edge e = W_e =
# qubit_weight(e) over the edge index: space (q, r) → q + n·(r − 1), time (s, r) →
# n·cycles + (r − 1)·m + s. X and Z are decoded on separate graphs; the verdict is the
# parity of the residual C_cycles ⊕ correction on the logical support, as in phase 1.


def edge_weight(e: int) -> int:
    """W_e, the integer weight of edge index e: the same formula as W_q (phase2.md D3)."""
    return qubit_weight(e)


def space_edge_index(n: int, q: int, cycle: int) -> int:
    return q + n * (cycle - 1)


def time_edge_index(n: int, m: int, type_index: int, cycle: int, cycles: int) -> int:
    return n * cycles + (cycle - 1) * m + type_index


def node_index(m: int, cycle: int, type_index: int) -> int:
    return (cycle - 1) * m + type_index


def spacetime_mechanisms(
    d: int, stab_type: str, cycles: int
) -> list[tuple[frozenset[int], int, int]]:
    """Every error mechanism of the spacetime graph, unmerged, in edge-index order:
    (detector set, edge index, fault qubit or −1 for a measurement flip)."""
    H = parity_matrix(d, stab_type)
    n = d * d
    m = H.shape[0]
    checks = checks_of_qubit(H)
    out: list[tuple[frozenset[int], int, int]] = []
    for r in range(1, cycles + 1):
        for q in range(n):
            nodes = frozenset(node_index(m, r, int(s)) for s in checks[q])
            check(1 <= len(nodes) <= 2, (d, stab_type, q, nodes))
            out.append((nodes, space_edge_index(n, q, r), q))
    for r in range(1, cycles + 1):
        for s in range(m):
            nodes = frozenset({node_index(m, r, s), node_index(m, r + 1, s)})
            out.append((nodes, time_edge_index(n, m, s, r, cycles), -1))
    return out


def expected_spacetime_edges(
    d: int, stab_type: str, cycles: int
) -> dict[frozenset[int], tuple[int, int]]:
    """Distinct edges after merging parallel boundary edges by smallest weight (first on a
    tie, as the TS Dijkstra does): key = detector set, value (weight, fault qubit or −1).
    Only boundary edges can be parallel: two checks of one type share at most one qubit
    and no time edge shares its endpoints with a space edge."""
    edges: dict[frozenset[int], tuple[int, int]] = {}
    for nodes, e, q in spacetime_mechanisms(d, stab_type, cycles):
        w = edge_weight(e)
        if len(nodes) == 2:
            check(nodes not in edges, ("parallel interior edge", d, stab_type, cycles, nodes))
        if nodes not in edges or w < edges[nodes][0]:
            edges[nodes] = (w, q)
    return edges


def build_spacetime_matching(d: int, stab_type: str, cycles: int) -> pymatching.Matching:
    g = pymatching.Matching()
    for nodes, e, q in spacetime_mechanisms(d, stab_type, cycles):
        w = edge_weight(e)
        fault_ids = {q} if q >= 0 else set()
        if len(nodes) == 2:
            a, b = sorted(nodes)
            g.add_edge(a, b, fault_ids=fault_ids, weight=w, merge_strategy="smallest-weight")
        else:
            (a,) = nodes
            g.add_boundary_edge(
                a, fault_ids=fault_ids, weight=w, merge_strategy="smallest-weight"
            )
    g.ensure_num_fault_ids(d * d)
    return g


def spacetime_detectors(
    H: np.ndarray, cumulative: list[np.ndarray], flips: list[np.ndarray]
) -> np.ndarray:
    """Detectors (B, m·(cycles + 1)) of one type: cumulative[r − 1] is C_r (B, n) and
    flips[r − 1] is f_r (B, m); D_r = s_r ⊕ s_{r−1} with s_r = H·C_r ⊕ f_r, s_0 = 0, and
    the perfect final layer s = H·C_cycles."""
    cycles = len(cumulative)
    check(cycles >= 1 and len(flips) == cycles, (cycles, len(flips)))
    B = cumulative[0].shape[0]
    m = H.shape[0]
    out = np.zeros((B, m * (cycles + 1)), dtype=np.uint8)
    prev = np.zeros((B, m), dtype=np.uint8)
    for r in range(1, cycles + 1):
        s = ((cumulative[r - 1] @ H.T) & 1) ^ flips[r - 1]
        out[:, (r - 1) * m : r * m] = s ^ prev
        prev = s
    s = (cumulative[-1] @ H.T) & 1
    out[:, cycles * m :] = s ^ prev
    return out


def sample_spacetime(
    rng: np.random.Generator, B: int, d: int, p: float, cycles: int
) -> tuple[list[np.ndarray], list[np.ndarray], list[np.ndarray], list[np.ndarray]]:
    """B shots of phase2.md D1: per cycle the X pattern, the Z pattern (each qubit with
    probability p), then the Z-check flips and the X-check flips (each with q = p).
    Returns the ACCUMULATED errors per cycle (C_r for X and for Z) and the flips."""
    n = d * d
    m = (n - 1) // 2
    CX = np.zeros((B, n), dtype=np.uint8)
    CZ = np.zeros((B, n), dtype=np.uint8)
    cum_x: list[np.ndarray] = []
    cum_z: list[np.ndarray] = []
    flips_z: list[np.ndarray] = []
    flips_x: list[np.ndarray] = []
    for _ in range(cycles):
        EX = (rng.random((B, n)) < p).astype(np.uint8)
        EZ = (rng.random((B, n)) < p).astype(np.uint8)
        CX = CX ^ EX
        CZ = CZ ^ EZ
        cum_x.append(CX)
        cum_z.append(CZ)
        flips_z.append((rng.random((B, m)) < p).astype(np.uint8))
        flips_x.append((rng.random((B, m)) < p).astype(np.uint8))
    return cum_x, cum_z, flips_z, flips_x


def make_spacetime_verdicts(d: int, cycles: int):
    """verdicts(cum_x, cum_z, flips_z, flips_x) -> (fail_x, fail_z): detectors of both
    types, spacetime MWPM per type, residual parity on the logical support."""
    HZ = parity_matrix(d, "Z")
    HX = parity_matrix(d, "X")
    mZ = build_spacetime_matching(d, "Z", cycles)
    mX = build_spacetime_matching(d, "X", cycles)
    rowZL = logical_support(d, "Z")
    colXL = logical_support(d, "X")

    def verdicts(cum_x, cum_z, flips_z, flips_x) -> tuple[np.ndarray, np.ndarray]:
        DZ = spacetime_detectors(HZ, cum_x, flips_z)
        DX = spacetime_detectors(HX, cum_z, flips_x)
        CX = mZ.decode_batch(DZ)
        CZ = mX.decode_batch(DX)
        RX = cum_x[-1] ^ CX
        RZ = cum_z[-1] ^ CZ
        fail_x = RX[:, rowZL].sum(axis=1) & 1
        fail_z = RZ[:, colXL].sum(axis=1) & 1
        return fail_x, fail_z

    return verdicts


def spacetime_point_seed(base: int, d: int, p: float, cycles: int) -> list[int]:
    return point_seed(base, d, p) + [cycles]


def simulate_spacetime_point(
    d: int, p: float, base_seed: int, rule: StopRule, cycles: int | None = None
) -> dict:
    cycles = d if cycles is None else cycles
    verdicts = make_spacetime_verdicts(d, cycles)
    rng = np.random.default_rng(spacetime_point_seed(base_seed, d, p, cycles))

    def draw(B: int) -> tuple[np.ndarray, np.ndarray]:
        return verdicts(*sample_spacetime(rng, B, d, p, cycles))

    return {"d": d, "p": p, **point_estimates(accumulate(rule, draw))}


# --- Stim: the circuit of D1 as an independent statement of the graph (S1) and a second
# sampler (S2). One circuit per check type (the final readout of the data qubits needs
# one basis): |0…0> / Z checks / M for the Z graph (X errors), |+…+> / X checks / MX for
# the X graph (Z errors). Detectors are emitted at the end, in node-index order.


def stim_circuit(d: int, stab_type: str, p: float, cycles: int) -> stim.Circuit:
    stabs = [s for s in stabilizers(d) if s.type == stab_type]
    n = d * d
    m = len(stabs)
    is_z = stab_type == "Z"
    c = stim.Circuit()
    c.append("R" if is_z else "RX", range(n))
    for _ in range(cycles):
        c.append("X_ERROR" if is_z else "Z_ERROR", range(n), p)
        targets = []
        for s in stabs:
            for k, q in enumerate(s.qubits):
                if k:
                    targets.append(stim.target_combiner())
                targets.append(stim.target_z(q) if is_z else stim.target_x(q))
        c.append("MPP", targets, p)
    c.append("M" if is_z else "MX", range(n))
    total = cycles * m + n

    def rec(absolute: int) -> stim.GateTarget:
        return stim.target_rec(absolute - total)

    for r in range(1, cycles + 2):
        for s in stabs:
            si = s.type_index
            if r <= cycles:
                targets = [rec((r - 1) * m + si)]
                if r >= 2:
                    targets.append(rec((r - 2) * m + si))
            else:
                targets = [rec(cycles * m + q) for q in s.qubits]
                targets.append(rec((cycles - 1) * m + si))
            c.append("DETECTOR", targets)
    c.append(
        "OBSERVABLE_INCLUDE",
        [rec(cycles * m + q) for q in logical_support(d, stab_type)],
        0,
    )
    return c


def dem_errors(circuit: stim.Circuit) -> dict[tuple[frozenset[int], bool], float]:
    """(detector set, flips the observable) -> probability of every error of the DEM."""
    dem = circuit.detector_error_model(flatten_loops=True)
    out: dict[tuple[frozenset[int], bool], float] = {}
    for inst in dem.flattened():
        if inst.type != "error":
            continue
        dets = frozenset(
            t.val for t in inst.targets_copy() if t.is_relative_detector_id()
        )
        obs = any(t.is_logical_observable_id() for t in inst.targets_copy())
        key = (dets, obs)
        check(key not in out, ("DEM error repeated", key))
        out[key] = float(inst.args_copy()[0])
    return out


def selftest_stim_structure(d: int, stab_type: str, cycles: int, p: float) -> int:
    """S1: the DEM of the circuit has exactly the mechanisms of spacetime_mechanisms,
    merged by Stim only when detectors AND observable effect coincide (parallel boundary
    qubits), with probability (1 − (1 − 2p)^k)/2 for k merged mechanisms; and the Matching's
    edges are the merged set with W_e and the fault qubit. Returns the DEM error count."""
    circuit = stim_circuit(d, stab_type, p, cycles)
    n = d * d
    m = (n - 1) // 2
    got = dem_errors(circuit)
    support = set(logical_support(d, stab_type))
    groups: dict[tuple[frozenset[int], bool], int] = {}
    for nodes, _e, q in spacetime_mechanisms(d, stab_type, cycles):
        key = (nodes, q in support)
        groups[key] = groups.get(key, 0) + 1
    check(
        set(got) == set(groups),
        f"S1 d = {d} {stab_type} cycles = {cycles}: DEM edges differ from the graph "
        f"(only in DEM: {set(got) - set(groups)}; only in graph: {set(groups) - set(got)})",
    )
    for key, k in groups.items():
        # k independent mechanisms with the same symptoms flip it an odd number of
        # times with probability (1 − (1 − 2p)^k) / 2: p for k = 1, 2p(1 − p) for k = 2.
        want = (1 - (1 - 2 * p) ** k) / 2
        check(abs(got[key] - want) < 1e-12, (key, k, got[key], want))
    check(circuit.num_detectors == m * (cycles + 1), (circuit.num_detectors, m, cycles))
    g = build_spacetime_matching(d, stab_type, cycles)
    expected = expected_spacetime_edges(d, stab_type, cycles)
    check(g.num_nodes == m * (cycles + 1), (d, stab_type, cycles, g.num_nodes))
    check(g.num_fault_ids == n)
    check(g.num_edges == len(expected) == n * cycles + m * cycles - (d - 1) * cycles)
    seen = {}
    for a, b, attrs in g.edges():
        key = frozenset({a}) if b is None else frozenset({a, b})
        check(key not in seen)
        check(float(attrs["weight"]).is_integer())
        ids = attrs["fault_ids"]
        check(len(ids) <= 1)
        seen[key] = (int(attrs["weight"]), next(iter(ids)) if ids else -1)
    check(seen == expected, f"S1 d = {d} {stab_type} cycles = {cycles}: Matching edges differ")
    check(set(seen) == {k for k, _ in got}, "S1: Matching keys ≠ DEM keys")
    return len(got)


STIM_SAMPLE_SEED = 20261017
STIM_SAMPLE_SHOTS = 100_000
STIM_SAMPLE_P = 0.03


def selftest_stim_sampling(d: int, cycles: int) -> list[float]:
    """S2: two samplers, one decoder. Stim's detector sampler of the circuit and the numpy
    sampler of D1 agree on the detector rate of every node (|z| < 4) and, decoded with the
    same Matching, on P_X and P_Z (|z| < 4). Returns the two z of the rates."""
    p = STIM_SAMPLE_P
    N = STIM_SAMPLE_SHOTS
    rng = np.random.default_rng([STIM_SAMPLE_SEED, d, cycles])
    cum_x, cum_z, flips_z, flips_x = sample_spacetime(rng, N, d, p, cycles)
    HZ, HX = parity_matrix(d, "Z"), parity_matrix(d, "X")
    numpy_dets = {
        "Z": spacetime_detectors(HZ, cum_x, flips_z),
        "X": spacetime_detectors(HX, cum_z, flips_x),
    }
    fail_x, fail_z = make_spacetime_verdicts(d, cycles)(cum_x, cum_z, flips_z, flips_x)
    numpy_fail = {"Z": fail_x, "X": fail_z}
    zs = []
    for t in STABILIZER_TYPES:
        circuit = stim_circuit(d, t, p, cycles)
        sampler = circuit.compile_detector_sampler(seed=STIM_SAMPLE_SEED)
        dets, obs = sampler.sample(N, separate_observables=True)
        dets = dets.astype(np.uint8)
        check(dets.shape == numpy_dets[t].shape, (dets.shape, numpy_dets[t].shape))
        r_stim = dets.mean(axis=0)
        r_np = numpy_dets[t].mean(axis=0)
        for node in range(dets.shape[1]):
            var = (r_stim[node] * (1 - r_stim[node]) + r_np[node] * (1 - r_np[node])) / N
            z = (r_stim[node] - r_np[node]) / math.sqrt(var)
            check(abs(z) < 4, f"S2 {t} node {node}: stim {r_stim[node]:.5f} numpy {r_np[node]:.5f} z = {z:.2f}")
        g = build_spacetime_matching(d, t, cycles)
        corr = g.decode_batch(dets)
        predicted = corr[:, logical_support(d, t)].sum(axis=1) & 1
        fail_stim = predicted ^ obs[:, 0].astype(np.uint8)
        a, b = float(fail_stim.mean()), float(numpy_fail[t].mean())
        z = (a - b) / math.sqrt((a * (1 - a) + b * (1 - b)) / N)
        check(abs(z) < 4, f"S2 {t}: P(stim) = {a:.5f}, P(numpy) = {b:.5f}, z = {z:.2f}")
        zs.append(z)
    return zs


# --- Exact cycles = 1, d = 3 (S3; phase2.md D5/D7): 2^13 patterns per type -----------------

EXACT_SPACETIME_MECHANISMS = 13
EXACT_PROBE_P = (0.01, 0.03, 0.05)
EXACT_PROBE_RULE = StopRule(min_failures=2, min_shots=100_000, max_shots=100_000)


def exact_spacetime_counts(stab_type: str) -> list[int]:
    """a_w, w = 0 … 13: patterns of (9 data errors, 4 flips) in one cycle of d = 3 whose
    spacetime MWPM correction leaves a logical error, through the decoder of the grid."""
    d, n, m = 3, 9, 4
    H = parity_matrix(d, stab_type)
    g = build_spacetime_matching(d, stab_type, 1)
    k = n + m
    patterns = ((np.arange(1 << k)[:, None] >> np.arange(k)[None, :]) & 1).astype(np.uint8)
    errors = patterns[:, :n]
    flips = patterns[:, n:]
    D = spacetime_detectors(H, [errors], [flips])
    C = g.decode_batch(D)
    R = errors ^ C
    fail = R[:, logical_support(d, stab_type)].sum(axis=1) & 1
    weight = patterns.sum(axis=1)
    return [int(fail[weight == w].sum()) for w in range(k + 1)]


def exact_probe_block(base_seed: int) -> dict:
    counts = {t: exact_spacetime_counts(t) for t in STABILIZER_TYPES}
    points = [
        simulate_spacetime_point(3, p, base_seed, EXACT_PROBE_RULE, cycles=1)
        for p in EXACT_PROBE_P
    ]
    return {
        "d": 3,
        "cycles": 1,
        "stopRule": {
            "minFailures": EXACT_PROBE_RULE.min_failures,
            "minShots": EXACT_PROBE_RULE.min_shots,
            "maxShots": EXACT_PROBE_RULE.max_shots,
        },
        "counts": counts,
        "points": points,
    }


# --- Output files of the phenomenological model (phase2.md D6, D8, D9) ---------------------

PHENO_GRID_PROBABILITIES = (0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04)
WEIGHT_SAMPLE_EDGES = (0, 1, 2, 8, 24, 48, 80, 81, 120, 343, 511, 1088)
PHENO_MIN_WEIGHTS_NOISE = (0.01, 0.02, 0.03, 0.05)
# Uniform random subsets of nodes are capped in size: a 400-node syndrome of d = 9 is not a
# physical syndrome and costs the dense Blossom of the core seconds per case.
PHENO_MIN_WEIGHTS_MAX_SUBSET = 40
VERDICTS_DISTANCES = (3, 5, 7)
VERDICTS_NOISE = (0.01, 0.02, 0.03)
VERDICTS_CASES = 10_000


def pheno_engine_block() -> dict:
    return {**engine_block(), "stim": stim.__version__}


def generate_spacetime_grid(base_seed: int, log) -> dict:
    rule = VALIDATION_STOP_RULE
    points = []
    for d in GRID_DISTANCES:
        for p in PHENO_GRID_PROBABILITIES:
            t0 = time.perf_counter()
            pt = simulate_spacetime_point(d, p, base_seed, rule)
            dt = time.perf_counter() - t0
            if pt["stopReason"] == "failures":
                # T-P11: a stop by failures lands on the 100th failure past 10⁵ shots and
                # uses Haldane's estimator.
                check(pt["failures"] == rule.min_failures and pt["shots"] > rule.min_shots)
                check(pt["estimate"] == (pt["failures"] - 1) / (pt["shots"] - 1))
            points.append(pt)
            log(
                f"d = {d}  p = {p:.3f}  shots = {pt['shots']:>7}  failures = {pt['failures']:>6}"
                f"  estimate = {pt['estimate']:.5f}  [{pt['low']:.5f}, {pt['high']:.5f}]"
                f"  {pt['stopReason']:<8} {dt:6.2f} s"
            )
    return {
        "schema": 1,
        "generator": "tools/reference/run.py",
        "engine": pheno_engine_block(),
        "noise": "phenomenological",
        "model": {"cycles": "d", "q": "p"},
        "stopRule": {
            "minFailures": rule.min_failures,
            "minShots": rule.min_shots,
            "maxShots": rule.max_shots,
        },
        "seed": base_seed,
        "weights": {
            **weights_block(),
            "sample": {str(e): edge_weight(e) for e in WEIGHT_SAMPLE_EDGES},
        },
        "geometry": geometry_block(),
        "exactProbe": exact_probe_block(base_seed),
        "points": points,
    }


def generate_spacetime_min_weights(base_seed: int) -> dict:
    """10⁴ cases, 2 500 per d ∈ {3, 5, 7, 9} with cycles = d: half are detectors of sampled
    histories at p ∈ PHENO_MIN_WEIGHTS_NOISE (cycled), half uniform subsets of ≤ 40 nodes
    (any subset of detectors is a valid syndrome: the space boundary absorbs the parity).
    Defects are node indices (r − 1)·m + typeIndex; the weight is the integer MWPM weight."""
    rng = np.random.default_rng([base_seed, 2])
    cases = []
    for d in MIN_WEIGHTS_DISTANCES:
        cycles = d
        n = d * d
        m = (n - 1) // 2
        nodes = m * (cycles + 1)
        graphs = {t: build_spacetime_matching(d, t, cycles) for t in STABILIZER_TYPES}
        Hs = {t: parity_matrix(d, t) for t in STABILIZER_TYPES}
        for c in range(MIN_WEIGHTS_CASES_PER_D):
            stab_type = STABILIZER_TYPES[c % 2]
            if c < MIN_WEIGHTS_CASES_PER_D // 2:
                p = PHENO_MIN_WEIGHTS_NOISE[(c // 2) % len(PHENO_MIN_WEIGHTS_NOISE)]
                cum_x, cum_z, flips_z, flips_x = sample_spacetime(rng, 1, d, p, cycles)
                cum, flips = (cum_x, flips_z) if stab_type == "Z" else (cum_z, flips_x)
                syndrome = spacetime_detectors(Hs[stab_type], cum, flips)[0]
            else:
                size = int(rng.integers(0, min(nodes, PHENO_MIN_WEIGHTS_MAX_SUBSET) + 1))
                chosen = rng.choice(nodes, size=size, replace=False)
                syndrome = np.zeros(nodes, dtype=np.uint8)
                syndrome[chosen] = 1
            correction, w = graphs[stab_type].decode(syndrome, return_weight=True)
            check(float(w).is_integer(), (d, stab_type, w))
            check(correction.shape == (n,), correction.shape)
            cases.append(
                {
                    "d": d,
                    "type": stab_type,
                    "cycles": cycles,
                    "defects": [int(i) for i in np.flatnonzero(syndrome)],
                    "weight": int(w),
                }
            )
    return {
        "schema": 1,
        "generator": "tools/reference/run.py",
        "pymatching": pymatching.__version__,
        "weights": weights_block(),
        "cases": cases,
    }


def generate_verdicts(base_seed: int) -> dict:
    """10⁴ sampled syndromes of cycles = d (d ∈ {3, 5, 7}, p ∈ {0.01, 0.02, 0.03}, both
    types, round robin; empty syndromes are skipped) with the integer weight and the
    logical parity of PyMatching's correction (row 0 of the X correction for type Z,
    column 0 of the Z correction for type X). The core must equal every weight and all
    but ≤ 5 parities (phase2.md D8: ties between minimum matchings of different parity
    are the only legitimate difference, and they are measured, not assumed)."""
    rng = np.random.default_rng([base_seed, 3])
    combos = [
        (d, p, t) for d in VERDICTS_DISTANCES for p in VERDICTS_NOISE for t in STABILIZER_TYPES
    ]
    graphs = {(d, t): build_spacetime_matching(d, t, d) for d in VERDICTS_DISTANCES for t in STABILIZER_TYPES}
    Hs = {(d, t): parity_matrix(d, t) for d in VERDICTS_DISTANCES for t in STABILIZER_TYPES}
    cases = []
    skipped = 0
    c = 0
    while len(cases) < VERDICTS_CASES:
        d, p, t = combos[c % len(combos)]
        c += 1
        cum_x, cum_z, flips_z, flips_x = sample_spacetime(rng, 1, d, p, d)
        cum, flips = (cum_x, flips_z) if t == "Z" else (cum_z, flips_x)
        syndrome = spacetime_detectors(Hs[(d, t)], cum, flips)[0]
        if not syndrome.any():
            skipped += 1
            continue
        correction, w = graphs[(d, t)].decode(syndrome, return_weight=True)
        check(float(w).is_integer(), (d, t, w))
        parity = int(correction[logical_support(d, t)].sum()) & 1
        cases.append(
            {
                "d": d,
                "type": t,
                "cycles": d,
                "p": p,
                "defects": [int(i) for i in np.flatnonzero(syndrome)],
                "weight": int(w),
                "parity": parity,
            }
        )
    return {
        "schema": 1,
        "generator": "tools/reference/run.py",
        "pymatching": pymatching.__version__,
        "noise": "phenomenological",
        "weights": weights_block(),
        "skippedEmpty": skipped,
        "cases": cases,
    }


# Shared with src/core/decoder/weights.test.ts (phase2.md T-A2) and docs/decisiones.md.
EDGE_WEIGHT_VECTOR = [(81, 16_764_263), (343, 16_770_859), (511, 16_774_866), (1088, 16_773_412)]
# M9: mechanisms per type with cycles = d.
MECHANISM_COUNTS = {3: 39, 5: 185, 7: 511, 9: 1089}
# a_w of cycles = 1, d = 3, computed by exact_spacetime_counts and by the core's
# exactSpacetimeFailureCounts (src/core/sim/exact.test.ts): the same table on both sides.
A_W_SPACETIME_D3 = [0, 0, 18, 128, 389, 705, 888, 828, 582, 326, 158, 60, 13, 1]


def selftest_spacetime(log) -> None:
    for e, w in EDGE_WEIGHT_VECTOR:
        check(edge_weight(e) == w, (e, edge_weight(e), w))
    for q in range(121):
        check(edge_weight(q) == qubit_weight(q))
    for d in (3, 5, 7, 9):
        mechanisms = spacetime_mechanisms(d, "Z", d)
        check(len(mechanisms) == MECHANISM_COUNTS[d] == d * d * d + (d * d - 1) // 2 * d)
        indices = sorted(e for _, e, _ in mechanisms)
        check(indices == list(range(len(mechanisms))), "edge indices are not a bijection")
        check(max(edge_weight(e) for e in indices) <= MAX_EDGE_WEIGHT)
    log("T-P10 edge_weight vector (81, 343, 511, 1088), W_q = W_e on [0, 121), M9 counts: ok")
    counts = []
    for d in (3, 5):
        for cycles in (1, d):
            for t in STABILIZER_TYPES:
                counts.append(f"d{d}c{cycles}{t}={selftest_stim_structure(d, t, cycles, 0.01)}")
    log("S1 Stim DEM = spacetime graph (edges, probabilities, fault qubits): " + ", ".join(counts) + ": ok")
    a = {t: exact_spacetime_counts(t) for t in STABILIZER_TYPES}
    for t in STABILIZER_TYPES:
        check(a[t][0] == 0 and a[t][1] == 0, a[t])
        check(sum(a[t]) < 1 << EXACT_SPACETIME_MECHANISMS)
        check(a[t] == A_W_SPACETIME_D3, f"S3 {t}: a_w = {a[t]} ≠ {A_W_SPACETIME_D3}")
        for w in range(EXACT_SPACETIME_MECHANISMS + 1):
            check(a[t][w] + a[t][EXACT_SPACETIME_MECHANISMS - w] == math.comb(EXACT_SPACETIME_MECHANISMS, w))
    log(f"S3 exact cycles = 1, d = 3: a_w = {a['Z']} (Z = X, sum {sum(a['Z'])}): ok")
    zs = selftest_stim_sampling(3, 3)
    log(
        f"S2 Stim sampler vs numpy sampler, d = 3, cycles = 3, p = {STIM_SAMPLE_P}, "
        f"N = {STIM_SAMPLE_SHOTS}: detector rates |z| < 4 on every node; "
        f"z(P_X, P_Z) = ({zs[0]:+.2f}, {zs[1]:+.2f}): ok"
    )
    # T-P11: the batch accumulation of a spacetime point equals a shot-by-shot loop over
    # the same draws (accumulate is shared with phase 1 and tested in T-P5); here the
    # 3D draw is cut at the exact failure with a small rule.
    rule = StopRule(min_failures=7, min_shots=50, max_shots=3000)
    for batch in (1, 64, 3000):
        verdicts = make_spacetime_verdicts(3, 3)
        rng = np.random.default_rng([STIM_SAMPLE_SEED, 11])
        fx, fz = verdicts(*sample_spacetime(rng, 3000, 3, 0.02, 3))
        fail = fx | fz
        shots = failures = 0
        reason = None
        while reason is None:
            failures += int(fail[shots])
            shots += 1
            reason = stop_per_shot(rule, shots, failures)
        cursor = 0

        def draw(B: int) -> tuple[np.ndarray, np.ndarray]:
            nonlocal cursor
            s = cursor
            cursor += B
            return fx[s : s + B], fz[s : s + B]

        t = accumulate(rule, draw, batch)
        check((t.shots, t.failures, t.reason) == (shots, failures, reason), (batch, t, shots, failures, reason))
    log("T-P11 batch stop = per-shot stop on a 3D point (batch 1, 64, 3000): ok")


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")


# --- Self-test (T-P1 … T-P6) -------------------------------------------------------------------

# Copied BY HAND from tests/intent/lattice-conventions.test.ts (never generated): the only
# shared statement of the geometry contract between the two implementations.
TABLE_D3 = [
    ("Z", 0, 0),
    ("Z", 0, 2),
    ("Z", 1, -1),
    ("Z", 1, 1),
    ("X", -1, 0),
    ("X", 0, 1),
    ("X", 1, 0),
    ("X", 2, 1),
]
TABLE_D5 = [
    ("Z", 0, 0),
    ("Z", 0, 2),
    ("Z", 0, 4),
    ("Z", 1, -1),
    ("Z", 1, 1),
    ("Z", 1, 3),
    ("Z", 2, 0),
    ("Z", 2, 2),
    ("Z", 2, 4),
    ("Z", 3, -1),
    ("Z", 3, 1),
    ("Z", 3, 3),
    ("X", -1, 0),
    ("X", -1, 2),
    ("X", 0, 1),
    ("X", 0, 3),
    ("X", 1, 0),
    ("X", 1, 2),
    ("X", 2, 1),
    ("X", 2, 3),
    ("X", 3, 0),
    ("X", 3, 2),
    ("X", 4, 1),
    ("X", 4, 3),
]
# (type, i, j, boundary, qubits) of d = 3 (docs/spec.md §3; lattice-conventions LAYOUT_D3).
LAYOUT_D3 = [
    ("Z", 0, 0, None, (0, 1, 3, 4)),
    ("Z", 1, 1, None, (4, 5, 7, 8)),
    ("X", 0, 1, None, (1, 2, 4, 5)),
    ("X", 1, 0, None, (3, 4, 6, 7)),
    ("X", -1, 0, "top", (0, 1)),
    ("X", 2, 1, "bottom", (7, 8)),
    ("Z", 1, -1, "left", (3, 6)),
    ("Z", 0, 2, "right", (2, 5)),
]
# (q, hex of splitmix64(WEIGHT_SEED + q), top53, u_q, W_q): src/core/noise/splitmix64.test.ts
# and src/core/decoder/weights.test.ts.
WEIGHT_VECTOR = [
    (0, "62db0789e75f0e7a", 3478171642817505, 0.38615462414543, 16766926),
    (1, "a6e8441d6cc6aa15", 5872528172882133, 0.6519815990293646, 16771381),
    (2, "ca8eaf64bc6c83db", 7126853657005456, 0.7912397023141455, 16773715),
    (8, "57ae679b0ca4b9c9", 3085010372498583, 0.34250495467553577, 16766194),
    (24, "233bcfe45f5f7f48", 1239673532574703, 0.13763140988828393, 16762760),
    (48, "bcfaad76aa4bf596", 6649114818595198, 0.738200036498071, 16772826),
    (80, "2bd0a31e57eef7a8", 1541602875735518, 0.1711523007469926, 16763322),
    (120, "dd6bb5f155e39c8e", 7790549879405683, 0.8649247850606926, 16774950),
]
# Wilson 95 % (validation.md M6; src/core/sim/stats.test.ts).
WILSON_TABLE = [
    (0, 10, 0.0, 0.2775327999),
    (5, 10, 0.2365930905, 0.7634069095),
    (1, 100, 0.001767432064, 0.05448619618),
    (50, 100, 0.4038315304, 0.5961684696),
    (100, 1000, 0.08290944359, 0.1201519632),
    (100, 100_000, 0.0008223379697, 0.001215998317),
    (0, 1_000_000, 0.0, 3.841444064e-6),
    (3, 1_000_000, 1.020271241e-6, 8.821149774e-6),
]
# a_k of d = 3: failing patterns of one error type by weight (validation.md M5).
A_K_D3 = [0, 0, 18, 56, 57, 69, 28, 18, 9, 1]


def _close(a: float, b: float, rel: float = 1e-9) -> bool:
    return abs(a - b) <= rel * max(1.0, abs(b))


def selftest_geometry() -> None:
    for d, table in ((3, TABLE_D3), (5, TABLE_D5)):
        got = [(s.type, s.i, s.j) for s in stabilizers(d)]
        check(got == table, f"T-P1 d = {d}: {got} != {table}")
    stabs3 = {(s.i, s.j): s for s in stabilizers(3)}
    check(len(stabs3) == 8)
    for t, i, j, boundary, qubits in LAYOUT_D3:
        s = stabs3[(i, j)]
        check((s.type, s.boundary, s.qubits) == (t, boundary, qubits), (s, t, boundary, qubits))
    for d in (3, 5, 7, 9):
        stabs = stabilizers(d)
        check(len(stabs) == d * d - 1)
        half = (d * d - 1) // 2
        for k, s in enumerate(stabs):
            check(s.index == k)
            check(s.type == ("Z" if k < half else "X"))
            check(s.type_index == (k if k < half else k - half))
            row_edge = s.i in (-1, d - 1)
            col_edge = s.j in (-1, d - 1)
            check(not (row_edge and col_edge))
            if row_edge:
                check(s.type == "X" and s.boundary == ("top" if s.i == -1 else "bottom"))
                check(len(s.qubits) == 2)
            elif col_edge:
                check(s.type == "Z" and s.boundary == ("left" if s.j == -1 else "right"))
                check(len(s.qubits) == 2)
            else:
                check(s.boundary is None and len(s.qubits) == 4)
                check(s.type == plaquette_type(s.i, s.j))
        # All stabilizers commute: a Z and an X check overlap on an even number of qubits.
        HZ, HX = parity_matrix(d, "Z"), parity_matrix(d, "X")
        check(HZ.shape == (half, d * d) and HX.shape == (half, d * d))
        overlap = HZ.astype(np.int64) @ HX.astype(np.int64).T
        check(np.all(overlap % 2 == 0), f"T-P1 d = {d}: non-commuting checks")
        # Logical operators commute with every check and anticommute with each other.
        xl = np.zeros(d * d, dtype=np.int64)
        xl[logical_support(d, "X")] = 1  # X_L: column 0
        zl = np.zeros(d * d, dtype=np.int64)
        zl[logical_support(d, "Z")] = 1  # Z_L: row 0
        check(np.all((HZ.astype(np.int64) @ xl) % 2 == 0))
        check(np.all((HX.astype(np.int64) @ zl) % 2 == 0))
        check(int(xl @ zl) % 2 == 1)


def selftest_weights() -> None:
    for q, hexs, t53, u, W in WEIGHT_VECTOR:
        out = splitmix64(WEIGHT_SEED + q)
        check(f"{out:016x}" == hexs, (q, f"{out:016x}", hexs))
        check(top53(out) == t53, (q, top53(out), t53))
        check(uniform53(out) == u, (q, uniform53(out), u))
        check(qubit_weight(q) == W, (q, qubit_weight(q), W))
    # Positive control of splitmix64.test.ts: mix(seed) without the increment is not it.
    check(splitmix64(WEIGHT_SEED) != 0xCF4E83BAFEE90FCD)
    check(WEIGHT_SCALE == 16_760_454)
    ws = [qubit_weight(q) for q in range(121)]
    check(len(set(ws)) == 121, "T-P2: weights not all distinct")
    check(all(WEIGHT_SCALE <= w <= MAX_EDGE_WEIGHT for w in ws))
    check(min(ws) == 16_760_749 and max(ws) == 16_777_040, (min(ws), max(ws)))
    check(sum(ws[:9]) == 150_928_060 and sum(ws[:81]) == 1_358_257_734)
    check(121 * 16760 < WEIGHT_SCALE)


def selftest_matching() -> dict[tuple[int, str], int]:
    counts: dict[tuple[int, str], int] = {}
    for d in (3, 5, 7, 9):
        for t in STABILIZER_TYPES:
            g = build_matching(d, t)
            m = (d * d - 1) // 2
            check(g.num_nodes == m, (d, t, g.num_nodes))
            check(g.num_fault_ids == d * d, (d, t, g.num_fault_ids))
            expected = expected_edges(d, t)
            check(g.num_edges == d * d - (d - 1) == len(expected), (d, t, g.num_edges))
            got = {}
            for a, b, attrs in g.edges():
                key = (a, b) if b is None else (min(a, b), max(a, b))
                check(key not in got)
                check(float(attrs["weight"]).is_integer())
                check(len(attrs["fault_ids"]) == 1)
                got[key] = (int(attrs["weight"]), next(iter(attrs["fault_ids"])))
            check(got == expected, f"T-P3 d = {d} {t}: edges differ")
            counts[(d, t)] = g.num_edges
    g3 = build_matching(3, "Z")
    s = np.zeros(4, dtype=np.uint8)
    s[[0, 3]] = 1
    corr, w = g3.decode(s, return_weight=True)
    check(float(w).is_integer() and int(w) == 16_775_504, w)
    check(int(w) == qubit_weight(4) and list(np.flatnonzero(corr)) == [4])
    return counts


def selftest_statistics() -> list[int]:
    for k, n, low, high in WILSON_TABLE:
        got = wilson_interval(k, n)
        check(_close(got[0], low) and _close(got[1], high), (k, n, got, low, high))
    check(wilson_interval(0, 7)[0] == 0.0 and wilson_interval(7, 7)[1] == 1.0)
    check(wilson_interval(0, 0) == (0.0, 1.0))
    check(point_rate(100, 1001, "failures") == 99 / 1000)
    check(point_rate(100, 1001, "shots") == 100 / 1001)
    check(point_rate(100, 1001, "cap") == 100 / 1001)
    check(point_rate(0, 50, "cap") == 0.0 and point_rate(1, 1, "failures") == 0.0)
    check(point_rate(5, 0, "shots") == 0.0)
    # a_k of d = 3 by enumeration of the 2^9 patterns of each error type (M5), through the
    # same verdict path as the simulation (the 2^9 patterns as X errors and as Z errors).
    n = 9
    patterns = ((np.arange(1 << n)[:, None] >> np.arange(n)[None, :]) & 1).astype(np.uint8)
    weight = patterns.sum(axis=1)
    counts_by_type = []
    for t, fail in zip(STABILIZER_TYPES, make_verdicts(3)(patterns, patterns)):
        a = [int(fail[weight == k].sum()) for k in range(n + 1)]
        check(a == A_K_D3, f"T-P4 {t}: a_k = {a}")
        for k in range(n + 1):
            check(a[k] + a[n - k] == math.comb(n, k), (k, a[k], a[n - k]))
        counts_by_type.append(a)
    # The outputs are labelled, not interchangeable: patterns on one side only must fail on
    # that side only (`return fail_z, fail_x` survives the symmetric check above).
    zeros = np.zeros_like(patterns)
    fail_x, fail_z = make_verdicts(3)(patterns, zeros)
    check(int(fail_z.sum()) == 0, f"T-P4 X-only patterns: fail_z = {int(fail_z.sum())}")
    a_x = [int(fail_x[weight == k].sum()) for k in range(n + 1)]
    check(a_x == A_K_D3, f"T-P4 X-only patterns: a_k on fail_x = {a_x}")
    fail_x, fail_z = make_verdicts(3)(zeros, patterns)
    check(int(fail_x.sum()) == 0, f"T-P4 Z-only patterns: fail_x = {int(fail_x.sum())}")
    a_z = [int(fail_z[weight == k].sum()) for k in range(n + 1)]
    check(a_z == A_K_D3, f"T-P4 Z-only patterns: a_k on fail_z = {a_z}")
    check(sum(A_K_D3) == 256)
    return counts_by_type[0]


def exact_rates_d3(a: list[int], p: float) -> tuple[float, float]:
    n = len(a) - 1
    px = sum(a[k] * p**k * (1 - p) ** (n - k) for k in range(n + 1))
    return px, 1 - (1 - px) ** 2


def selftest_stop_rule() -> None:
    rng = np.random.default_rng(12345)
    rules = [
        StopRule(7, 50, 3000),
        StopRule(10, 2000, 100_000),
        StopRule(1000, 10, 500),
        StopRule(2, 1, 1),
        StopRule(3, 10, 10),
    ]
    for rule in rules:
        for p in (0.0, 0.003, 0.3):
            fail = (rng.random(rule.max_shots) < p).astype(np.uint8)
            # Per-shot reference.
            shots = failures = 0
            reason = None
            while reason is None:
                failures += int(fail[shots])
                shots += 1
                reason = stop_per_shot(rule, shots, failures)
            for batch in (1, 7, 64, 1000, 100_000):
                s = f = 0
                r = None
                while r is None:
                    chunk = fail[s : s + min(batch, rule.max_shots - s)]
                    keep, r = apply_batch(rule, s, f, chunk)
                    f += int(chunk[:keep].sum())
                    s += keep
                check((s, f, r) == (shots, failures, reason), (rule, p, batch, s, f, r, shots, failures, reason))
    # A stop by failures lands exactly on the k-th failure.
    rule = StopRule(7, 50, 3000)
    fail = (np.random.default_rng(7).random(3000) < 0.01).astype(np.uint8)
    keep, reason = apply_batch(rule, 0, 0, fail)
    check(reason == "failures" and fail[keep - 1] == 1 and int(fail[:keep].sum()) == 7)
    # Stops by shots / cap on the exact shot.
    check(apply_batch(StopRule(2, 10, 20), 0, 0, np.ones(20, dtype=np.uint8)) == (10, "shots"))
    check(apply_batch(StopRule(2, 10, 20), 0, 0, np.zeros(20, dtype=np.uint8)) == (20, "cap"))
    check(apply_batch(StopRule(2, 10, 20), 9, 0, np.ones(20, dtype=np.uint8)) == (2, "failures"))
    # Accumulation across batches with both types: (N, k, kX, kZ, estimate, estimateX,
    # estimateZ), the three Wilson intervals and upperBoundOnly of accumulate +
    # point_estimates equal a loop shot by shot over the same failure vectors, for every
    # batch size and every stop reason, including k = 0 (stop by cap, upper bound only).
    rng = np.random.default_rng(2024)
    cases = [
        (StopRule(7, 20, 500), 0.06, 0.04, "failures"),
        (StopRule(3, 50, 500), 0.3, 0.2, "shots"),
        (StopRule(5, 20, 300), 0.004, 0.002, "cap"),
        (StopRule(2, 1, 1000), 0.01, 0.01, "failures"),
        (StopRule(5, 20, 300), 0.0, 0.0, "cap"),  # k = 0
    ]
    seen_k0 = False
    for rule, px, pz, expected_reason in cases:
        fx_all = (rng.random(rule.max_shots) < px).astype(np.uint8)
        fz_all = (rng.random(rule.max_shots) < pz).astype(np.uint8)
        shots = k = kx = kz = 0
        reason = None
        while reason is None:
            kx += int(fx_all[shots])
            kz += int(fz_all[shots])
            k += int(fx_all[shots] | fz_all[shots])
            shots += 1
            reason = stop_per_shot(rule, shots, k)
        check(reason == expected_reason, (rule, reason, expected_reason))
        seen_k0 = seen_k0 or k == 0
        if reason == "failures":
            est = (k - 1) / (shots - 1)
            est_x, est_z = est * kx / k, est * kz / k
        else:
            est, est_x, est_z = k / shots, kx / shots, kz / shots
        for batch in (1, 3, 16, 100, 500):
            cursor = 0

            def draw(B: int) -> tuple[np.ndarray, np.ndarray]:
                nonlocal cursor
                check(B >= 1 and cursor + B <= rule.max_shots, (batch, cursor, B))
                s = cursor
                cursor += B
                return fx_all[s : s + B], fz_all[s : s + B]

            t = accumulate(rule, draw, batch)
            got = point_estimates(t)
            ints = (t.shots, t.failures, t.failures_x, t.failures_z, t.reason)
            check(ints == (shots, k, kx, kz, reason), (rule, batch, ints, (shots, k, kx, kz)))
            check((got["shots"], got["failures"], got["failuresX"], got["failuresZ"]) == ints[:4])
            check(got["stopReason"] == reason)
            for key, want in (("estimate", est), ("estimateX", est_x), ("estimateZ", est_z)):
                check(_close(got[key], want), (rule, batch, key, got[key], want))
            for suffix, k_type in (("", k), ("X", kx), ("Z", kz)):
                low, high = wilson_interval(k_type, shots)
                got_low, got_high = got["low" + suffix], got["high" + suffix]
                check(
                    _close(got_low, low) and _close(got_high, high),
                    (rule, batch, "low/high" + suffix, got_low, got_high, low, high),
                )
            check(got["upperBoundOnly"] == (k == 0), (rule, batch, got["upperBoundOnly"], k))
            # Whole batches were drawn, the last one cut at the cap (not one batch more).
            drawn = min(-(-shots // batch) * batch, rule.max_shots)
            check(cursor == drawn, (rule, batch, cursor, shots))
    check(seen_k0, "T-P5: no case with k = 0")


SIM_D3_SEED = 7
SIM_D3_P = 0.10
SIM_D3_SHOTS = 40_000


def selftest_simulation(a: list[int]) -> list[float]:
    """T-P6: the noise sampler and a real simulate_point of d = 3 against M5.

    Independence of the X and Z draws is checked on the sample itself (joint rate p², not
    p): at d = 3 a Z pattern copied from the X pattern moves P_L by ≈ 4σ at p = 0.10,
    N = 40 000 (exact enumeration: 0.22506 → 0.21621, −4.24σ; only −0.86σ at p = 0.03),
    below the |z| < 4 gate only by chance; the joint-rate check P(X∧Z) is what catches it
    (z ≈ 539). The wrong logical support is caught exactly by T-P4, which
    enumerates through make_verdicts. N = 40 000 gives the end-to-end check an expected
    |z| ≥ 6 for `fail = fail_x + fail_z` (P_L = P_X + P_Z, |z| ≈ 6.9) and for noise at
    p/2 (|z| ≈ 34). P_Z = P_X by the symmetry of the geometry (T-P4, both types).
    """
    n, p = 9, SIM_D3_P
    rng = np.random.default_rng(SIM_D3_SEED)
    EX, EZ = sample_errors(rng, SIM_D3_SHOTS, n, p)
    check(EX.shape == EZ.shape == (SIM_D3_SHOTS, n) and EX.dtype == EZ.dtype == np.uint8)
    m = SIM_D3_SHOTS * n
    for label, got, want in (
        ("P(X)", float(EX.mean()), p),
        ("P(Z)", float(EZ.mean()), p),
        ("P(X and Z)", float((EX & EZ).mean()), p * p),
    ):
        z = (got - want) / math.sqrt(want * (1 - want) / m)
        check(abs(z) < 4, f"T-P6 noise {label} = {got:.5f}, want {want:.5f}, z = {z:.2f}")
    rule = StopRule(min_failures=2, min_shots=SIM_D3_SHOTS, max_shots=SIM_D3_SHOTS)
    pt = simulate_point(3, p, SIM_D3_SEED, rule)
    px, pl = exact_rates_d3(a, p)
    check(pt["stopReason"] == "shots" and pt["shots"] == SIM_D3_SHOTS, pt)
    check(
        max(pt["failuresX"], pt["failuresZ"]) <= pt["failures"] <= pt["failuresX"] + pt["failuresZ"],
        pt,
    )
    zs = []
    for key, exact in (("estimate", pl), ("estimateX", px), ("estimateZ", px)):
        sigma = math.sqrt(exact * (1 - exact) / pt["shots"])
        z = (pt[key] - exact) / sigma
        check(abs(z) < 4, f"T-P6 {key} = {pt[key]:.5f}, exact {exact:.5f}, z = {z:.2f}")
        zs.append(z)
    return zs


def selftest(log) -> dict[tuple[int, str], int]:
    t0 = time.perf_counter()
    selftest_geometry()
    log("T-P1 geometry: tables d = 3, 5; layout d = 3; d in {3,5,7,9} commute: ok")
    selftest_weights()
    log("T-P2 weights: 8-entry vector, 121 distinct W_q <= 16777215, sums, min/max: ok")
    counts = selftest_matching()
    log(
        "T-P3 PyMatching graphs: "
        + ", ".join(f"d{d}{t}={c}" for (d, t), c in counts.items())
        + " edges; decode([0,3]) d=3 Z = 16775504: ok"
    )
    a = selftest_statistics()
    px, pl = exact_rates_d3(a, 0.03)
    check(_close(pl, 0.02857278377) and _close(px, 0.01438992688), (px, pl))
    check(_close(exact_rates_d3(a, 0.10)[1], 0.2250623886))
    check(_close(exact_rates_d3(a, 0.15)[1], 0.3867134912))
    log(f"T-P4 Wilson table, point_rate, a_k(d=3) = {a}, exact P_L(0.03) = {pl:.10f}: ok")
    selftest_stop_rule()
    log(
        "T-P5 batch stop = per-shot stop (5 rules x 3 p x 5 batch sizes); "
        "accumulate + estimates + Wilson + upperBoundOnly = shot by shot "
        "(5 rules x 5 batch sizes, one with k = 0): ok"
    )
    zs = selftest_simulation(a)
    log(
        f"T-P6 noise X/Z independent (joint rate p^2); simulate_point d = 3, p = {SIM_D3_P}, "
        f"N = {SIM_D3_SHOTS} vs exact: z(P_L, P_X, P_Z) = ({zs[0]:+.2f}, {zs[1]:+.2f}, "
        f"{zs[2]:+.2f}), |z| < 4: ok"
    )
    selftest_spacetime(log)
    log(f"selftest passed in {time.perf_counter() - t0:.2f} s")
    return counts


# --- CLI -------------------------------------------------------------------------------------


def generate_phenomenological(args, out: Path, log) -> int:
    if args.only in (None, "min-weights"):
        t0 = time.perf_counter()
        fixture = generate_spacetime_min_weights(args.seed)
        path = out / "min-weights-phenomenological.json"
        write_json(path, fixture)
        log(f"{path.name}: {len(fixture['cases'])} cases in {time.perf_counter() - t0:.2f} s -> {path}")
    if args.only in (None, "verdicts"):
        t0 = time.perf_counter()
        fixture = generate_verdicts(args.seed)
        path = out / "verdicts-phenomenological.json"
        write_json(path, fixture)
        log(
            f"{path.name}: {len(fixture['cases'])} cases ({fixture['skippedEmpty']} empty "
            f"syndromes skipped) in {time.perf_counter() - t0:.2f} s -> {path}"
        )
    if args.only in (None, "grid"):
        t0 = time.perf_counter()
        ref = generate_spacetime_grid(args.seed, log)
        path = out / "reference-phenomenological.json"
        write_json(path, ref)
        total_shots = sum(pt["shots"] for pt in ref["points"])
        by_failures = [(pt["d"], pt["p"]) for pt in ref["points"] if pt["stopReason"] == "failures"]
        log(
            f"{path.name}: {len(ref['points'])} points, {total_shots} shots, stopped by "
            f"failures at {by_failures}, in {time.perf_counter() - t0:.2f} s -> {path}"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", default="docs/validacion", help="output directory")
    parser.add_argument("--seed", type=int, default=20261016, help="base seed")
    parser.add_argument(
        "--model",
        choices=("independent", "phenomenological"),
        default="independent",
        help="noise model of the files to generate (the selftest covers both)",
    )
    parser.add_argument(
        "--only", choices=("grid", "min-weights", "verdicts"), default=None
    )
    parser.add_argument("--selftest", action="store_true", help="run the self-test only")
    args = parser.parse_args(argv)
    if args.model == "independent" and args.only == "verdicts":
        parser.error("--only verdicts needs --model phenomenological")

    def log(msg: str) -> None:
        print(msg, flush=True)

    log(
        f"pymatching {pymatching.__version__}, stim {stim.__version__}, numpy {np.__version__}, "
        f"python {platform.python_version()}"
    )
    selftest(log)
    if args.selftest:
        return 0
    out = Path(args.out)
    if args.model == "phenomenological":
        return generate_phenomenological(args, out, log)
    if args.only in (None, "min-weights"):
        t0 = time.perf_counter()
        fixture = generate_min_weights(args.seed)
        write_json(out / "min-weights.json", fixture)
        log(
            f"min-weights.json: {len(fixture['cases'])} cases in "
            f"{time.perf_counter() - t0:.2f} s -> {out / 'min-weights.json'}"
        )
    if args.only in (None, "grid"):
        t0 = time.perf_counter()
        ref = generate_grid(args.seed, log)
        write_json(out / "reference.json", ref)
        total_shots = sum(pt["shots"] for pt in ref["points"])
        log(
            f"reference.json: {len(ref['points'])} points, {total_shots} shots in "
            f"{time.perf_counter() - t0:.2f} s -> {out / 'reference.json'}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
