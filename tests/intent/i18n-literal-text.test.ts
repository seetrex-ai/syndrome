import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isUiSource, uiSourceFiles } from "./ui-sources";

/**
 * test_intent_i18n_literal_text
 *
 * INTENCIÓN: toda cadena visible de la interfaz pasa por i18n (docs/spec.md §2, regla dura 1).
 *   Texto escrito a mano en un componente es un bug aunque sea «temporal».
 * CONTEXTO: inglés por defecto y español desde el día 1; añadir un idioma debe ser añadir
 *   un fichero, lo que sólo es cierto si ningún componente lleva texto propio. Un detector
 *   que sólo mira «posiciones visibles» se salta la constante o la prop (`const BYLINE =
 *   "…"`, `<Note text="…" />`), así que la regla está invertida: en todo `.ts`/`.tsx` de
 *   `src/ui/**` (salvo `*.test.*`) TODO literal con letras (texto JSX, cadena, plantilla,
 *   en ternarias, concatenaciones o cuerpos de callbacks como `.map`) es una violación
 *   salvo en una posición que se sabe no visible:
 *     - argumentos de `t()` / `i18n.t()` (claves y opciones; que la clave exista lo
 *       comprueba `i18n-keys.test.ts`);
 *     - valor de un atributo de elemento nativo que no esté en `VISIBLE_ATTRIBUTES`
 *       (`className`, `key`, `type`…; `children` y `dangerouslySetInnerHTML` sí lo están);
 *       `value`/`defaultValue` son visibles en `<input>` y `<textarea>` salvo con `type`
 *       literal en `NON_TEXT_INPUT_TYPES` (`hidden`, `checkbox`…), y un `type` dinámico
 *       puede ser `submit`, así que cuenta como visible; en `<button>` (su rótulo son sus
 *       hijos), `<option>` y demás son datos; en componentes propios, cualquier prop
 *       salvo `NON_VISIBLE_PROPS` (sólo las de fontanería de React y del DOM que se pasan
 *       tal cual: `key`, `ref`, `className`, `id`, `htmlFor`, `role`, `lang`, `dir`,
 *       `href`, `src`, `rel`, `target`, `data-*`, `aria-hidden`, y la `i18nKey` de
 *       `<Trans>`), porque una prop con texto suele acabar en pantalla: `value`, `name`,
 *       `variant`, `size`, `color` o `as` con letras se reportan, y si un componente
 *       propio llega a necesitarlas como datos se añaden aquí con su motivo. El
 *       atributo sólo decide si el literal se le entrega directamente: lo que escribe un
 *       callback (`ref={(el) => { el.title = "…"; }}`, `onClick` con `document.title =
 *       "…"`) se revisa como cualquier otro literal, porque el nombre del atributo no
 *       dice dónde acaba;
 *     - operandos de comparación (`lang === "es"`), etiquetas de `case`, claves de acceso
 *       (`obj["k"]`) y nombres de propiedad computados;
 *     - posiciones de tipo (`type X = "a" | "b"`), especificadores de módulo de
 *       `import` / `export` estáticos y de `import()` (cadena o plantilla);
 *     - argumentos directos (o dentro de un objeto/array argumento, sin cruzar una
 *       función) de una llamada o `new` cuyo callee está en `EXEMPT_CALLEES`, una lista
 *       blanca corta con el motivo de cada entrada (`toLocaleString(lang, { style:
 *       "percent" })`, `new Intl.NumberFormat(lang, …)`, `addEventListener("pointerup",
 *       …)`, `new RangeError("…")`, `classList.add("…")`; en `getAttribute`,
 *       `setAttribute` y `localStorage.*Item` sólo el primer argumento, la clave). El
 *       argumento de cualquier otra llamada se reporta: `String("…")`, `useState("…")`,
 *       `setLabel("…")`, `[x].concat("…")`, `fmt("…")` (la
 *       exención por forma «es argumento de una llamada» dejaba pasar todos
 *       ellos; lista blanca, nunca enumeración de lo malo).
 *       La entrada se identifica por **declaración**, no por nombre: el símbolo del
 *       callee (o del constructor en `new`) tiene que estar declarado en un `lib.*.d.ts`
 *       del propio TypeScript (`isSourceFileDefaultLibrary`); un `toBlob`, `getContext`
 *       o `Blob2.File` propios se reportan aunque se llamen igual (misma
 *       familia que `TAG_TYPES`), y la restricción de índice
 *       la fija el fixture (`getContext("2d", { alpha: "…" })`, `toBlob(cb, "image/png",
 *       "…")`, `createElement("p", { is: "…" })` se reportan). Un símbolo con
 *       una declaración propia junto a la de lib (unión, `declare global`) no se exime
 *       (`every`). No hay lista de funciones propias exentas;
 *     - etiquetas: un literal cuyo tipo declarado resuelve a un alias de `TAG_TYPES`
 *       (`Layer`, `Step`, `PauliName`, `StabilizerType`, `GridAction["type"]`,
 *       `StepAction["type"]`, `ExplainId`, cada entrada con su motivo), identificado por **el fichero
 *       que lo declara y su nombre**, comparando la declaración en el `Program`, no el
 *       nombre: un `type Step = "Click to continue" | …` local de otro fichero no es
 *       `Step` (por nombre, cualquier alias homónimo eximía).
 *       Formas: `layers.has("errors")`, `dispatch({ type: "toggleX" })`, `new
 *       Set<Layer>([…])`, `useState<Layer>("errors")` y su setter, un `readonly
 *       Layer[]`, una prop, variable, retorno o asignación tipados `Layer`, y una unión
 *       en línea cuyos miembros son todos alias listados (`Layer | StabilizerType`).
 *       El literal tiene que ser además un valor del alias: bajo `@ts-expect-error`,
 *       `const a: Layer = "A20 Hello"` se reporta. Cualquier otra unión de literales,
 *       con nombre o sin él, se reporta (`label: "Save" | "Cancel"`, `Record<string,
 *       "…">`, retorno anotado, tupla…: que el compilador restrinja un valor no dice si
 *       se pinta; decisión del 2026-10-17, tras dos huecos medidos en el
 *       detector), y un parámetro cuyo tipo declarado es un parámetro de tipo de
 *       la firma (`id("…")`, `useDeferredValue("…")`, `Object.freeze({…})`,
 *       `same(layer, "errors")`) nunca exime: el tipo se instancia desde los argumentos,
 *       no se declara; sólo cuenta un argumento de tipo explícito (`same<Layer>(…)`).
 *       `as` / `satisfies` fabrican el tipo desde el propio literal y no cuentan.
 *       Límite documentado: un alias nuevo se añade a la lista a mano, y un valor de un
 *       alias listado que se pinte (`<p>{layer}</p>`) no se ve.
 *   Las entidades HTML (`&middot;`) no cuentan como letras.
 *   Una constante de presentación con letras (`const cls = "grid
 *   grid--wide"`, `"#e11d48"`) se reporta aunque no sea texto; se exime a propósito con
 *   un comentario `i18n-exempt: <motivo>` en su línea o en la anterior (decisión del
 *   2026-10-16: escotilla explícita y visible en el diff, no un plugin ni una
 *   convención implícita). Un marcador sin motivo no exime. El fixture demuestra cada
 *   forma detectada y cada exención.
 * EXPIRA SI: la interfaz se genera desde otra capa que no sea `src/ui` (actualizar la
 *   ruta) o el proyecto pasa a un único idioma (no previsto).
 */

// Attributes of native elements whose value the user sees or hears.
const VISIBLE_ATTRIBUTES = new Set([
  "title",
  "alt",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "aria-braillelabel",
  "download", // the file name the browser offers to save
  "children",
  "dangerouslySetInnerHTML",
]);

// `value` / `defaultValue` are text on these elements (a text box's default, a
// submit button's caption) unless `type` is literally one of NON_TEXT_INPUT_TYPES;
// a dynamic `type={…}` may be "submit", so it counts as visible. On any other
// element (`<button value>` whose caption is its children, `<option value>`,
// `<li value>`, `<data value>`…) they are data.
const TEXT_VALUE_TAGS = new Set(["input", "textarea"]);
const NON_TEXT_INPUT_TYPES = new Set([
  "hidden",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
]);

// Props of our own components that are plumbing, never text: React's own and the
// DOM attributes a component passes through unchanged. Anything else with letters
// (`value`, `name`, `variant`, `size`, `color`, `as`…) is reported: a prop with
// text usually ends up on screen, and a component that needs one of those as
// data adds it here with its reason.
const NON_VISIBLE_PROPS = new Set([
  "className",
  "key",
  "id",
  "ref",
  "htmlFor",
  "role",
  "lang",
  "dir",
  "href",
  "src",
  "rel",
  "target",
  "i18nKey", // <Trans i18nKey="…">: a key, checked by i18n-keys.test.ts
]);

// Callees whose literal arguments never reach the screen: a short white list
// (never a list of what is bad), each entry with the reason it is not visible. The
// argument of any other call or `new` is reported (`String("…")`,
// `useState("…")`, `setLabel("…")`, `[x].concat("…")`, `fmt("…")`). A callee is
// matched by its last two segments (`el.classList.add` → `classList.add`,
// `Intl.*`) or by its last one (`toLocaleString`); a number limits the
// exemption to that argument index. Every entry is a built-in of the platform
// (ECMAScript or the DOM), and the name alone is not enough: the callee's
// symbol must be DECLARED in one of TypeScript's own `lib.*.d.ts` files
// (`isDefaultLibrary`), so a `toBlob` or `getContext` of our own, whatever
// it writes, is reported (same family as TAG_TYPES by declaration).
// There is no list of
// exempt callees of our own (see below).
const EXEMPT_CALLEES: ReadonlyMap<string, number | "all"> = new Map<
  string,
  number | "all"
>([
  // Intl option bags (`{ style: "percent" }`): locale-aware formatting, not text.
  ["toLocaleString", "all"],
  ["toLocaleDateString", "all"],
  ["toLocaleTimeString", "all"],
  ["Intl.*", "all"],
  // CSS class names.
  ["classList.*", "all"],
  // DOM event names (the listener is a function: checked on its own).
  ["addEventListener", "all"],
  ["removeEventListener", "all"],
  // Developer-facing messages: thrown or logged, never rendered.
  ["Error", "all"],
  ["RangeError", "all"],
  ["TypeError", "all"],
  ["console.*", "all"],
  // Media queries and CSS selectors.
  ["matchMedia", "all"],
  ["querySelector", "all"],
  ["querySelectorAll", "all"],
  // Attribute and storage keys: only the first argument; a value is checked.
  ["getAttribute", 0],
  ["setAttribute", 0],
  ["removeAttribute", 0],
  ["localStorage.getItem", 0],
  ["localStorage.setItem", 0],
  ["localStorage.removeItem", 0],
  // DOM plumbing whose arguments are never text (added with the
  // count of `i18n-exempt` hatches in src/ui at 13, above the 10 of the
  // decision): element names and namespaces, the canvas context id, the MIME
  // type of toBlob and the option bags of Blob/File. The CONTENT of a Blob (index
  // 0) and the NAME of a File (index 1) can be shown: those stay checked;
  // `setAttribute` stays at index 0 only (a value can be visible text).
  ["createElement", 0],
  ["createElementNS", "all"],
  ["getContext", 0],
  ["toBlob", 1],
  ["Blob", 1],
  ["File", 2],
]);

// There is no list of exempt callees of our own: every exempt callee is a
// platform built-in and `t()` is handled apart (isTranslationCall). A list
// for own functions, matched by declaration like TAG_TYPES, existed for one
// while empty and untested: dead code in a barrier
// is a hole nobody has measured. It comes back with its first entry AND a
// fixture case that proves it.

// The symbol a call's callee resolves to: the identifier itself or, for a
// property access (`canvas.toBlob`, `Intl.NumberFormat`), its name, through
// an import alias when there is one.
function calleeSymbol(
  callee: ts.Expression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = checker.getSymbolAtLocation(target);
  return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

// Whether EVERY declaration of the symbol lives outside our code: in one of
// TypeScript's own lib files (`lib.dom.d.ts`, `lib.es5.d.ts`, …) or in an
// installed typing under node_modules (`@types/node` also declares `Blob`,
// `File` and `console`). `every`, not `some`: a
// symbol that merges a platform declaration with one of ours (a union type
// `MyCanvas | HTMLCanvasElement`, a `declare global` augmentation of
// `Document`) is ours for this purpose, and its literals are reported.
function isDeclaredInDefaultLib(
  symbol: ts.Symbol | undefined,
  program: ts.Program,
): boolean {
  const declarations = symbol?.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const file = declaration.getSourceFile();
      return (
        program.isSourceFileDefaultLibrary(file) ||
        /[\\/]node_modules[\\/]/.test(file.fileName)
      );
    })
  );
}

function calleeExemption(
  callee: ts.Expression,
  checker: ts.TypeChecker,
  program: ts.Program,
): number | "all" | undefined {
  let name: string;
  let receiver: string | undefined;
  if (ts.isIdentifier(callee)) {
    name = callee.text;
  } else if (ts.isPropertyAccessExpression(callee)) {
    name = callee.name.text;
    const object = callee.expression;
    receiver = ts.isIdentifier(object)
      ? object.text
      : ts.isPropertyAccessExpression(object)
        ? object.name.text
        : undefined;
  } else {
    return undefined;
  }
  const symbol = calleeSymbol(callee, checker);
  if (!isDeclaredInDefaultLib(symbol, program)) return undefined;
  return (
    (receiver === undefined
      ? undefined
      : (EXEMPT_CALLEES.get(`${receiver}.${name}`) ??
        EXEMPT_CALLEES.get(`${receiver}.*`))) ?? EXEMPT_CALLEES.get(name)
  );
}

// Direct argument (or inside an object/array argument, without crossing a
// function) of a white-listed call or `new`, at an exempt index.
function isExemptArgument(
  call: ts.CallExpression | ts.NewExpression,
  argument: ts.Node,
  checker: ts.TypeChecker,
  program: ts.Program,
): boolean {
  const args: readonly ts.Node[] = call.arguments ?? [];
  const index = args.indexOf(argument);
  if (index < 0) return false;
  const exemption = calleeExemption(call.expression, checker, program);
  return exemption === "all" || exemption === index;
}

// Text with no letters (punctuation, symbols, digits, whitespace) is not a translation
// candidate: separators like "·", "—" or "(" may stay literal.
const HAS_LETTER = /\p{L}/u;
const HTML_ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/giu;

// Escape hatch for presentation constants (CSS class lists, colours, keys): a comment
// `i18n-exempt: <reason>` on the literal's line or on the line above. The reason is
// mandatory so the exemption is visible and arguable in the diff; a bare marker does
// not exempt.
const EXEMPT_MARK = /i18n-exempt:\s*\S/;

function hasExemptComment(source: ts.SourceFile, node: ts.Node): boolean {
  const starts = source.getLineStarts();
  const text = source.getFullText();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  const lineText = (l: number): string =>
    l < 0 ? "" : text.slice(starts[l] ?? 0, starts[l + 1] ?? text.length);
  return (
    EXEMPT_MARK.test(lineText(line)) || EXEMPT_MARK.test(lineText(line - 1))
  );
}

function hasLetter(text: string): boolean {
  return HAS_LETTER.test(text.replace(HTML_ENTITY, ""));
}

const COMPARISON_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

interface Violation {
  file: string;
  line: number;
  text: string;
}

type Literal =
  ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function isLiteral(node: ts.Node): node is Literal {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

function literalText(node: Literal): string {
  return ts.isTemplateExpression(node)
    ? node.head.text +
        node.templateSpans.map((span) => span.literal.text).join("")
    : node.text;
}

// `t(...)` or `i18n.t(...)`: its arguments are keys and options, not visible text.
function isTranslationCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === "t") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "t")
  );
}

function isJsxElementLike(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

function isNativeTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
}

function inputType(element: ts.JsxOpeningLikeElement): string | undefined {
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText() === "type") {
      const init = attribute.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) return init.text;
    }
  }
  return undefined;
}

function attributeIsVisible(attribute: ts.JsxAttribute): boolean {
  const name = attribute.name.getText();
  const element = attribute.parent.parent;
  if (!ts.isJsxOpeningLikeElement(element)) return true;
  if (isNativeTag(element.tagName)) {
    if (VISIBLE_ATTRIBUTES.has(name)) return true;
    if (name === "value" || name === "defaultValue") {
      if (!TEXT_VALUE_TAGS.has((element.tagName as ts.Identifier).text))
        return false;
      const type = inputType(element);
      return type === undefined || !NON_TEXT_INPUT_TYPES.has(type);
    }
    return false;
  }
  // Our own component: text props are the norm, plumbing props the exception.
  return (
    !NON_VISIBLE_PROPS.has(name) &&
    !name.startsWith("data-") &&
    !name.startsWith("aria-hidden")
  );
}

// Named type aliases whose values are tags the compiler constrains, never
// text: a literal is exempt only when the type it is declared as resolves to
// one of these. An entry is the file that declares the alias plus its name
// (`property` names the discriminant of an aliased object union), and it is
// matched by declaration, never by name: a local `type Step = "Well done" |
// …` in another file is not `Step`. A white list
// (never a list of what is bad): a union of literals that is not here, named or not,
// is reported, because the compiler constraining a value says nothing about
// whether it is painted (`label: "Save" | "Cancel"`; decision of
// 2026-10-17). Each entry says why its values are not text; a new alias is
// added here by hand, with its reason.
interface TagType {
  readonly file: string;
  readonly alias: string;
  readonly property?: string;
}

const TAG_TYPES: readonly TagType[] = [
  // Which chains the grid draws (`layers.has("errors")`).
  { file: "src/ui/model/trace.ts", alias: "Layer" },
  // The steps of the step-by-step mode.
  { file: "src/ui/steps/step-machine.ts", alias: "Step" },
  // Pauli symbols I, X, Z, Y: notation in every language.
  { file: "src/ui/grid/geometry.ts", alias: "PauliName" },
  // The "X" | "Z" type of a stabilizer.
  { file: "src/core/lattice/rotated.ts", alias: "StabilizerType" },
  // Discriminant of the grid reducer's actions.
  {
    file: "src/ui/model/grid-reducer.ts",
    alias: "GridAction",
    property: "type",
  },
  // Discriminant of the step machine's actions.
  {
    file: "src/ui/steps/step-machine.ts",
    alias: "StepAction",
    property: "type",
  },
  // Discriminant of the challenge machine's actions and of its game phases.
  {
    file: "src/ui/challenge/challenge-machine.ts",
    alias: "ChallengeAction",
    property: "type",
  },
  {
    file: "src/ui/challenge/challenge-machine.ts",
    alias: "Game",
    property: "phase",
  },
  // Ids of the in-context explanations: branches `explain.<id>` of the locales,
  // read through t(); never painted.
  { file: "src/ui/explain/ids.ts", alias: "ExplainId" },
  // The noise models of the chart: keys of the base curves, of the default p
  // and of the branches `chart.model.*` / `chart.modelSelect.*`; the selector
  // shows t() of them, never the name (phase 2).
  { file: "src/worker/protocol.ts", alias: "NoiseKind" },
  // The spacetime viewer: which layers the isometric SVG draws
  // (`layers.has("measurements")`), its six steps (the panel reads
  // t(`spacetime.${step}`)) and its three presets (t(`spacetime.preset.${kind}`)).
  { file: "src/ui/spacetime/viewer-steps.ts", alias: "ViewerLayer" },
  { file: "src/ui/spacetime/viewer-steps.ts", alias: "ViewerStep" },
  { file: "src/ui/spacetime/viewer-steps.ts", alias: "EdgeKind" },
  { file: "src/ui/model/spacetime-trace.ts", alias: "PresetKind" },
  // The theme states: the toggle shows t(`theme.${theme}`); the
  // value only reaches `<html data-theme>` and localStorage.
  { file: "src/ui/theme/theme.ts", alias: "Theme" },
  // Analytics (tasks/plans/analytics.md D4): enum values of the shared event
  // taxonomy, validated against events.json before leaving the browser; sent
  // to the tracker or put in a link's query, never painted.
  { file: "src/analytics/events.ts", alias: "ChallengeResult" },
  { file: "src/analytics/events.ts", alias: "ShareMethod" },
  { file: "src/analytics/events.ts", alias: "FormSource" },
  // Which brand-site form a link opens (interest, feedback): selects a path
  // or the mailto fallback; the link text is t("footer.*").
  { file: "src/analytics/forms.ts", alias: "FormKind" },
];

interface ResolvedTag {
  readonly entry: TagType;
  readonly declaration: ts.TypeAliasDeclaration;
}

const resolvedTags = new WeakMap<ts.Program, readonly ResolvedTag[]>();

// Each entry's declaration node in this program (its file is a root of
// `createProgram`). A listed alias that is not declared where the list says
// is an error, not a silent entry that exempts nothing.
function resolveTagTypes(program: ts.Program): readonly ResolvedTag[] {
  const cached = resolvedTags.get(program);
  if (cached !== undefined) return cached;
  const tags = TAG_TYPES.map((entry): ResolvedTag => {
    const source = program.getSourceFile(
      normalizePath(join(process.cwd(), entry.file)),
    );
    const declaration = source?.statements.find(
      (statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) &&
        statement.name.text === entry.alias,
    );
    if (declaration === undefined)
      throw new Error(
        `TAG_TYPES: ${entry.file} declares no type alias ${entry.alias}`,
      );
    return { entry, declaration };
  });
  resolvedTags.set(program, tags);
  return tags;
}

// Whether a type is one of the listed aliases (the alias itself, matched by
// its declaration node), or a union written from listed aliases only
// (`Layer | StabilizerType`): the checker flattens such a union to its
// literals and keeps the aliased members it was built from in `origin`
// (internal; absent, the flattened literals have no alias and the union is
// reported: the safe side, and the fixture shows it).
function isListedTag(
  type: ts.Type,
  tags: readonly ResolvedTag[],
  property: string | undefined,
): boolean {
  const declarations = type.aliasSymbol?.declarations;
  if (declarations !== undefined)
    return tags.some(
      (tag) =>
        tag.entry.property === property &&
        declarations.some((d) => d === tag.declaration),
    );
  const origin = (type as { origin?: ts.Type }).origin;
  return (
    origin !== undefined &&
    origin.isUnion() &&
    origin.types.every((member) => isListedTag(member, tags, property))
  );
}

interface Argument {
  call: ts.CallExpression | ts.NewExpression;
  index: number;
}

// The call or `new` a literal is handed to, directly or inside object, array
// or conditional nesting, but never through a function or a JSX element, and
// the argument's index.
function enclosingArgument(node: Literal): Argument | undefined {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionLike(current) ||
      isJsxElementLike(current) ||
      ts.isJsxAttribute(current)
    )
      return undefined;
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      const args: readonly ts.Node[] = current.arguments ?? [];
      const index = args.indexOf(child);
      return index < 0 ? undefined : { call: current, index };
    }
    child = current;
    current = current.parent;
  }
  return undefined;
}

function declaredParameter(
  declaration: ts.SignatureDeclaration,
  index: number,
): ts.ParameterDeclaration | undefined {
  const parameters = declaration.parameters;
  const last = parameters[parameters.length - 1];
  return parameters[index] ?? (last?.dotDotDotToken ? last : undefined);
}

// The index of the signature's own type parameter (`<T>` of the called
// function, not of its class or alias) that the declared type of the argument's
// parameter mentions, or undefined when it mentions none. Decided on the
// declaration, not on the instantiated type: once instantiated, `T` already
// carries whatever the literal put into it.
function instantiatedTypeParameter(
  { call, index }: Argument,
  checker: ts.TypeChecker,
): number | undefined {
  const declaration = checker.getResolvedSignature(call)?.getDeclaration();
  const own = declaration?.typeParameters;
  if (declaration === undefined || own === undefined || own.length === 0)
    return undefined;
  const type = declaredParameter(declaration, index)?.type;
  if (type === undefined) return undefined;
  let found: number | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isTypeReferenceNode(node)) {
      const symbol = checker.getSymbolAtLocation(node.typeName);
      const i = own.findIndex((parameter) =>
        symbol?.declarations?.some((d) => d === parameter),
      );
      if (i >= 0) {
        found = i;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(type);
  return found;
}

// The literal is a value of the type: a `Layer` annotation does not make
// `"A20 Hello"` a tag, with or without a `@ts-expect-error` above it. A
// template expression is a `string`, never a member.
function literalFits(
  literal: Literal,
  type: ts.Type,
  checker: ts.TypeChecker,
): boolean {
  return checker.isTypeAssignableTo(checker.getTypeAtLocation(literal), type);
}

// Whether a literal is declared as a listed tag by this type: the type itself,
// looking through `| undefined` / `| null` (`tone?: Layer`; the checker keeps
// the alias of the non-nullable part), or, for a generic alias that wraps
// another (`SetStateAction<Layer>`, the parameter of a `useState<Layer>`
// setter), a type argument the literal fits. `Record<string, "Hello">` wraps
// no alias: its arguments are `string` and a bare literal type.
function isTagType(
  literal: Literal,
  type: ts.Type | undefined,
  checker: ts.TypeChecker,
  tags: readonly ResolvedTag[],
): boolean {
  if (type === undefined) return false;
  const declared = checker.getNonNullableType(type);
  if (!literalFits(literal, declared, checker)) return false;
  if (isListedTag(declared, tags, undefined)) return true;
  return (declared.aliasTypeArguments ?? []).some((argument) =>
    isTagType(literal, argument, checker, tags),
  );
}

// Whether a literal is declared as one of TAG_TYPES:
//   - handed to a parameter whose declared type is a type parameter of the
//     signature (`id("Hello")`, `useDeferredValue("…")`, `Object.freeze({…})`,
//     `same(layer, "errors")`): the type was instantiated from the arguments,
//     not declared, so only an explicit type argument counts
//     (`useState<Layer>("errors")`, `new Set<Layer>([…])`, `same<Layer>(…)`);
//   - otherwise by its contextual type (`layers.has("errors")`, a `readonly
//     Layer[]`, a `Layer` prop, variable, return or assignment);
//   - or, for the value of a property in an object literal, by the object's
//     contextual type, a listed alias with that property as discriminant
//     (`dispatch({ type: "toggleX" })` → `GridAction["type"]`), the literal
//     being a value of that property.
function isDeclaredTag(
  node: Literal,
  checker: ts.TypeChecker,
  tags: readonly ResolvedTag[],
): boolean {
  const argument = enclosingArgument(node);
  if (argument !== undefined) {
    const parameter = instantiatedTypeParameter(argument, checker);
    if (parameter !== undefined) {
      // The literal must fit the explicit argument: `new Map<Layer, string>`
      // mentions `K` first, and the value `"Hello"` is not a `Layer`.
      const explicit = argument.call.typeArguments?.[parameter];
      if (explicit === undefined) return false;
      return isTagType(
        node,
        checker.getTypeFromTypeNode(explicit),
        checker,
        tags,
      );
    }
  }
  if (isTagType(node, checker.getContextualType(node), checker, tags))
    return true;
  const parent = node.parent;
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    ts.isObjectLiteralExpression(parent.parent) &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
  ) {
    const owner = checker.getContextualType(parent.parent);
    if (owner === undefined) return false;
    const declared = checker.getNonNullableType(owner);
    const key = parent.name.text;
    const property = checker.getPropertyOfType(declared, key);
    return (
      property !== undefined &&
      literalFits(
        node,
        checker.getTypeOfSymbolAtLocation(property, node),
        checker,
      ) &&
      isListedTag(declared, tags, key)
    );
  }
  return false;
}

// A literal is a tag, not text, only when it is declared as one of TAG_TYPES.
// A type assertion manufactures the type from the literal itself (`"Hello" as
// Tag`, `satisfies`), so it does not count.
function isTypedTag(
  node: Literal,
  checker: ts.TypeChecker,
  tags: readonly ResolvedTag[],
): boolean {
  const parent = node.parent;
  if (
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  )
    return false;
  return isDeclaredTag(node, checker, tags);
}

// Walks up from a literal until a position that decides visibility.
function isExempt(
  node: Literal,
  checker: ts.TypeChecker,
  program: ts.Program,
): boolean {
  const parent = node.parent;
  if (
    ts.isBinaryExpression(parent) &&
    COMPARISON_OPERATORS.has(parent.operatorToken.kind)
  )
    return true;
  if (ts.isCaseClause(parent)) return true;
  if (
    ts.isElementAccessExpression(parent) &&
    parent.argumentExpression === node
  )
    return true;
  if (ts.isComputedPropertyName(parent) || ts.isLiteralTypeNode(parent))
    return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
    return true;
  // `import("./x")` / `import(\`./${name}\`)`: a module specifier, as the static
  // import's is; never text (the ESLint override and deferred-loading decide
  // WHERE a dynamic import may appear).
  if (
    ts.isCallExpression(parent) &&
    parent.expression.kind === ts.SyntaxKind.ImportKeyword
  )
    return true;
  if (ts.isExpressionStatement(parent)) return true; // "use client" directives
  if (ts.isJsxAttribute(parent)) return !attributeIsVisible(parent);

  let child: ts.Node = node;
  let current: ts.Node | undefined = parent;
  let crossedFunction = false;
  while (current !== undefined) {
    if (ts.isJsxAttribute(current)) {
      // `attr="…"` / `attr={…}`: the attribute decides, but only for a value
      // handed to it directly. A literal written by a callback (`ref={(el) =>
      // { el.title = "…"; }}`, `onClick={() => { document.title = "…"; }}`)
      // lands wherever the callback puts it: the attribute's name says
      // nothing about it, so it is checked like any other literal.
      return crossedFunction ? false : !attributeIsVisible(current);
    }
    if (ts.isJsxExpression(current)) {
      // A child expression `<p>{…}</p>` is rendered; an attribute expression
      // is decided by the attribute, one step up.
      if (!ts.isJsxAttribute(current.parent)) return false;
    } else if (isJsxElementLike(current)) return false;
    if (isFunctionLike(current)) crossedFunction = true;
    if (
      !crossedFunction &&
      (ts.isCallExpression(current) || ts.isNewExpression(current)) &&
      (current.arguments ?? []).some((a) => a === child)
    ) {
      // An argument is exempt only for a white-listed callee; `useState("…")`,
      // `String("…")` or `fmt("…")` are reported. A literal produced inside a
      // callback body never gets here (crossedFunction).
      return isExemptArgument(current, child, checker, program);
    }
    child = current;
    current = current.parent;
  }
  return false; // top level: const initializer, object property, etc.
}

// The JSX attribute a literal is handed to, if any (at any depth, but not
// through a callback: a literal a callback writes is not the attribute's value).
function enclosingAttribute(node: ts.Node): ts.JsxAttribute | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isJsxAttribute(current)) return current;
    if (isJsxElementLike(current) || isFunctionLike(current)) break;
    if (ts.isJsxExpression(current) && !ts.isJsxAttribute(current.parent))
      break;
    current = current.parent;
  }
  return undefined;
}

function describeLiteral(node: Literal, source: ts.SourceFile): string {
  const text = ts.isTemplateExpression(node) ? node.getText(source) : node.text;
  const attribute = enclosingAttribute(node);
  return attribute === undefined
    ? text
    : `${attribute.name.getText(source)}="${text}"`;
}

// One type-checked program over the files to inspect plus the files that
// declare TAG_TYPES, with the app's compiler options: contextual types need
// the checker (isTypedTag), and a syntax-only parse would report every union
// tag.
export function createProgram(files: readonly string[]): ts.Program {
  const configFile = join(process.cwd(), "tsconfig.app.json");
  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  const { options } = ts.parseJsonConfigFileContent(
    config as object,
    ts.sys,
    process.cwd(),
  );
  const roots = [
    ...files,
    ...TAG_TYPES.map((entry) => join(process.cwd(), entry.file)),
  ];
  return ts.createProgram([...new Set(roots.map(normalizePath))], options);
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

export function findLiteralText(
  file: string,
  program: ts.Program,
): Violation[] {
  const source = program.getSourceFile(normalizePath(file));
  if (source === undefined) throw new Error(`${file} is not in the program`);
  const checker = program.getTypeChecker();
  const tags = resolveTagTypes(program);
  const violations: Violation[] = [];
  const report = (node: ts.Node, text: string) => {
    if (hasExemptComment(source, node)) return;
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
      // Keys and options are not text; JSX passed inside (rare) still is.
      node.arguments.forEach((argument) => visitInsideTranslation(argument));
      return;
    }
    if (ts.isJsxText(node)) {
      if (hasLetter(node.text)) report(node, node.text.trim());
    } else if (isLiteral(node)) {
      if (
        hasLetter(literalText(node)) &&
        !isExempt(node, checker, program) &&
        !isTypedTag(node, checker, tags)
      )
        report(node, describeLiteral(node, source));
      if (!ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };

  const visitInsideTranslation = (node: ts.Node) => {
    if (isJsxElementLike(node)) {
      visit(node);
      return;
    }
    ts.forEachChild(node, visitInsideTranslation);
  };

  visit(source);
  return violations;
}

describe("test_intent_i18n_literal_text", () => {
  const files = uiSourceFiles();

  it("finds at least one component to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("finds no user-visible literal text outside t() in src/ui", () => {
    const program = createProgram(files);
    const violations = files.flatMap((file) => findLiteralText(file, program));
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("checks .ts and .tsx files but not tests or declarations (self-check)", () => {
    expect(
      ["a.tsx", "b.ts", "c.test.tsx", "d.test.ts", "e.d.ts", "f.css"].filter(
        isUiSource,
      ),
    ).toEqual(["a.tsx", "b.ts"]);
  });

  it("detects every literal shape it claims to detect and nothing else (self-check)", () => {
    const fixtures = join(process.cwd(), "tests", "intent", "fixtures");
    const component = join(fixtures, "literal-text.tsx");
    const module = join(fixtures, "literal-text-module.ts");
    const program = createProgram([component, module]);
    const found = findLiteralText(component, program).map((v) => v.text);
    expect(found).toEqual([
      // A local alias that only shares its name with a listed one.
      "Click to continue",
      "Well done",
      "Syndrome by SEEQuant",
      "Object label",
      "Needs reason",
      // Listed-alias shapes under an alias that is not listed.
      "edit",
      "view",
      "view",
      "edit",
      // Unions of literals that are no listed alias, whatever declares them.
      "Record value",
      "Annotated return",
      "Switch return",
      "Switch default",
      "Single literal",
      "Array element",
      "Map value",
      "Later alpha",
      "Later beta",
      "Default alpha",
      "Class alpha",
      "Tuple alpha",
      "Tuple beta",
      "Initial label",
      "Memo label",
      // Type parameters instantiated from the arguments.
      "Generic text",
      "Deferred text",
      "Frozen title",
      "errors",
      // Text annotated as a listed alias under `@ts-expect-error`.
      "A20 Hello",
      // An inline union of a listed alias with text / with an unlisted alias:
      // every member must be a listed alias, not some.
      "Mixed text",
      "errors",
      "view",
      "edit",
      "Assigned text",
      'title="Tooltip"',
      "Hello world",
      "Literal child",
      "Ternary branch",
      "`Template ${n} text`",
      " concatenated",
      'aria-label="Attribute ternary"',
      'aria-label="`Qubit ${n}`"',
      "Nested literal",
      'text="Built in Malaga"',
      'label="Prop ternary"',
      "`Distance ${d}`",
      "Spanish",
      "English",
      'value="Send feedback"',
      "Ref text",
      "Handler title",
      "Inner markup",
      "Document title",
      'dangerouslySetInnerHTML="Raw markup"',
      'children="Children prop"',
      'defaultValue="Default text"',
      'defaultValue="Default note"',
      'value="Dynamic type"',
      "Hold for a Z error",
      'alt="Surface code"',
      "Set label",
      "Concat item",
      "Format me",
      "Attribute value",
      "Spanish stored",
      'variant="Variant prop"',
      'download="report.csv"',
      "Asserted tag",
      "Hello param",
      'label="Save"',
      'mode="view"',
      // DOM plumbing: createElement/createElementNS,
      // getContext and the option bags of Blob/File are exempt; a Blob's
      // content, a File's name and a textContent assignment are not.
      "Blob content",
      "File name",
      "Body text",
      // Exempt by declaration, not by name: our own toBlob, getContext and
      // File are reported; the DOM's own are exempt only at their index.
      "Local blob text",
      "Local context text",
      "Local file text",
      "Context option",
      "Blob quality",
      "Element option",
      // A union of a lib type and ours is ours.
      "Union shown",
    ]);
    expect(findLiteralText(module, program).map((v) => v.text)).toEqual([
      "Module constant",
      "`Pluralised ${count} times`",
    ]);
  });
});
