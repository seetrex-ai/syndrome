import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOUNDARY, qubitIndex, rotatedSurfaceCode } from "../../core";
import {
  edgeSegment,
  GAP_DEFAULT,
  GAP_MAX,
  GAP_MIN,
  GAP_STEP,
  layerPolygon,
  nodeCheck,
  nodeLayer,
  plaquetteCentre,
  project,
  qubitPoint3,
  rotate,
  rotatePoint,
  SIDE_MARGIN,
  STACK_REACH,
  TILT,
  TITLE_CLEARANCE,
  TITLE_EM,
  TITLE_EM_MEASURED,
  TITLE_FONT_SIZE,
  TITLE_LINE_CHARS,
  titleLayout,
  titleLines,
  lineWidth,
  titleWidth,
  UNIT,
  viewBoxOf,
  VIEWS,
  type Point,
} from "./projection";
import en from "../../locales/en.json";
import es from "../../locales/es.json";

describe("T-G5 projection (phase2-g.md D4)", () => {
  it("rotate is the identity for view 0 and a bijection of the board for views 0 … 3; four turns are the identity", () => {
    for (const d of [3, 5, 7, 9]) {
      for (let view = 0; view < 4; view++) {
        const seen = new Set<string>();
        for (let row = 0; row < d; row++) {
          for (let col = 0; col < d; col++) {
            const [x, y] = rotate(d, view, row, col);
            expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
            expect(x >= 0 && x < d && y >= 0 && y < d).toBe(true);
            seen.add(`${x},${y}`);
            if (view === 0) expect([x, y]).toEqual([col, row]);
            expect(rotate(d, view + 4, row, col)).toEqual([x, y]);
          }
        }
        expect(seen.size).toBe(d * d);
      }
      // One quarter turn: (x, y) → (y, d − 1 − x); the centre is fixed.
      const mid = (d - 1) / 2;
      expect(rotatePoint(d, 1, mid, mid)).toEqual([mid, mid]);
      expect(rotatePoint(d, 1, 0, 0)).toEqual([0, d - 1]);
    }
    expect(VIEWS).toEqual([0, 1]);
  });

  // Along one vertical line of the projection the points of a layer are one
  // unit apart, so layers j apart coincide exactly when j·gap is an integer:
  // on the slider's grid (k + ¼, k + ¾) that first happens at j = 4. Within a
  // layer the projection is injective for any gap.
  const SLIDER_GAPS = [1.25, 1.75, 2.25, 2.75, 3.25, 3.75];

  it("project is injective within a layer, and across layers fewer than four apart, for every slider gap and view (fast-check over d ∈ {3, 5, 7, 9})", () => {
    expect(GAP_STEP).toBe(0.5);
    const grid: number[] = [];
    for (let g = GAP_MIN; g <= GAP_MAX + 1e-9; g += GAP_STEP) grid.push(g);
    expect(grid).toEqual(SLIDER_GAPS);
    for (const g of grid) expect(Number.isInteger(g)).toBe(false);
    fc.assert(
      fc.property(
        fc.constantFrom(3, 5, 7, 9),
        fc.constantFrom(0, 1, 2, 3),
        fc.constantFrom(...SLIDER_GAPS),
        (d, view, gap) => {
          const seen = new Map<string, number>();
          for (let layer = 1; layer <= d + 1; layer++) {
            for (let y = 0; y < d; y++) {
              for (let x = 0; x < d; x++) {
                const [u, v] = project(d, view, gap, layer, x, y);
                const key = `${u},${v}`;
                const other = seen.get(key);
                if (other !== undefined) {
                  expect(
                    layer - other,
                    `${layer}:${x},${y} collides with layer ${other}`,
                  ).toBeGreaterThanOrEqual(4);
                } else {
                  seen.set(key, layer);
                }
              }
            }
          }
          // d = 3 has four layers: never a coincidence.
          if (d === 3) expect(seen.size).toBe(4 * 9);
        },
      ),
    );
  });

  it("an integer gap (the mutant the slider grid avoids) stacks adjacent layers point for point", () => {
    const a = project(5, 0, 1, 2, 0, 0);
    const b = project(5, 0, 1, 1, 1, 1);
    expect(a).toEqual(b);
  });

  it("v grows strictly with the layer and with gap (spreading separates the layers); u does not depend on either", () => {
    for (const view of [0, 1]) {
      const [u1, v1] = project(7, view, 1.5, 1, 2, 3);
      const [u2, v2] = project(7, view, 1.5, 2, 2, 3);
      const [u3, v3] = project(7, view, 2.5, 2, 2, 3);
      expect(u2).toBe(u1);
      expect(u3).toBe(u1);
      expect(v2).toBeGreaterThan(v1);
      expect(v3).toBeGreaterThan(v2);
      expect(v2 - v1).toBe(1.5 * UNIT);
      expect(project(7, view, 4, 1, 2, 3)).toEqual([u1, v1]);
    }
    expect(TILT).toBe(0.5);
    expect(GAP_DEFAULT).toBeGreaterThanOrEqual(GAP_MIN);
    expect(GAP_DEFAULT).toBeLessThanOrEqual(GAP_MAX);
    expect(SLIDER_GAPS).toContain(GAP_DEFAULT);
  });

  it('viewBoxOf contains every projected point with half a unit of margin; d = 7, L = 8, gap = 1.5 → "-264 -40 528 740" without titles (reach 23 + 1 each side), with "Cycle 1" / "Final readout" a gutter of 28 + 7·14·0.57 on the left; the default gap → "-264 -40 528 810"', () => {
    expect(STACK_REACH).toBe(23);
    expect(SIDE_MARGIN).toBe(24);
    expect(viewBoxOf(7, 8, 1.5, [])).toBe("-264 -40 528 740");
    const [x, y, w, h] = viewBoxOf(7, 8, 1.5, ["Cycle 1", "Final readout"])
      .split(" ")
      .map(Number);
    expect(x).toBeCloseTo(-240 - 28 - 7 * 14 * 0.57, 9);
    expect(w).toBeCloseTo(240 + 24 - x!, 9);
    expect([y, h]).toEqual([-40, 740]);
    expect(viewBoxOf(7, 8, GAP_DEFAULT, [])).toBe("-264 -40 528 810");
    for (const d of [3, 5, 7, 9]) {
      for (const gap of [GAP_MIN, GAP_DEFAULT, GAP_MAX]) {
        const layers = d + 1;
        const [x, y, w, h] = viewBoxOf(d, layers, gap, ["Final readout"])
          .split(" ")
          .map(Number);
        const code = rotatedSurfaceCode(d);
        for (const view of [0, 1]) {
          for (let layer = 1; layer <= layers; layer++) {
            const points = [];
            for (let q = 0; q < code.n; q++)
              points.push(qubitPoint3(d, view, gap, layer, q));
            for (const s of code.stabilizers)
              points.push(plaquetteCentre(d, view, gap, layer, s));
            for (const [u, v] of points) {
              expect(u).toBeGreaterThanOrEqual(x! + UNIT / 2);
              expect(u).toBeLessThanOrEqual(x! + w! - UNIT / 2);
              expect(v).toBeGreaterThanOrEqual(y! + UNIT / 4);
              expect(v).toBeLessThanOrEqual(y! + h! - UNIT / 4);
            }
          }
        }
      }
    }
  });

  /**
   * test_intent_layer_titles_never_touch_the_stack
   * INTENCIÓN: un rótulo de capa («Ciclo 3», «Lectura final») nunca tapa un
   * cúbit, una plaqueta ni la punta de una arista de frontera de ninguna capa.
   * CONTEXTO: anclados en la esquina superior de su capa (x = −d·UNIT + 4),
   * los rótulos caían sobre los cúbits de las capas de encima en tres
   * iteraciones y en los fotogramas del vídeo (Chrome, getBBox: 280 solapes
   * en d = 3/5/7/9 × gap 1,75/3,75 × vista 0/1 × en/es).
   * EXPIRA SI: los rótulos salen del SVG (p. ej. a una leyenda HTML) o el
   * tamaño de letra deja de ser TITLE_FONT_SIZE en unidades del viewBox.
   * Cada línea es una caja alineada a la derecha (text-anchor end) en
   * titleLayout: ancho = caracteres · 14 · TITLE_EM, alto ±0,75 em sobre su
   * línea media; un disco «toca» si su centro está a ≤ STACK_REACH (23: la
   * punta de una arista de frontera, 20, más su remate redondo, 3).
   * La cota TITLE_EM = 0,57 debe cubrir la cara fijada: medido en Chrome
   * (out/polish2/em.mjs, peso 600) Space Grotesk llega a 0,550 em por
   * carácter («readout»), el sistema a 0,508; se exige ≥ 3 % de holgura, así
   * que bajar la cota rompe este test y no sólo un literal del viewBox.
   */
  it("test_intent_layer_titles_never_touch_the_stack: every line of every title of both locales clears every disc (with its residual ring), plaquette and boundary-edge tip and every other title, and stays inside the viewBox", () => {
    // The stack itself (Space Grotesk first) is pinned by
    // tests/intent/layer-title-font.test.ts, which reads index.css.
    // SpacetimeSvg sets fontFamily: "var(--font-display)" inline (SpacetimePanel.test.tsx).
    expect(TITLE_EM_MEASURED).toBe(0.55);
    expect(TITLE_EM).toBeGreaterThanOrEqual(TITLE_EM_MEASURED * 1.03);
    expect(TITLE_CLEARANCE).toBeGreaterThan(STACK_REACH);
    const RING = STACK_REACH; // residual ring 17.5, boundary-edge tip with cap 23
    const longest = (d: number) =>
      [en, es].flatMap((loc) => [
        loc.spacetime.finalReadout,
        loc.spacetime.cycle.replace("{{cycle}}", String(d)),
      ]);
    const gaps: number[] = [];
    for (let g = GAP_MIN; g <= GAP_MAX + 1e-9; g += GAP_STEP) gaps.push(g);
    const separated = (a: Point[], b: Point[]) => {
      for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
          const [x1, y1] = poly[i]!;
          const [x2, y2] = poly[(i + 1) % poly.length]!;
          const nx = y2 - y1;
          const ny = x1 - x2;
          const pa = a.map(([x, y]) => x * nx + y * ny);
          const pb = b.map(([x, y]) => x * nx + y * ny);
          if (
            Math.max(...pa) <= Math.min(...pb) ||
            Math.max(...pb) <= Math.min(...pa)
          )
            return true;
        }
      }
      return false;
    };
    let checked = 0;
    const failures: string[] = [];
    for (const d of [3, 5, 7, 9]) {
      const code = rotatedSurfaceCode(d);
      const layers = d + 1;
      const titles = longest(d);
      for (const gap of gaps) {
        const [vx, vy, vw, vh] = viewBoxOf(d, layers, gap, titles)
          .split(" ")
          .map(Number);
        for (const view of VIEWS) {
          // Every disc and plaquette of every layer, computed once.
          const discs: Point[] = [];
          const polygons: Point[][] = [];
          for (let other = 1; other <= layers; other++) {
            for (let q = 0; q < code.n; q++)
              discs.push(qubitPoint3(d, view, gap, other, q));
            for (const s of code.stabilizers)
              polygons.push(
                layerPolygon(d, view, gap, other, s)
                  .split(" ")
                  .map((p) => p.split(",").map(Number) as unknown as Point),
              );
          }
          for (const title of titles) {
            // One box per line per layer; boxes of other layers must not meet.
            const boxes: {
              layer: number;
              box: [number, number, number, number];
            }[] = [];
            for (let layer = 1; layer <= layers; layer++) {
              // SpacetimeSvg draws each line with text-anchor end at x.
              const { x, lines } = titleLayout(d, gap, layer, title);
              for (const [line, ay] of lines) {
                const right = x;
                const left = right - lineWidth(line);
                const top = ay - 0.75 * TITLE_FONT_SIZE;
                const bottom = ay + 0.75 * TITLE_FONT_SIZE;
                boxes.push({ layer, box: [left, top, right, bottom] });
                const box: Point[] = [
                  [left, top],
                  [right, top],
                  [right, bottom],
                  [left, bottom],
                ];
                const where = `d=${d} gap=${gap} view=${view} layer=${layer} "${line}"`;
                if (left < vx! || right > vx! + vw!)
                  failures.push(`${where} outside viewBox`);
                if (top < vy! || bottom > vy! + vh!)
                  failures.push(`${where} outside viewBox`);
                for (const [cx, cy] of discs) {
                  const dx = cx - Math.max(left, Math.min(cx, right));
                  const dy = cy - Math.max(top, Math.min(cy, bottom));
                  if (Math.hypot(dx, dy) <= RING)
                    failures.push(`${where} touches the disc at ${cx},${cy}`);
                }
                for (const poly of polygons)
                  if (!separated(box, poly))
                    failures.push(`${where} touches a plaquette`);
                checked++;
              }
            }
            for (const a of boxes)
              for (const b of boxes)
                if (
                  a.layer < b.layer &&
                  a.box[0] < b.box[2] &&
                  b.box[0] < a.box[2] &&
                  a.box[1] < b.box[3] &&
                  b.box[1] < a.box[3]
                )
                  failures.push(
                    `d=${d} gap=${gap} "${title}": layers ${a.layer} and ${b.layer} overlap`,
                  );
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    // 4 distances, 6 gaps, 2 views, d + 1 layers, 4 titles of which the two
    // final-readout ones wrap to two lines.
    expect(checked).toBe(6 * 2 * 6 * (4 + 6 + 8 + 10));
  });

  /**
   * test_intent_title_gutter_keeps_the_phone_stack_size
   * INTENCIÓN: el margen de los rótulos no encoge la pila en el móvil: a
   * d = 7 y 9, con los rótulos de en y es y cualquier separación, el ancho
   * del viewBox es ≤ 2·d·UNIT / 0,95, el de main más un 5 %; en el
   * móvil el SVG ocupa el ancho de la tarjeta, así que el disco mide ≥ 95 %
   * del de main.
   * CONTEXTO: un margen para
   * «Lectura final» en una línea a 15·0,6 em costaba un 14–17 % del disco
   * (360 px, d = 7: 10,54 → 8,72 px) y la vista del móvil es la que
   * manda. Arreglo: rótulos envueltos por palabras
   * (TITLE_LINE_CHARS), cota medida de la cara fijada y margen derecho
   * ajustado al alcance real (STACK_REACH + 1).
   * EXPIRA SI: el visor deja de ocupar el ancho de la tarjeta en el móvil o
   * los rótulos salen del SVG.
   */
  it("test_intent_title_gutter_keeps_the_phone_stack_size: at d = 7 and 9 the viewBox is at most 5 % wider than main's 2·d·UNIT, in both locales", () => {
    expect(titleLines("Final readout")).toEqual(["Final", "readout"]);
    expect(titleLines("Lectura final")).toEqual(["Lectura", "final"]);
    expect(titleLines("Cycle 10")).toEqual(["Cycle 10"]);
    expect(TITLE_LINE_CHARS).toBe(8);
    for (const d of [7, 9]) {
      for (const loc of [en, es]) {
        const titles = [
          loc.spacetime.cycle.replace("{{cycle}}", String(d)),
          loc.spacetime.finalReadout,
        ];
        for (const gap of [GAP_MIN, GAP_DEFAULT, GAP_MAX]) {
          const w = Number(viewBoxOf(d, d + 1, gap, titles).split(" ")[2]);
          expect(
            (2 * d * UNIT) / w,
            `d=${d} ${titles[1]}`,
          ).toBeGreaterThanOrEqual(0.95);
        }
      }
    }
    expect(titleWidth("Final readout")).toBeCloseTo(lineWidth("readout"), 9);
  });

  it("layerPolygon: four vertices for an interior plaquette, three for a weight-2 one; the two qubits of a boundary plaquette are vertices", () => {
    const code = rotatedSurfaceCode(5);
    for (const s of code.stabilizers) {
      const vertices = layerPolygon(5, 1, 1.5, 3, s).split(" ");
      expect(vertices).toHaveLength(s.boundary === null ? 4 : 3);
      if (s.boundary !== null) {
        for (const q of s.qubits) {
          const [u, v] = qubitPoint3(5, 1, 1.5, 3, q);
          expect(vertices).toContain(`${u},${v}`);
        }
      }
    }
  });

  it("edgeSegment: a time edge joins the same plaquette in consecutive layers; a boundary edge leaves through its qubit", () => {
    const code = rotatedSurfaceCode(3);
    const m = 4;
    // Nodes (layer 2, check 1) and (layer 3, check 1).
    const u = 1 * m + 1;
    const v = 2 * m + 1;
    expect(nodeLayer(m, u)).toBe(2);
    expect(nodeCheck(m, v)).toBe(1);
    const [a, b] = edgeSegment(code, "Z", 0, 1.5, u, v, -1);
    const check = code.stabilizersByType.Z[1]!;
    expect(a).toEqual(plaquetteCentre(3, 0, 1.5, 2, check));
    expect(b).toEqual(plaquetteCentre(3, 0, 1.5, 3, check));
    expect(b[0]).toBe(a[0]);
    expect(b[1] - a[1]).toBe(1.5 * UNIT);
    // Boundary: from the plaquette of check 0 (rows 0–1, cols 0–1) through
    // qubit (0, 0) and half a unit beyond it, in layer 1.
    const q = qubitIndex(3, 0, 0);
    const [from, to] = edgeSegment(code, "Z", 0, 1.5, 0, BOUNDARY, q);
    const centre = plaquetteCentre(3, 0, 1.5, 1, code.stabilizersByType.Z[0]!);
    const through = qubitPoint3(3, 0, 1.5, 1, q);
    expect(from).toEqual(centre);
    const beyond = Math.hypot(to[0] - through[0], to[1] - through[1]);
    expect(beyond).toBeCloseTo(UNIT / 2, 6);
    // Collinear: (to − through) is parallel to (through − centre).
    const cross =
      (to[0] - through[0]) * (through[1] - centre[1]) -
      (to[1] - through[1]) * (through[0] - centre[0]);
    expect(cross).toBeCloseTo(0, 6);
  });
});
