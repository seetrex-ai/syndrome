import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createRng, rotatedSurfaceCode } from "../../src/core";
import { randomHistory } from "../../src/ui/model/spacetime-trace";
import {
  decodeHistory,
  encodeHistory,
  historyBits,
  historyMaskLength,
} from "../../src/ui/spacetime/link";
import { walk } from "./ui-sources";

// The module spy of test_intent_viewer_link_is_history_not_seed: every
// `createRng` call of the core, wherever it comes from, is counted.
vi.mock("../../src/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/core")>();
  return { ...mod, createRng: vi.fn(mod.createRng) };
});

const ROOT = process.cwd();

/**
 * test_intent_viewer_physics_comes_from_core
 *
 * INTENCIÓN: el visor dibuja lo que el núcleo calcula y nunca recalcula física
 *   (docs/spec.md §2 regla dura 2 y «la UI nunca ajusta un número»; tasks/plans/phase2-g.md
 *   D1, D3). Barrera por LISTA BLANCA, por declaración y no por nombre: todo import de valor desde
 *   `src/core` en `src/ui/spacetime/**` y `src/ui/model/spacetime-trace.ts` tiene que ser
 *   uno de los enumerados (geometría, construcción de contexto e historia, los ladrillos
 *   `readingsOf` / `decodeSpacetimeHistory` / `spacetimeChains`, copias y constantes);
 *   `computeTypeSyndrome`, `multiplyInto`, `commutes`, `decodeSpacetime`,
 *   `xorSpacetimePathInto` y cualquier otra función que compute física quedan fuera, y
 *   ningún import entra por una ruta profunda de `src/core/…` (sólo el índice).
 * CONTEXTO: el núcleo fenomenológico dejó `detectorsOf` y `sampleCycleNoise` públicos; con ellos la UI
 *   podría repetir el bucle de la tirada y calcular `s_r` fuera del núcleo, sin test de
 *   identidad con la tirada en el sitio donde vive (D1). Esta lista hace visible en el
 *   diff cualquier nueva dependencia del visor sobre el núcleo.
 * EXPIRA SI: nunca (un nombre nuevo entra en la lista con su motivo).
 */
const VIEWER_FILES = [
  ...walk(join(ROOT, "src", "ui", "spacetime")),
  join(ROOT, "src", "ui", "model", "spacetime-trace.ts"),
].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

const ALLOWED_CORE_VALUES: readonly string[] = [
  // Geometry and indices.
  "rotatedSurfaceCode",
  "qubitRowCol",
  "qubitIndex",
  "BOUNDARY",
  "DISTANCES",
  // Context, noise and PRNG for the history (never for a link).
  "createSpacetimeShotContext",
  "phenomenologicalNoise",
  "createRng",
  // The history and its decoding, the core's own bricks (D1, D2).
  "createSpacetimeHistory",
  "sampleSpacetimeHistory",
  "cumulativeErrorsOf",
  "readingsOf",
  "decodeSpacetimeHistory",
  "spacetimeChains",
  // Copies and constants.
  "copyPauli",
  "identity",
  "pauliFrom",
  "LOGICAL_X",
  "LOGICAL_Z",
];

interface CoreImport {
  readonly file: string;
  readonly specifier: string;
  readonly name: string;
}

/** Every VALUE imported from a `core` module by `file` (type-only imports vanish at build time). */
export function coreValueImports(file: string, text: string): CoreImport[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: CoreImport[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!/(^|\/)core(\/|$)/.test(specifier)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) {
      out.push({ file, specifier, name: clause.name.text });
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      out.push({ file, specifier, name: `* as ${bindings.name.text}` });
    } else {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        out.push({
          file,
          specifier,
          name: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
  return out;
}

describe("test_intent_viewer_physics_comes_from_core", () => {
  it("inspects the viewer's files", () => {
    expect(VIEWER_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it("every value imported from the core by the viewer is on the whitelist, through the index only", () => {
    const offenders: string[] = [];
    for (const file of VIEWER_FILES) {
      for (const imp of coreValueImports(file, readFileSync(file, "utf8"))) {
        const deep = !/\/core$/.test(imp.specifier);
        if (deep || !ALLOWED_CORE_VALUES.includes(imp.name)) {
          offenders.push(
            `${relative(ROOT, imp.file)}: ${imp.name} from ${imp.specifier}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("would report computeTypeSyndrome, a namespace import, a default import and a deep path (self-check)", () => {
    const fixture = [
      'import { computeTypeSyndrome, rotatedSurfaceCode, type Pauli } from "../../core";',
      'import * as core from "../../core";',
      'import { decodeSpacetime } from "../../core/decoder/spacetime";',
      'import type { Distance } from "../../core";',
      'import { identity as id } from "../../core";',
    ].join("\n");
    const imports = coreValueImports("fixture.ts", fixture);
    expect(imports.map((i) => i.name)).toEqual([
      "computeTypeSyndrome",
      "rotatedSurfaceCode",
      "* as core",
      "decodeSpacetime",
      "identity",
    ]);
    const reported = imports.filter(
      (i) =>
        !/\/core$/.test(i.specifier) || !ALLOWED_CORE_VALUES.includes(i.name),
    );
    expect(reported.map((i) => i.name)).toEqual([
      "computeTypeSyndrome",
      "* as core",
      "decodeSpacetime",
    ]);
  });
});

/**
 * test_intent_viewer_link_is_history_not_seed
 *
 * INTENCIÓN: el enlace del visor (`#v=f<d>.<máscara>`) lleva la historia entera de la
 *   tirada, nunca una semilla: `decodeHistory(encodeHistory(h))` no invoca `createRng`
 *   (espía por módulo) y la máscara tiene exactamente ⌈d·(2n + 2m)/6⌉ caracteres
 *   (13 / 62 / 171 / 363), lo que no cabe en ninguna semilla.
 * CONTEXTO: docs/spec.md §4.6 y decisiones 2026-10-16: cambiar el PRNG rompería los
 *   enlaces compartidos; el reto ya lo pinza para su máscara 2D
 *   (test_intent_challenge_link_is_mask_not_seed); el visor lo repite para la 3D
 *   (tasks/plans/phase2-g.md D8). Mutante: un `encodeHistory` que escriba una semilla
 *   (longitud distinta, `createRng` al decodificar) → rojo.
 * EXPIRA SI: §4.6 cambia.
 */
describe("test_intent_viewer_link_is_history_not_seed", () => {
  it("encodes and decodes without touching the PRNG, with exactly ceil(d·(2n + 2m)/6) mask characters", () => {
    const rng = vi.mocked(createRng);
    for (const d of [3, 5, 7, 9] as const) {
      const n = d * d;
      const m = (n - 1) / 2;
      expect(historyBits(d)).toBe(d * (2 * n + 2 * m));
      for (let i = 0; i < 20; i++) {
        const history = randomHistory(d, 0.05, 100 * d + i); // uses createRng: on purpose, before the count
        rng.mockClear();
        const text = encodeHistory(d, history);
        const [head, mask, ...rest] = text.split(".");
        expect(head).toBe(`f${d}`);
        expect(rest).toEqual([]);
        expect(mask!.length).toBe(historyMaskLength(d));
        const back = decodeHistory(text);
        expect(back).not.toBeNull();
        expect(rng).not.toHaveBeenCalled();
        expect(back!.history.cycles).toBe(d);
        expect(rotatedSurfaceCode(d).n).toBe(n);
      }
    }
    expect([3, 5, 7, 9].map(historyMaskLength)).toEqual([13, 62, 171, 363]);
  });
});

/**
 * test_intent_viewer_no_horizontal_scroll
 *
 * INTENCIÓN: a 360 px el visor nunca desborda en horizontal (docs/spec.md §4 fase 2 punto 8,
 *   tasks/plans/phase2-g.md D11): el SVG escala con `width: 100%` y `height: auto`, y
 *   ningún `width` / `min-width` en píxeles aparece en `spacetime.css`; el `<svg>` no lleva
 *   atributos `width` / `height` (sólo `viewBox`), así que una pila alta crece hacia abajo
 *   con la página y nunca hacia los lados. `touch-action: none` ya lo prohíbe
 *   `test_intent_gesture_never_blocks_scroll` en todo CSS de la UI.
 * CONTEXTO: M5 del plan: 1 112 elementos en d = 7 y un alto de 433–843 px a 360 px; en
 *   el navegador se mide `scrollWidth === 360`, este test fija la forma que lo permite.
 * EXPIRA SI: el visor pasa a un lienzo con desplazamiento propio.
 */
describe("test_intent_viewer_no_horizontal_scroll", () => {
  const css = readFileSync(
    join(ROOT, "src", "ui", "spacetime", "spacetime.css"),
    "utf8",
  );
  const svg = readFileSync(
    join(ROOT, "src", "ui", "spacetime", "SpacetimeSvg.tsx"),
    "utf8",
  );

  it("spacetime.css sizes the SVG by percentage, never by a pixel width", () => {
    expect(css).toMatch(/\.spacetime__svg\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.spacetime__svg\s*\{[^}]*height:\s*auto/);
    // Media queries (`@media (min-width: 640px)`) are not sizes of the SVG.
    const declarations = css.replace(/@media[^{]*\{/g, "");
    expect(declarations).not.toMatch(/(^|[^-])(min-)?width:\s*\d+px/);
    expect(css).toMatch(/touch-action:\s*pan-x pan-y pinch-zoom/);
  });

  it("the <svg> carries a viewBox and no width or height attribute", () => {
    const open = /<svg[\s\S]*?>/.exec(svg)?.[0] ?? "";
    expect(open).toContain("viewBox=");
    expect(open).not.toMatch(/\swidth=/);
    expect(open).not.toMatch(/\sheight=/);
  });
});
