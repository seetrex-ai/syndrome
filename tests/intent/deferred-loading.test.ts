import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * test_intent_chart_and_worker_deferred
 *
 * INTENCIÓN: el cierre transitivo de los imports ESTÁTICOS desde `src/main.tsx` no alcanza
 *   `src/ui/chart/**` ni `src/worker/**`; `ChartPanel` sólo es alcanzable por un `import()`
 *   (tasks/plans/ui.md D6). La rejilla interactiva llega antes que la gráfica y su Worker.
 * CONTEXTO: docs/spec.md §7, < 200 kB de JavaScript comprimido antes de la rejilla. El
 *   presupuesto lo mide `bundle-budget.test.ts` con `vite.build()`; este test dice POR QUÉ
 *   se cumple y señala el fichero exacto que lo rompería (un `import { ChartPanel }`
 *   estático en `App.tsx` pasa el typecheck, el lint y toda la suite de componentes).
 *   Se recorre con la API de TypeScript, como `core-purity`: cada `import`/`export from`
 *   relativo se resuelve a fichero (`.ts`, `.tsx`, `/index.ts`) y se sigue; los `import()`
 *   se recogen aparte y no se siguen.
 * EXPIRA SI: cambia el presupuesto de §7 o la gráfica pasa a ser la primera interacción.
 */

const ROOT = process.cwd();
const ENTRY = join(ROOT, "src", "main.tsx");
const DEFERRED_DIRS = [
  join(ROOT, "src", "ui", "chart"),
  join(ROOT, "src", "worker"),
  join(ROOT, "src", "ui", "spacetime"),
];
const CHART_PANEL = join(ROOT, "src", "ui", "chart", "ChartPanel.tsx");
const SPACETIME_PANEL = join(
  ROOT,
  "src",
  "ui",
  "spacetime",
  "SpacetimePanel.tsx",
);
// The Suspense fallbacks must render BEFORE their chunk arrives, so each is
// the one file of its directory in the initial bundle; they import nothing
// else from chart/ or spacetime/.
const CHART_SKELETON = join(ROOT, "src", "ui", "chart", "ChartSkeleton.tsx");
const SPACETIME_SKELETON = join(
  ROOT,
  "src",
  "ui",
  "spacetime",
  "SpacetimeSkeleton.tsx",
);
const SKELETONS = [CHART_SKELETON, SPACETIME_SKELETON];

function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && /\.(ts|tsx|json|css)$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

interface Edges {
  readonly static: string[];
  readonly dynamic: string[];
}

export function edgesOf(
  file: string,
  text = readFileSync(file, "utf8"),
): Edges {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = { static: [] as string[], dynamic: [] as string[] };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // Type-only imports vanish at build time (verbatimModuleSyntax).
      const typeOnly =
        (ts.isImportDeclaration(node) &&
          node.importClause?.isTypeOnly === true) ||
        (ts.isExportDeclaration(node) && node.isTypeOnly);
      if (!typeOnly) {
        const target = resolveSpecifier(file, node.moduleSpecifier.text);
        if (target !== null) out.static.push(target);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) {
        const target = resolveSpecifier(file, arg.text);
        if (target !== null) out.dynamic.push(target);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Files reachable from `entry` through static imports only; dynamic targets aside. */
export function staticClosure(entry: string): {
  reached: Set<string>;
  dynamicTargets: Set<string>;
} {
  const reached = new Set<string>();
  const dynamicTargets = new Set<string>();
  const queue = [entry];
  // Bounded: every file enters the queue once.
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    if (reached.has(file) || !/\.(ts|tsx)$/.test(file)) continue;
    reached.add(file);
    const edges = edgesOf(file);
    for (const target of edges.static) queue.push(target);
    for (const target of edges.dynamic) dynamicTargets.add(target);
  }
  return { reached, dynamicTargets };
}

const inside = (file: string, dir: string) =>
  file === dir || file.startsWith(dir + sep);

/**
 * test_intent_viewer_deferred (T-I-G2, tasks/plans/phase2-g.md D9) shares this
 * block: `src/ui/spacetime` joins the deferred directories, `SpacetimeSkeleton`
 * is its documented exception and `SpacetimePanel` the second import() of
 * App.tsx. EXPIRA SI: §7 changes the budget or the viewer becomes the first
 * interaction.
 */
describe("test_intent_chart_and_worker_deferred", () => {
  it("the static closure of src/main.tsx reaches the grid but neither src/ui/chart, src/worker nor src/ui/spacetime", () => {
    const { reached } = staticClosure(ENTRY);
    expect(reached.has(join(ROOT, "src", "ui", "App.tsx"))).toBe(true);
    expect(reached.has(join(ROOT, "src", "ui", "grid", "Grid.tsx"))).toBe(true);
    const leaked = [...reached]
      .filter((f) => DEFERRED_DIRS.some((dir) => inside(f, dir)))
      .filter((f) => !SKELETONS.includes(f))
      .map((f) => relative(ROOT, f));
    expect(leaked, "deferred modules reached statically").toEqual([]);
    // The skeletons are the documented exceptions and pull nothing from the
    // deferred directories.
    for (const skeleton of SKELETONS) {
      expect(reached.has(skeleton)).toBe(true);
      const skeletonEdges = edgesOf(skeleton);
      expect(
        skeletonEdges.static.filter((f) =>
          DEFERRED_DIRS.some((dir) => inside(f, dir)),
        ),
      ).toEqual([]);
    }
  });

  it("ChartPanel and SpacetimePanel are each reached by exactly one import(), both from App.tsx", () => {
    const { dynamicTargets } = staticClosure(ENTRY);
    expect([...dynamicTargets].map((f) => relative(ROOT, f)).sort()).toEqual(
      [relative(ROOT, CHART_PANEL), relative(ROOT, SPACETIME_PANEL)].sort(),
    );
    const app = edgesOf(join(ROOT, "src", "ui", "App.tsx"));
    expect([...app.dynamic].sort()).toEqual(
      [CHART_PANEL, SPACETIME_PANEL].sort(),
    );
  });

  it("would catch a static import of ChartPanel or SpacetimePanel in App.tsx (self-check)", () => {
    const app = join(ROOT, "src", "ui", "App.tsx");
    const source = readFileSync(app, "utf8");
    for (const [pattern, replacement, target, other] of [
      [
        /const ChartPanel = lazy\(\(\) => import\("\.\/chart\/ChartPanel"\)\);/,
        'import { ChartPanel } from "./chart/ChartPanel";',
        CHART_PANEL,
        SPACETIME_PANEL,
      ],
      [
        /const SpacetimePanel = lazy\(\(\) => import\("\.\/spacetime\/SpacetimePanel"\)\);/,
        'import { SpacetimePanel } from "./spacetime/SpacetimePanel";',
        SPACETIME_PANEL,
        CHART_PANEL,
      ],
    ] as const) {
      const mutated = source.replace(pattern, replacement);
      expect(mutated).not.toBe(source);
      const edges = edgesOf(app, mutated);
      expect(edges.static).toContain(target);
      expect(edges.dynamic).toEqual([other]);
    }
  });
});
