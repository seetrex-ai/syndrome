// Exact minimum-weight perfect matching on a dense general graph: Edmonds'
// primal-dual blossom algorithm, O(V³) (docs/spec.md §5 "Decodificador",
// tasks/plans/decoder.md D6). Generic: it knows nothing about the lattice.
//
// Formulation. The caller fills `weight` (maxVertices², row-major) for the
// first v vertices with non-negative integers or NO_EDGE, then calls solve(v).
// Internally the problem is turned into a MAXIMUM-weight matching with
//   w' = M + (C − w),   C = max real weight + 1,   M = (v/2)·C,
// so that (a) every real edge has w' > 0 (0 marks "no edge"), (b) a matching
// with more edges always outweighs one with fewer (M exceeds any sum of v/2 − 1
// edge surpluses), hence the maximum-weight matching is a perfect one when one
// exists, and (c) among perfect matchings the maximum of Σ(C − w) is the
// minimum of Σw. All duals are kept as integers by doubling the weights in the
// reduced costs (lab[u] + lab[v] − 2·w'), as PyMatching does; values stay far
// below 2⁵³ (R7), so every comparison is exact.
//
// Structure (classic dense implementation). Vertices 1 … n are the real ones;
// blossoms occupy n+1 … 2n. `st[x]` is the outermost blossom containing x (x
// itself when x is top level, 0 when a blossom slot is free), `flower[b]` the
// odd cycle of sub-blossoms of b starting at its base, `flowerFrom[b][x]` the
// child of b that contains real vertex x, `mate` and `pa` the matching and the
// alternating-tree parent, `S` the label (0 outer, 1 inner, −1 free), `lab` the
// dual, `slack[x]` the real vertex u with the tightest edge into x from an
// outer vertex. Edges between (pseudo)vertices are stored as (eu, ev, ew): the
// real endpoints and the weight of the representative edge, so that an edge
// into a blossom knows through which real vertex it enters.
//
// All arrays are allocated once in createMatcher for maxVertices and reused;
// solve allocates nothing (hot path of decode, §7).

export const NO_EDGE = 2 ** 40;

export interface Matcher {
  readonly maxVertices: number;
  /** maxVertices², row-major; the caller fills [0, v)² before solve. Symmetric. */
  readonly weight: Float64Array;
  /** Result: mate[u] for u < v. */
  readonly mate: Int32Array;
  /**
   * Minimum-weight perfect matching on the first v vertices (v even). Returns
   * the total weight. RangeError if v is odd, negative or > maxVertices, or if
   * a weight is not a non-negative integer (NO_EDGE allowed); Error if no
   * perfect matching avoids NO_EDGE.
   */
  solve(v: number): number;
}

/** Allocates a matcher for up to maxVertices vertices (integer ≥ 1). */
export function createMatcher(maxVertices: number): Matcher {
  if (!Number.isInteger(maxVertices) || maxVertices < 1) {
    throw new RangeError(
      `maxVertices must be a positive integer, got ${maxVertices}`,
    );
  }
  const N = maxVertices;
  const weight = new Float64Array(N * N);
  const mate = new Int32Array(N);
  const state = new BlossomState(N);
  return {
    maxVertices: N,
    weight,
    mate,
    solve(v: number): number {
      return state.solve(v, weight, mate);
    },
  };
}

class BlossomState {
  readonly n0: number; // maxVertices
  readonly W: number; // row width of the internal matrices: 2·maxVertices + 1
  // Edge matrices over (pseudo)vertices 0 … 2n.
  readonly eu: Int32Array;
  readonly ev: Int32Array;
  readonly ew: Float64Array;
  // Per (pseudo)vertex.
  readonly lab: Float64Array;
  readonly match: Int32Array;
  readonly slack: Int32Array;
  readonly st: Int32Array;
  readonly pa: Int32Array;
  readonly S: Int8Array;
  readonly vis: Int32Array;
  // flower[b] as a fixed-stride table with a length per blossom.
  readonly flower: Int32Array;
  readonly flowerLen: Int32Array;
  // flowerFrom[b][x] for real x (0 … n), stride n0 + 1.
  readonly flowerFrom: Int32Array;
  readonly queue: Int32Array;
  readonly scratch: Int32Array;
  n = 0;
  nx = 0;
  qHead = 0;
  qTail = 0;
  visStamp = 0;

  constructor(maxVertices: number) {
    const n0 = maxVertices;
    const W = 2 * n0 + 1;
    this.n0 = n0;
    this.W = W;
    this.eu = new Int32Array(W * W);
    this.ev = new Int32Array(W * W);
    this.ew = new Float64Array(W * W);
    this.lab = new Float64Array(W);
    this.match = new Int32Array(W);
    this.slack = new Int32Array(W);
    this.st = new Int32Array(W);
    this.pa = new Int32Array(W);
    this.S = new Int8Array(W);
    this.vis = new Int32Array(W);
    this.flower = new Int32Array(W * (n0 + 1));
    this.flowerLen = new Int32Array(W);
    this.flowerFrom = new Int32Array(W * (n0 + 1));
    // One push per real vertex becoming outer, at most once per phase, and the
    // queue is reset (qTail = 0) at the start of each phase and after every dual
    // adjustment, so it never holds more than n0 entries (measured max = V at
    // V = 80 on 2026-10-16). The bound is still checked.
    this.queue = new Int32Array(n0 + 1);
    this.scratch = new Int32Array(n0 + 1);
  }

  // Reduced cost of the (representative) edge stored at (u, x).
  private eDelta(u: number, x: number): number {
    const k = u * this.W + x;
    return this.lab[this.eu[k]!]! + this.lab[this.ev[k]!]! - 2 * this.ew[k]!;
  }

  private updateSlack(u: number, x: number): void {
    const s = this.slack[x]!;
    if (s === 0 || this.eDelta(u, x) < this.eDelta(s, x)) this.slack[x] = u;
  }

  private setSlack(x: number): void {
    this.slack[x] = 0;
    const n = this.n;
    const W = this.W;
    for (let u = 1; u <= n; u++) {
      if (
        this.ew[u * W + x]! > 0 &&
        this.st[u] !== x &&
        this.S[this.st[u]!] === 0
      ) {
        this.updateSlack(u, x);
      }
    }
  }

  private qPush(x: number): void {
    if (x <= this.n) {
      if (this.qTail >= this.queue.length) {
        throw new Error("blossom: queue overflow (internal bug)");
      }
      this.queue[this.qTail++] = x;
      return;
    }
    const len = this.flowerLen[x]!;
    const base = x * (this.n0 + 1);
    for (let i = 0; i < len; i++) this.qPush(this.flower[base + i]!);
  }

  private setSt(x: number, b: number): void {
    this.st[x] = b;
    if (x <= this.n) return;
    const len = this.flowerLen[x]!;
    const base = x * (this.n0 + 1);
    for (let i = 0; i < len; i++) this.setSt(this.flower[base + i]!, b);
  }

  // Position of xr in flower[b]; if odd, reverses flower[b][1 …] so that the
  // even path from the base reaches xr, and returns the new position.
  private getPr(b: number, xr: number): number {
    const len = this.flowerLen[b]!;
    const base = b * (this.n0 + 1);
    let pr = 0;
    while (pr < len && this.flower[base + pr] !== xr) pr++;
    if (pr % 2 === 1) {
      // reverse(flower[b].begin() + 1, flower[b].end())
      let lo = base + 1;
      let hi = base + len - 1;
      while (lo < hi) {
        const t = this.flower[lo]!;
        this.flower[lo] = this.flower[hi]!;
        this.flower[hi] = t;
        lo++;
        hi--;
      }
      return len - pr;
    }
    return pr;
  }

  private setMatch(u: number, v: number): void {
    const W = this.W;
    const k = u * W + v;
    this.match[u] = this.ev[k]!;
    if (u <= this.n) return;
    const eU = this.eu[k]!;
    const xr = this.flowerFrom[u * (this.n0 + 1) + eU]!;
    const pr = this.getPr(u, xr);
    const base = u * (this.n0 + 1);
    for (let i = 0; i < pr; i++) {
      this.setMatch(this.flower[base + i]!, this.flower[base + (i ^ 1)]!);
    }
    this.setMatch(xr, v);
    // rotate(flower[u].begin(), flower[u].begin() + pr, flower[u].end())
    const len = this.flowerLen[u]!;
    if (pr > 0) {
      for (let i = 0; i < len; i++) {
        this.scratch[i] = this.flower[base + ((i + pr) % len)]!;
      }
      for (let i = 0; i < len; i++) this.flower[base + i] = this.scratch[i]!;
    }
  }

  private augment(u: number, v: number): void {
    // An augmenting path alternates through at most V vertices; a longer walk
    // means the tree is inconsistent (blossom-parity mutant, 2026-10-16).
    let hops = 0;
    for (;;) {
      if (hops++ > this.n) {
        throw new Error(
          "blossom: augmenting path longer than V (internal bug)",
        );
      }
      const xnv = this.st[this.match[u]!]!;
      this.setMatch(u, v);
      if (xnv === 0) return;
      this.setMatch(xnv, this.st[this.pa[xnv]!]!);
      u = this.st[this.pa[xnv]!]!;
      v = xnv;
    }
  }

  private getLca(u: number, v: number): number {
    const t = ++this.visStamp;
    while (u !== 0 || v !== 0) {
      if (u !== 0) {
        if (this.vis[u] === t) return u;
        this.vis[u] = t;
        u = this.st[this.match[u]!]!;
        if (u !== 0) u = this.st[this.pa[u]!]!;
      }
      const tmp = u;
      u = v;
      v = tmp;
    }
    return 0;
  }

  private addBlossom(u: number, lca: number, v: number): void {
    const n = this.n;
    const W = this.W;
    const stride = this.n0 + 1;
    let b = n + 1;
    while (b <= this.nx && this.st[b] !== 0) b++;
    if (b > this.nx) this.nx++;
    if (b > 2 * n)
      throw new Error("blossom: no free blossom slot (internal bug)");
    this.lab[b] = 0;
    this.S[b] = 0;
    this.match[b] = this.match[lca]!;
    const base = b * stride;
    let len = 0;
    this.flower[base + len++] = lca;
    len = this.pushPath(b, len, u, lca);
    // reverse(flower[b].begin() + 1, flower[b].end())
    {
      let lo = base + 1;
      let hi = base + len - 1;
      while (lo < hi) {
        const t = this.flower[lo]!;
        this.flower[lo] = this.flower[hi]!;
        this.flower[hi] = t;
        lo++;
        hi--;
      }
    }
    len = this.pushPath(b, len, v, lca);
    this.flowerLen[b] = len;
    this.setSt(b, b);
    for (let x = 1; x <= this.nx; x++) {
      this.ew[b * W + x] = 0;
      this.ew[x * W + b] = 0;
    }
    for (let x = 1; x <= n; x++) this.flowerFrom[base + x] = 0;
    for (let i = 0; i < len; i++) {
      const xs = this.flower[base + i]!;
      for (let x = 1; x <= this.nx; x++) {
        if (
          this.ew[b * W + x] === 0 ||
          this.eDelta(xs, x) < this.eDelta(b, x)
        ) {
          this.copyEdge(xs * W + x, b * W + x);
          this.copyEdge(x * W + xs, x * W + b);
        }
      }
      const xsBase = xs * stride;
      for (let x = 1; x <= n; x++) {
        if (this.flowerFrom[xsBase + x] !== 0) this.flowerFrom[base + x] = xs;
      }
    }
    this.setSlack(b);
  }

  // Appends to flower[b] (from position len) the pairs (x, mate of x) walking
  // up the alternating tree from `from` to `lca`; the mates become outer.
  private pushPath(b: number, len: number, from: number, lca: number): number {
    const base = b * (this.n0 + 1);
    let x = from;
    while (x !== lca) {
      this.flower[base + len++] = x;
      const y = this.st[this.match[x]!]!;
      this.flower[base + len++] = y;
      this.qPush(y);
      x = this.st[this.pa[y]!]!;
    }
    return len;
  }

  private copyEdge(from: number, to: number): void {
    this.eu[to] = this.eu[from]!;
    this.ev[to] = this.ev[from]!;
    this.ew[to] = this.ew[from]!;
  }

  private expandBlossom(b: number): void {
    const W = this.W;
    const stride = this.n0 + 1;
    const base = b * stride;
    const len = this.flowerLen[b]!;
    for (let i = 0; i < len; i++) {
      const x = this.flower[base + i]!;
      this.setSt(x, x);
    }
    const xr = this.flowerFrom[base + this.eu[b * W + this.pa[b]!]!]!;
    const pr = this.getPr(b, xr);
    for (let i = 0; i < pr; i += 2) {
      const xs = this.flower[base + i]!;
      const xns = this.flower[base + i + 1]!;
      this.pa[xs] = this.eu[xns * W + xs]!;
      this.S[xs] = 1;
      this.S[xns] = 0;
      this.slack[xs] = 0;
      this.setSlack(xns);
      this.qPush(xns);
    }
    this.S[xr] = 1;
    this.pa[xr] = this.pa[b]!;
    for (let i = pr + 1; i < len; i++) {
      const xs = this.flower[base + i]!;
      this.S[xs] = -1;
      this.setSlack(xs);
    }
    this.st[b] = 0;
  }

  // Processes the tight edge stored at (eu, ev) = real endpoints; returns true
  // after an augmentation.
  private onFoundEdge(eU: number, eV: number): boolean {
    const u = this.st[eU]!;
    const v = this.st[eV]!;
    if (this.S[v] === -1) {
      this.pa[v] = eU;
      this.S[v] = 1;
      const nu = this.st[this.match[v]!]!;
      this.slack[v] = 0;
      this.slack[nu] = 0;
      this.S[nu] = 0;
      this.qPush(nu);
    } else if (this.S[v] === 0) {
      const lca = this.getLca(u, v);
      if (lca === 0) {
        this.augment(u, v);
        this.augment(v, u);
        return true;
      }
      this.addBlossom(u, lca, v);
    }
    return false;
  }

  // One augmentation search: returns true if the matching grew.
  private matching(): boolean {
    const n = this.n;
    const W = this.W;
    for (let x = 1; x <= this.nx; x++) {
      this.S[x] = -1;
      this.slack[x] = 0;
    }
    this.qHead = 0;
    this.qTail = 0;
    for (let x = 1; x <= this.nx; x++) {
      if (this.st[x] === x && this.match[x] === 0) {
        this.pa[x] = 0;
        this.S[x] = 0;
        this.qPush(x);
      }
    }
    if (this.qTail === 0) return false;
    // Every dual adjustment is followed by progress (a vertex joins the tree, a
    // blossom forms or expands: O(V) events per phase), so more than 4V + 8
    // adjustments means the duals are inconsistent: an Error beats a silent
    // infinite loop in the Worker (measured with a blossom-parity mutant,
    // 2026-10-16).
    let adjustments = 0;
    for (;;) {
      if (adjustments++ > 4 * n + 8) {
        throw new Error(
          "blossom: no progress after 4V + 8 dual adjustments (internal bug)",
        );
      }
      while (this.qHead < this.qTail) {
        const u = this.queue[this.qHead++]!;
        if (this.S[this.st[u]!] === 1) continue;
        for (let v = 1; v <= n; v++) {
          const k = u * W + v;
          if (this.ew[k]! > 0 && this.st[u] !== this.st[v]) {
            if (this.eDelta(u, v) === 0) {
              if (this.onFoundEdge(this.eu[k]!, this.ev[k]!)) return true;
            } else {
              this.updateSlack(u, this.st[v]!);
            }
          }
        }
      }
      let d = Number.POSITIVE_INFINITY;
      for (let b = n + 1; b <= this.nx; b++) {
        if (this.st[b] === b && this.S[b] === 1) {
          const half = this.lab[b]! / 2;
          if (half < d) d = half;
        }
      }
      for (let x = 1; x <= this.nx; x++) {
        const s = this.slack[x]!;
        if (this.st[x] === x && s !== 0) {
          if (this.S[x] === -1) {
            const delta = this.eDelta(s, x);
            if (delta < d) d = delta;
          } else if (this.S[x] === 0) {
            const delta = this.eDelta(s, x) / 2;
            if (delta < d) d = delta;
          }
        }
      }
      if (!Number.isFinite(d)) return false;
      for (let u = 1; u <= n; u++) {
        const label = this.S[this.st[u]!];
        if (label === 0) {
          if (this.lab[u]! <= d) return false;
          this.lab[u] = this.lab[u]! - d;
        } else if (label === 1) {
          this.lab[u] = this.lab[u]! + d;
        }
      }
      for (let b = n + 1; b <= this.nx; b++) {
        if (this.st[b] === b) {
          const label = this.S[this.st[b]!];
          if (label === 0) this.lab[b] = this.lab[b]! + 2 * d;
          else if (label === 1) this.lab[b] = this.lab[b]! - 2 * d;
        }
      }
      this.qHead = 0;
      this.qTail = 0;
      for (let x = 1; x <= this.nx; x++) {
        const s = this.slack[x]!;
        if (
          this.st[x] === x &&
          s !== 0 &&
          this.st[s] !== x &&
          this.eDelta(s, x) === 0
        ) {
          const k = s * W + x;
          if (this.onFoundEdge(this.eu[k]!, this.ev[k]!)) return true;
        }
      }
      for (let b = n + 1; b <= this.nx; b++) {
        if (this.st[b] === b && this.S[b] === 1 && this.lab[b] === 0) {
          this.expandBlossom(b);
        }
      }
    }
  }

  solve(v: number, weight: Float64Array, mate: Int32Array): number {
    const n0 = this.n0;
    if (!Number.isInteger(v) || v < 0 || v > n0 || v % 2 !== 0) {
      throw new RangeError(
        `vertex count must be an even integer in [0, ${n0}], got ${v}`,
      );
    }
    if (v === 0) return 0;
    const n = v;
    const W = this.W;
    this.n = n;
    this.nx = n;

    // Largest real weight, with validation of the caller's matrix.
    let maxReal = 0;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const w = weight[a * n0 + b]!;
        if (w === NO_EDGE) continue;
        if (!Number.isInteger(w) || w < 0 || w >= NO_EDGE) {
          throw new RangeError(
            `weight[${a}][${b}] must be a non-negative integer below NO_EDGE, got ${w}`,
          );
        }
        if (weight[b * n0 + a] !== w) {
          throw new RangeError(
            `weight matrix must be symmetric: weight[${a}][${b}] = ${w}, weight[${b}][${a}] = ${weight[b * n0 + a]}`,
          );
        }
        if (w > maxReal) maxReal = w;
      }
    }
    const C = maxReal + 1;
    const M = (n / 2) * C;

    // Internal edges over real vertices 1 … n; 0 = no edge.
    let wMax = 0;
    for (let a = 0; a < n; a++) {
      const u = a + 1;
      for (let b = 0; b < n; b++) {
        const x = b + 1;
        const k = u * W + x;
        this.eu[k] = u;
        this.ev[k] = x;
        const w = weight[a * n0 + b]!;
        const internal = a === b || w === NO_EDGE ? 0 : M + (C - w);
        this.ew[k] = internal;
        if (internal > wMax) wMax = internal;
      }
    }
    for (let u = 0; u <= 2 * n; u++) {
      this.st[u] = u;
      this.flowerLen[u] = 0;
      this.match[u] = 0;
    }
    const stride = n0 + 1;
    for (let u = 1; u <= n; u++) {
      const base = u * stride;
      for (let x = 1; x <= n; x++) this.flowerFrom[base + x] = u === x ? u : 0;
      this.lab[u] = wMax;
    }
    for (let u = n + 1; u <= 2 * n; u++) {
      this.st[u] = 0;
      this.lab[u] = 0;
    }
    this.visStamp = 0;
    for (let u = 0; u <= 2 * n; u++) this.vis[u] = 0;

    // Each successful phase augments the matching by one edge: more than V/2
    // of them means an augmentation did not take (blossom-parity mutant,
    // 2026-10-16).
    let phases = 0;
    while (this.matching()) {
      if (++phases > n / 2) {
        throw new Error("blossom: more than V/2 augmentations (internal bug)");
      }
    }

    let total = 0;
    for (let a = 0; a < n; a++) {
      const partner = this.match[a + 1]!;
      if (partner === 0) {
        throw new Error(
          `no perfect matching on ${n} vertices (vertex ${a} is unmatched)`,
        );
      }
      mate[a] = partner - 1;
      if (partner - 1 > a) total += weight[a * n0 + (partner - 1)]!;
    }
    return total;
  }
}
