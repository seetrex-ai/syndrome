import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** Where Syndrome could ever emit a Content-Security-Policy. */
const SOURCES = ["edge/_headers", "edge/worker.ts", "index.html"];
const COLLECTOR = "https://cloud.umami.is";

/**
 * Every Content-Security-Policy value written in `text`: a `_headers` line
 * (`  Content-Security-Policy: …`), a header set in code (`"Content-Security-Policy",
 * "…"` or `"Content-Security-Policy": "…"`) or an `http-equiv` meta.
 */
function cspPolicies(text: string): string[] {
  const policies: string[] = [];
  // _headers: the value runs to the end of the line.
  for (const m of text.matchAll(
    /^[ \t]*Content-Security-Policy:[ \t]*(.+)$/gim,
  ))
    policies.push(m[1]!.trim());
  // Code: a double-quoted or template string (the value holds single quotes).
  for (const m of text.matchAll(
    /["'`]Content-Security-Policy["'`]\s*[:,]\s*(["`])([^"`]*)\1/gi,
  ))
    policies.push(m[2]!.trim());
  for (const m of text.matchAll(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]+)"/gi,
  ))
    policies.push(m[1]!.trim());
  return policies;
}

/** What `policy` would block of the analytics; [] when it lets it through. */
function cspProblems(policy: string): string[] {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  // CSP falls back to default-src for a fetch directive that is not set.
  const effective = (name: string): string[] | undefined =>
    directives.get(name) ?? directives.get("default-src");
  const problems: string[] = [];
  const script = effective("script-src");
  if (script !== undefined && !script.includes("'self'")) {
    problems.push(
      `script-src without 'self' (the counter is /syndrome/assets/umami-*.js)`,
    );
  }
  const connect = effective("connect-src");
  if (connect !== undefined && !connect.includes(COLLECTOR)) {
    problems.push(`connect-src without ${COLLECTOR} (the collector)`);
  }
  return problems;
}

/**
 * test_intent_csp_allows_analytics_if_present
 *
 * INTENCIÓN: si algún día Syndrome emite una Content-Security-Policy (en `edge/_headers`,
 *   en el Worker de borde o como `<meta http-equiv>`), no puede apagar la analítica en
 *   silencio: debe permitir `script-src 'self'` (el contador se sirve desde
 *   `/syndrome/assets/`) y `connect-src https://cloud.umami.is` (el colector), contando el
 *   respaldo de `default-src` (tasks/plans/analytics.md D10, T-I9). HOY NO HAY NINGUNA CSP
 *   y la guarda pasa por vacío: lo que se comprueba hoy es sólo que el detector y el
 *   validador funcionan, con los casos fijos de abajo.
 * CONTEXTO: el encargo daba por hecho una CSP generada en el build; no existe (grep del
 *   árbol, 2026-10-19). Crearla exige decidir el hash del script inline del tema de
 *   `index.html` y es otra tarea; el riesgo es que esa tarea olvide el colector y el panel
 *   de Umami se quede a cero sin ningún error visible (el contador traga los fallos).
 * EXPIRA SI: la analítica deja de usar Umami Cloud o el contador deja de servirse desde la
 *   propia app.
 */
describe("test_intent_csp_allows_analytics_if_present", () => {
  it("every CSP Syndrome emits (none today) lets the counter and the collector through", () => {
    const found: string[] = [];
    for (const source of SOURCES) {
      for (const policy of cspPolicies(
        readFileSync(join(ROOT, source), "utf8"),
      )) {
        found.push(source);
        expect(cspProblems(policy), `${source}: ${policy}`).toEqual([]);
      }
    }
    // Vacuous today, and said so: if a CSP appears, this line changes with it.
    expect(found).toEqual([]);
  });

  it("the detector finds a CSP in each shape it may be written in", () => {
    expect(
      cspPolicies(
        "/syndrome/*\n  Content-Security-Policy: default-src 'self'\n",
      ),
    ).toEqual(["default-src 'self'"]);
    expect(
      cspPolicies(
        `headers.set("Content-Security-Policy", "script-src 'self'");`,
      ),
    ).toEqual(["script-src 'self'"]);
    expect(
      cspPolicies(
        `<meta http-equiv="Content-Security-Policy" content="connect-src 'self'" />`,
      ),
    ).toEqual(["connect-src 'self'"]);
  });

  it("fixture: a CSP without the collector in connect-src fails; one with it passes", () => {
    expect(cspProblems("default-src 'self'")).toHaveLength(1);
    expect(cspProblems("script-src 'self'; connect-src 'self'")).toEqual([
      `connect-src without ${COLLECTOR} (the collector)`,
    ]);
    expect(cspProblems("script-src 'none'; connect-src " + COLLECTOR)).toEqual([
      `script-src without 'self' (the counter is /syndrome/assets/umami-*.js)`,
    ]);
    expect(
      cspProblems(`default-src 'self'; connect-src 'self' ${COLLECTOR}`),
    ).toEqual([]);
    expect(cspProblems("img-src 'self'")).toEqual([]);
  });
});
