import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// The first ESLint.lintText loads the flat config (~0.6 s) and the suite runs
// files concurrently: same margin as core-purity.test.ts.
vi.setConfig({ testTimeout: 60_000 });

/**
 * test_intent_worker_imports_only_core
 *
 * INTENCIÓN: `src/worker/**` sólo importa de `src/core` y de `src/worker`, y ningún
 *   paquete (lista blanca vacía, como `core-purity`); y ESLint lo bloquea en el editor.
 * CONTEXTO: el Worker no tiene DOM ni React (tasks/plans/ui.md D3): un import de `ui/`
 *   o de `react` desde `simulate.ts` no falla en los tests de Node (jsdom y React cargan
 *   igual) y rompería el Worker en silencio hasta el build o, peor, en producción con
 *   un `document is not defined` dentro del hilo de simulación. Dos barreras, cada una
 *   vista bloquear con un control positivo (todo prohibido salvo lista blanca):
 *   1. Frontera de imports con la API de TypeScript: todo fichero es `.ts`; ningún
 *      import relativo sale de `src/core` ∪ `src/worker`; ningún paquete entra (los
 *      `*.test.ts` pueden importar `vitest`); sin `import()` dinámico.
 *   2. ESLint (`eslint.config.js`, override sobre `src/worker/**`): mismas prohibiciones
 *      que el núcleo salvo la carpeta del propio Worker; el único global del navegador admitido es
 *      `self` (el pegamento `sim.worker.ts`).
 * EXPIRA SI: la simulación masiva vuelve al hilo principal (no habría Worker que
 *   proteger) o el Worker pasa a necesitar una dependencia, que entraría en la lista
 *   blanca con su línea en `docs/decisiones.md`.
 */

const ROOT = process.cwd();
const CORE_DIR = join(ROOT, "src", "core");
const WORKER_DIR = join(ROOT, "src", "worker");

const WORKER_ALLOWED_PACKAGES: readonly string[] = [];
const WORKER_TEST_PACKAGES: readonly string[] = ["vitest"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

interface ImportRef {
  file: string;
  specifier: string;
}

interface Imports {
  refs: ImportRef[];
  dynamicImports: { file: string; line: number }[];
}

function importsOf(file: string, text = readFileSync(file, "utf8")): Imports {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = relative(ROOT, file);
  const out: Imports = { refs: [], dynamicImports: [] };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.refs.push({ file: rel, specifier: node.moduleSpecifier.text });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      out.dynamicImports.push({ file: rel, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function inside(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + sep);
}

function classify(refs: ImportRef[]): {
  escapes: ImportRef[];
  packages: ImportRef[];
} {
  const escapes = refs.filter((r) => {
    if (!r.specifier.startsWith(".")) return false;
    const target = resolve(dirname(join(ROOT, r.file)), r.specifier);
    return !inside(target, CORE_DIR) && !inside(target, WORKER_DIR);
  });
  const packages = refs.filter(
    (r) =>
      !r.specifier.startsWith(".") &&
      !WORKER_ALLOWED_PACKAGES.includes(r.specifier) &&
      !(
        r.file.endsWith(".test.ts") &&
        WORKER_TEST_PACKAGES.includes(r.specifier)
      ),
  );
  return { escapes, packages };
}

const allWorkerFiles = walk(WORKER_DIR);
const workerFiles = allWorkerFiles.filter((f) => f.endsWith(".ts"));

describe("test_intent_worker_imports_only_core: import boundary", () => {
  it("has the protocol, the loop and the glue to check", () => {
    const names = workerFiles.map((f) => relative(WORKER_DIR, f)).sort();
    expect(names).toEqual(
      expect.arrayContaining(["protocol.ts", "sim.worker.ts", "simulate.ts"]),
    );
  });

  it("contains only .ts files", () => {
    expect(
      allWorkerFiles
        .filter((f) => !f.endsWith(".ts"))
        .map((f) => relative(ROOT, f)),
    ).toEqual([]);
  });

  it("no relative import leaves src/core ∪ src/worker, no package enters, no import()", () => {
    const imports = workerFiles.map((f) => importsOf(f));
    const { escapes, packages } = classify(imports.flatMap((i) => i.refs));
    expect(
      escapes,
      "relative imports escaping src/core and src/worker",
    ).toEqual([]);
    expect(packages, "packages imported by src/worker").toEqual([]);
    expect(imports.flatMap((i) => i.dynamicImports)).toEqual([]);
  });

  it("would catch an import of ui/, i18n, react or import() (self-check)", () => {
    const file = join(WORKER_DIR, "__virtual__.ts");
    const source = [
      'import { App } from "../ui/App";',
      'import i18n from "../i18n";',
      'import { step } from "../core/index";',
      'import { protocol } from "./protocol";',
      'import { useState } from "react";',
      'export const x = () => import("./simulate");',
      "export const all = [App, i18n, step, protocol, useState, x];",
    ].join("\n");
    const { refs, dynamicImports } = importsOf(file, source);
    const { escapes, packages } = classify(refs);
    expect(escapes.map((r) => r.specifier)).toEqual(["../ui/App", "../i18n"]);
    expect(packages.map((r) => r.specifier)).toEqual(["react"]);
    expect(dynamicImports.map((d) => d.line)).toEqual([6]);
  });
});

const eslint = new ESLint({ cwd: ROOT });

async function lintErrors(
  source: string,
  filePath = "src/worker/__virtual__.ts",
): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? "unknown");
}

describe("test_intent_worker_imports_only_core: ESLint override", () => {
  it("rejects react, the UI layer, i18n and import()", async () => {
    expect(
      await lintErrors(
        'import { useState } from "react";\nexport const x = useState;\n',
      ),
    ).toContain("no-restricted-imports");
    expect(
      await lintErrors(
        'import { App } from "../ui/App";\nexport const x = App;\n',
      ),
    ).toContain("no-restricted-imports");
    expect(
      await lintErrors('import i18n from "../i18n";\nexport const x = i18n;\n'),
    ).toContain("no-restricted-imports");
    expect(
      await lintErrors('export const x = () => import("./simulate");\n'),
    ).toContain("no-restricted-syntax");
  });

  it("rejects DOM globals but accepts self (the Worker scope)", async () => {
    expect(await lintErrors("export const w = window.innerWidth;\n")).toContain(
      "no-restricted-globals",
    );
    expect(await lintErrors("export const t = document.title;\n")).toContain(
      "no-restricted-globals",
    );
    expect(await lintErrors("export const s = self;\n")).toEqual([]);
  });

  it("accepts imports from src/core and src/worker (positive control)", async () => {
    expect(
      await lintErrors(
        'import { step } from "../core/index";\nimport { FIRST_BATCH } from "./simulate";\nexport const x = [step, FIRST_BATCH];\n',
      ),
    ).toEqual([]);
  });
});
