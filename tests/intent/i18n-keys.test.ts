import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { uiSourceFiles } from "./ui-sources";

/**
 * test_intent_i18n_keys
 *
 * INTENCIÓN: toda clave que la interfaz pide a i18n existe en `en.json`, así que lo que
 *   `t()` devuelve es siempre una traducción y nunca la clave ni un texto de reserva
 *   escrito en el componente (docs/spec.md §2, regla dura 1).
 * CONTEXTO: `i18n-literal-text.test.ts` exime los argumentos de `t()` porque son claves;
 *   sin este test, `t("Long press for a Z error")` pasaba el detector y se veía en inglés
 *   en todos los idiomas, y `t("grid.hint", { defaultValue: "Hello" })` escondía una
 *   clave inexistente tras un texto de reserva. i18next no falla en desarrollo por una clave ausente: devuelve la
 *   clave. Regla, por inversión (lista blanca, no lista negra): en todo `.ts`/`.tsx` de `src/ui/**` (salvo tests)
 *   cada llamada `t(...)` / `i18n.t(...)` y cada `i18nKey` de `<Trans>` lleva una clave
 *   comprobable estáticamente y ésta existe como hoja de `en.json`:
 *     - un literal `"a.b"` (o plantilla sin huecos), o una ternaria de ellos;
 *     - una plantilla `` `prefijo.${x}` `` con un solo hueco al final, cuyo prefijo es una
 *       rama (objeto) de `en.json`: la clave real la decide el dato, la rama la fija el
 *       código;
 *     - los sufijos de plural (`_one`, `_other`, `_many`…) cuentan como la clave base:
 *       `t("app.shots", { count })` existe si existe `app.shots_other`;
 *     - cualquier otra forma (variable, llamada, sin argumento) se reporta: no se puede
 *       comprobar y una clave que no se puede comprobar es una clave que puede faltar;
 *     - `defaultValue` en las opciones de `t()` se reporta siempre: una traducción
 *       de reserva escrita en el componente es texto fuera de i18n.
 *   Que los demás idiomas tengan las mismas claves que `en.json` lo garantiza
 *   `i18n-locales.test.ts`; aquí sólo hace falta el inglés.
 * EXPIRA SI: las traducciones pasan a cargarse de un servicio externo (las claves no
 *   estarían en el repo) o `t` deja de ser la única vía de traducción.
 */

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

type Tree = { [key: string]: string | Tree };

export interface KeyIndex {
  readonly leaves: ReadonlySet<string>;
  readonly branches: ReadonlySet<string>;
}

export function indexKeys(tree: Tree, prefix = ""): KeyIndex {
  const leaves = new Set<string>();
  const branches = new Set<string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      leaves.add(path);
    } else {
      branches.add(path);
      const inner = indexKeys(value, path);
      for (const leaf of inner.leaves) leaves.add(leaf);
      for (const branch of inner.branches) branches.add(branch);
    }
  }
  return { leaves, branches };
}

function leafExists(index: KeyIndex, key: string): boolean {
  return (
    index.leaves.has(key) ||
    PLURAL_SUFFIXES.some((suffix) => index.leaves.has(`${key}_${suffix}`))
  );
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

function isTranslationCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === "t") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "t")
  );
}

// Why a key expression is not acceptable, or undefined when it is.
function checkKey(index: KeyIndex, node: ts.Expression): string | undefined {
  if (ts.isParenthesizedExpression(node))
    return checkKey(index, node.expression);
  if (ts.isConditionalExpression(node)) {
    return checkKey(index, node.whenTrue) ?? checkKey(index, node.whenFalse);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return leafExists(index, node.text)
      ? undefined
      : `key "${node.text}" is not in en.json`;
  }
  if (ts.isTemplateExpression(node)) {
    const head = node.head.text;
    const [span] = node.templateSpans;
    const prefix = head.endsWith(".") ? head.slice(0, -1) : undefined;
    if (
      node.templateSpans.length !== 1 ||
      span === undefined ||
      span.literal.text !== "" ||
      prefix === undefined
    ) {
      return `template key ${node.getText()} must be \`<branch>.\${x}\``;
    }
    return index.branches.has(prefix)
      ? undefined
      : `branch "${prefix}" of ${node.getText()} is not in en.json`;
  }
  return `key ${node.getText()} cannot be checked statically`;
}

function defaultValueProperty(
  options: ts.Expression | undefined,
): ts.Node | undefined {
  if (options === undefined || !ts.isObjectLiteralExpression(options))
    return undefined;
  return options.properties.find(
    (property) =>
      property.name !== undefined &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text.startsWith("defaultValue"),
  );
}

export function findKeyViolations(file: string, index: KeyIndex): Violation[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    violations.push({
      file: relative(process.cwd(), file),
      line: line + 1,
      text,
    });
  };
  const visit = (node: ts.Node) => {
    if (isTranslationCall(node)) {
      const [key, options] = node.arguments;
      if (key === undefined) report(node, "t() without a key");
      else {
        const problem = checkKey(index, key);
        if (problem !== undefined) report(key, problem);
      }
      const fallback = defaultValueProperty(options);
      if (fallback !== undefined)
        report(fallback, "defaultValue in t() hides a missing key");
    } else if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "i18nKey"
    ) {
      const init = node.initializer;
      const expression =
        init === undefined
          ? undefined
          : ts.isJsxExpression(init)
            ? init.expression
            : init;
      if (expression === undefined) report(node, "i18nKey without a value");
      else {
        const problem = checkKey(index, expression);
        if (problem !== undefined) report(expression, problem);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

const ENGLISH = indexKeys(
  JSON.parse(
    readFileSync(join(process.cwd(), "src", "locales", "en.json"), "utf8"),
  ) as Tree,
);

describe("test_intent_i18n_keys", () => {
  const files = uiSourceFiles();

  it("finds at least one component to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every t() key and i18nKey in src/ui exists in en.json, with no defaultValue", () => {
    const violations = files.flatMap((file) =>
      findKeyViolations(file, ENGLISH),
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("reports every key shape it claims to report and accepts the rest (self-check)", () => {
    const index = indexKeys({
      app: { shots_one: "{{count}} shot", shots_other: "{{count}} shots" },
      grid: { title: "Surface code", hint: "Tap" },
      language: { en: "English", es: "Español" },
    });
    expect([...index.branches].sort()).toEqual(["app", "grid", "language"]);
    const found = findKeyViolations(
      join(process.cwd(), "tests", "intent", "fixtures", "i18n-keys.tsx"),
      index,
    ).map((v) => `${v.line}: ${v.text}`);
    expect(found).toEqual([
      '34: key "Long press for a Z error" is not in en.json',
      '35: key "grid.nope" is not in en.json',
      "36: defaultValue in t() hides a missing key",
      '37: branch "nope" of `nope.${lang}` is not in en.json',
      "38: template key `grid.${lang}.title` must be `<branch>.${x}`",
      "39: key dynamicKey cannot be checked statically",
      "40: t() without a key",
      '41: key "grid" is not in en.json',
      '42: key "grid.nope" is not in en.json',
      '43: key "grid.missing" is not in en.json',
      "44: key dynamicKey cannot be checked statically",
      "45: i18nKey without a value",
    ]);
  });
});
