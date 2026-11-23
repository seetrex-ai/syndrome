import { describe, expect, it } from "vitest";
import { parseRules, selectorsOf, stylesheets, type Rule } from "./css-rules";

/**
 * test_intent_reduced_motion
 *
 * INTENCIÓN: toda transición y animación de la interfaz se anula bajo
 *   `@media (prefers-reduced-motion: reduce)` (tasks/plans/phase2.md D14). En cada hoja de
 *   `src/**` que declare `transition` o `animation`, cada selector que las declara aparece
 *   en un bloque de esa media query de la MISMA hoja con `transition: none` y
 *   `animation: none`, y ese bloque va DESPUÉS de la última regla de la hoja que anima
 *   ese selector (misma especificidad: en la cascada gana la última).
 *   La lista se deriva de la hoja, no se escribe a mano: añadir una transición nueva sin
 *   su contrapartida enrojece.
 * CONTEXTO: las hojas se cargan por panel (la gráfica y el visor, en diferido), así que
 *   un bloque global en index.css no puede nombrar lo que aún no existe sin acoplar
 *   ficheros; cada hoja lleva el suyo. Antes de la PWA había seis transiciones y ninguna
 *   contrapartida; después, mover el bloque `@media` por delante de
 *   `.toast {` seguía en verde mientras la animación corría en el navegador.
 * EXPIRA SI: una librería de animación sustituye al CSS (descartado en ui.md D5) o las
 *   hojas se funden en una sola.
 */

const REDUCED = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/;

const inReduced = (rule: Rule): boolean =>
  rule.ancestors.some((a) => REDUCED.test(a));

const animates = (rule: Rule): boolean =>
  rule.declarations.some(
    (d) =>
      /^(?:transition|animation)(?:-\w+)?$/.test(d.property) &&
      d.value !== "none",
  );

const cancels = (rule: Rule): boolean =>
  rule.declarations.some(
    (d) => d.property === "transition" && d.value === "none",
  ) &&
  rule.declarations.some(
    (d) => d.property === "animation" && d.value === "none",
  );

describe("test_intent_reduced_motion", () => {
  const sheets = stylesheets().map((s) => ({ ...s, rules: parseRules(s.css) }));
  const animated = sheets.filter((s) =>
    s.rules.some((r) => !inReduced(r) && animates(r)),
  );

  it("there are stylesheets with motion to cancel (otherwise this test guards nothing)", () => {
    expect(animated.map((s) => s.file)).toContain("src/ui/grid/grid.css");
  });

  it.each(animated.map((s) => [s.file, s] as const))(
    "%s cancels every animated selector under prefers-reduced-motion: reduce",
    (_file, sheet) => {
      // Rule indices are source order (parseRules walks the sheet once, nested
      // blocks in place): the cascade's order for rules of equal specificity.
      const lastMoving = new Map<string, number>();
      sheet.rules.forEach((rule, index) => {
        if (inReduced(rule) || !animates(rule)) return;
        // A keyframe step is not a selector; its animation is cancelled where it is used.
        if (rule.ancestors.some((a) => a.startsWith("@keyframes"))) return;
        for (const s of selectorsOf(rule.selector)) lastMoving.set(s, index);
      });
      const cancelled = new Map<string, number>();
      sheet.rules.forEach((rule, index) => {
        if (!inReduced(rule) || !cancels(rule)) return;
        for (const s of selectorsOf(rule.selector)) cancelled.set(s, index);
      });
      const uncovered = [...lastMoving.keys()].filter((s) => !cancelled.has(s));
      const tooEarly = [...lastMoving].filter(
        ([s, last]) => cancelled.has(s) && cancelled.get(s)! < last,
      );
      console.info(
        `[reduced-motion] ${sheet.file}: ${lastMoving.size} animated selector(s), ${cancelled.size} cancelled`,
      );
      expect(
        uncovered,
        `${sheet.file} animates without a reduced-motion counterpart: ${uncovered.join(" | ")}`,
      ).toEqual([]);
      expect(
        tooEarly.map(([s]) => s),
        `${sheet.file}: the reduced-motion block comes BEFORE a later rule that animates the selector (the cascade keeps the motion)`,
      ).toEqual([]);
    },
  );
});
