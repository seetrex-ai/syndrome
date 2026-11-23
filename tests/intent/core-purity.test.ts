import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// The first ESLint.lintText loads the flat config (~0.6 s alone) and exceeded the
// default 5 s under concurrent load (observed 2026-10-16: 3 of ~20 full runs).
// A flaky timeout would turn the whole suite red.
vi.setConfig({ testTimeout: 60_000 });

/**
 * test_intent_core_purity
 *
 * INTENCIÓN: `src/core/` es TypeScript puro (docs/spec.md §2, regla dura 2). Debe ejecutarse
 *   igual en navegador, Web Worker y Node, porque los tests, el bench y la validación
 *   contra PyMatching corren en Node y el Worker no tiene DOM.
 * CONTEXTO: tres barreras, cada una comprobada aquí con un control positivo y uno negativo:
 *   1. Frontera de imports (este test, sin depender de ESLint): todo fichero de `src/core`
 *      es `.ts` (ni `.mts`, `.cts`, `.tsx`, `.js` ni `.json`, que escaparían a las otras
 *      barreras); ningún import relativo sale de `src/core`; ningún paquete entra salvo la
 *      lista blanca `CORE_ALLOWED_PACKAGES`; y no hay `import()` dinámico, con ninguna
 *      forma de argumento (el núcleo es síncrono y no carga nada en diferido). Una lista
 *      negra de módulos envejece con el primer fichero nuevo; la lista blanca convierte
 *      cada dependencia del núcleo en una decisión visible en el diff.
 *   2. ESLint (`eslint.config.js`, override sobre `src/core/**`): capa rápida en el editor.
 *   3. `tsconfig.core.json` sin lib DOM: cualquier global del navegador (`window`,
 *      `location`, `HTMLElement`…) es TS2304/TS2584 en el proyecto core aunque la app lo
 *      acepte. Se compila aquí con la API del compilador y un fichero virtual.
 *   Cada barrera tiene su control negativo: se la ve bloquear.
 * EXPIRA SI: el núcleo deja de ejecutarse en Node o en un Worker (p. ej. se abandona la
 *   validación en Node y la simulación masiva pasa al hilo principal).
 */

const ROOT = process.cwd();
const CORE_DIR = join(ROOT, "src", "core");

// Packages src/core may import. Empty on purpose: adding one is a decision
// (docs/decisiones.md), not a convenience.
const CORE_ALLOWED_PACKAGES: readonly string[] = [];

// Test files next to the core (`*.test.ts`) may additionally import the test stack.
const CORE_TEST_PACKAGES: readonly string[] = ["vitest", "fast-check"];

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const allCoreFiles = walk(CORE_DIR);
const coreFiles = allCoreFiles.filter((f) => f.endsWith(".ts"));

interface ImportRef {
  file: string;
  specifier: string;
}

interface Imports {
  refs: ImportRef[];
  dynamicImports: { file: string; line: number }[];
}

export function importsOf(
  file: string,
  text = readFileSync(file, "utf8"),
): Imports {
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
      // Any import(): string, template, variable or computed. None is allowed in the core.
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

function leavesCore(file: string, specifier: string): boolean {
  const target = resolve(dirname(join(ROOT, file)), specifier);
  return !(target === CORE_DIR || target.startsWith(CORE_DIR + sep));
}

export function classify(refs: ImportRef[]): {
  escapes: ImportRef[];
  packages: ImportRef[];
} {
  const escapes = refs.filter(
    (r) => r.specifier.startsWith(".") && leavesCore(r.file, r.specifier),
  );
  const packages = refs.filter(
    (r) =>
      !r.specifier.startsWith(".") &&
      !CORE_ALLOWED_PACKAGES.includes(r.specifier) &&
      !(isTestFile(r.file) && CORE_TEST_PACKAGES.includes(r.specifier)),
  );
  return { escapes, packages };
}

describe("test_intent_core_purity: import boundary", () => {
  it("has at least one core file to check", () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  it("contains only .ts files (no .mts/.cts/.tsx/.js/.json escape the barriers)", () => {
    const others = allCoreFiles
      .filter((f) => !f.endsWith(".ts"))
      .map((f) => relative(ROOT, f));
    expect(others).toEqual([]);
  });

  it("no relative import leaves src/core, no package enters it, no dynamic import()", () => {
    const imports = coreFiles.map((f) => importsOf(f));
    const { escapes, packages } = classify(imports.flatMap((i) => i.refs));
    expect(escapes, "relative imports escaping src/core").toEqual([]);
    expect(
      packages,
      "packages imported by src/core outside the allowlist",
    ).toEqual([]);
    expect(
      imports.flatMap((i) => i.dynamicImports),
      "dynamic import() inside src/core",
    ).toEqual([]);
  });

  it("would catch escapes, packages and every import() form (self-check)", () => {
    const file = join(CORE_DIR, "__virtual__.ts");
    const source = [
      'import a from "../i18n";',
      'export { b } from "../locales";',
      'import c from "./lattice/rotated";',
      'import { useState } from "react";',
      'import { readFileSync } from "node:fs";',
      'export const x = () => import("i18next");',
      "export const y = () => import(`i18next`);",
      'const name = "react"; export const z = () => import(name);',
      "export const all = [a, b, c, useState, readFileSync];",
    ].join("\n");
    const { refs, dynamicImports } = importsOf(file, source);
    const { escapes, packages } = classify(refs);
    expect(escapes.map((r) => r.specifier)).toEqual(["../i18n", "../locales"]);
    expect(packages.map((r) => r.specifier)).toEqual(["react", "node:fs"]);
    expect(dynamicImports.map((d) => d.line)).toEqual([6, 7, 8]);
  });
});

const eslint = new ESLint({ cwd: ROOT });

async function lintErrors(
  source: string,
  filePath = "src/core/__virtual__.ts",
): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => m.ruleId ?? "unknown");
}

describe("test_intent_core_purity: ESLint override", () => {
  it("rejects React imports", async () => {
    expect(
      await lintErrors(
        'import { useState } from "react";\nexport const x = useState;\n',
      ),
    ).toContain("no-restricted-imports");
  });

  it("rejects imports from the UI layer and from i18n", async () => {
    expect(
      await lintErrors(
        'import { App } from "../ui/App";\nexport const x = App;\n',
      ),
    ).toContain("no-restricted-imports");
    expect(
      await lintErrors('import i18n from "../i18n";\nexport const x = i18n;\n'),
    ).toContain("no-restricted-imports");
  });

  it("rejects dynamic import()", async () => {
    expect(
      await lintErrors('export const x = () => import("i18next");\n'),
    ).toContain("no-restricted-syntax");
  });

  it("covers .mts and .cts files too", async () => {
    const source = 'import i18n from "i18next";\nexport const x = i18n;\n';
    expect(await lintErrors(source, "src/core/__virtual__.mts")).toContain(
      "no-restricted-imports",
    );
    expect(await lintErrors(source, "src/core/__virtual__.cts")).toContain(
      "no-restricted-imports",
    );
  });

  it("rejects browser globals, including ones outside a hand-written list", async () => {
    expect(await lintErrors("export const w = window.innerWidth;\n")).toContain(
      "no-restricted-globals",
    );
    expect(await lintErrors("export const h = location.href;\n")).toContain(
      "no-restricted-globals",
    );
    expect(await lintErrors("export const a = () => alert('x');\n")).toContain(
      "no-restricted-globals",
    );
  });

  it("accepts plain TypeScript (positive control)", async () => {
    expect(
      await lintErrors(
        "export const add = (a: number, b: number): number => a + b;\n",
      ),
    ).toEqual([]);
  });
});

// Compiles src/core with tsconfig.core.json plus one virtual file, in process.
function coreDiagnostics(virtualSource: string): string[] {
  const configPath = join(ROOT, "tsconfig.core.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (parsed === undefined)
    throw new Error("tsconfig.core.json could not be parsed");
  const virtualPath = join(CORE_DIR, "__virtual_dom__.ts").replace(/\\/g, "/");
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile;
  const fileExists = host.fileExists;
  host.fileExists = (f) => f === virtualPath || fileExists(f);
  host.readFile = (f) => (f === virtualPath ? virtualSource : readFile(f));
  const program = ts.createProgram(
    [...parsed.fileNames, virtualPath],
    parsed.options,
    host,
  );
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const file = d.file === undefined ? "?" : relative(ROOT, d.file.fileName);
    return `${file}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

describe("test_intent_core_purity: tsconfig.core.json has no DOM lib", () => {
  it("compiles src/core plus a pure virtual file with zero diagnostics (positive control)", () => {
    expect(coreDiagnostics("export const n: number = 1;\n")).toEqual([]);
  });

  it("rejects browser globals and DOM types with TS2304/TS2584", () => {
    const diagnostics = coreDiagnostics(
      "export const href = (): string => location.href;\nexport const el = (): HTMLElement | null => document.body;\n",
    );
    // TS2304 "Cannot find name"; TS2584 is the same error with the "add the dom lib" hint.
    const missingNames = diagnostics.filter((d) => /TS(2304|2584) /.test(d));
    expect(missingNames.length).toBeGreaterThanOrEqual(3);
    expect(missingNames, "every diagnostic is a missing DOM name").toEqual(
      diagnostics,
    );
    expect(diagnostics.some((d) => d.includes("'location'"))).toBe(true);
    expect(diagnostics.some((d) => d.includes("'HTMLElement'"))).toBe(true);
    expect(diagnostics.some((d) => d.includes("'document'"))).toBe(true);
  });
});
