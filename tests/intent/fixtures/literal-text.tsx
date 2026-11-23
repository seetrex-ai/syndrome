// Fixture for tests/intent/i18n-literal-text.test.ts. It is NOT under src/ui on
// purpose: it exists so the test proves it catches each literal shape it claims
// to catch, and ignores each shape it claims to ignore.
"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
// Aliases listed in TAG_TYPES of the test, the real ones: their values are
// tags, not text. The list matches the declaration, not the name.
import type { StabilizerType } from "../../../src/core";
import type { GridAction } from "../../../src/ui/model/grid-reducer";
import type { Layer } from "../../../src/ui/model/trace";

type T = (key: string, options?: Record<string, unknown>) => string;
// Aliases NOT listed: the compiler constrains their values just the same, but
// the detector does not trust them (decision of 2026-10-17).
type Mode = "edit" | "view";
type Tag = "Asserted tag" | "Other tag";
// Must be reported: a local alias that only shares its name with a listed one
// (`Step` of src/ui/steps/step-machine.ts) exempts nothing.
type Step = "Click to continue" | "Well done";
const HINT: Step = "Click to continue";
function Banner({ step = "Well done" }: { step?: Step }) {
  return <h2>{step}</h2>;
}

// Must be reported: a constant that ends up on screen.
const BYLINE = "Syndrome by SEEQuant";
const META = { label: "Object label", kind: "x" === String(1) ? 1 : 2 };
const DISTANCES = [3, 5, 7];
const CODES = Object.keys({ en: 1, es: 1 });
// Must NOT be reported: presentation constants exempted with a reason.
const GRID_CLASS = "grid grid--wide"; // i18n-exempt: CSS class list
// i18n-exempt: hex colour token
const ACCENT = "#e11d48";
// Must be reported: a bare marker without a reason does not exempt.
const BAD = "Needs reason"; // i18n-exempt
// Must NOT be reported: tags of a listed alias, under an explicit type argument
// (`new Set<Layer>`), an annotation (`readonly Layer[]`) or an inline union of
// listed aliases (`Set<Layer | StabilizerType>`).
const LAYERS = new Set<Layer>(["errors", "defects"]);
const ORDER: readonly Layer[] = ["defects", "errors"];
const MIXED = new Set<Layer | StabilizerType>(["errors", "Z"]);
// Must be reported: the same shapes under an alias that is not listed.
const MODES = new Set<Mode>(["edit", "view"]);
const MODE_ORDER: readonly Mode[] = ["view", "edit"];
// Must NOT be reported: module specifiers of a dynamic import, string or template.
const lazyModule = () => import("./literal-text-module");
const lazyNamed = (name: string) => import(`./literal-text-${name}`);
void lazyModule;
void lazyNamed;

// Must be reported (unlisted unions): a union of literals that is not a listed alias exempts
// nothing, whatever declares it: a parameter, a prop, a `Record` value, an
// annotated return (plain or from a `switch`), an annotated variable, an
// `Array` / `Map` type argument, an assignment, a parameter default, a class
// property, a tuple.
function Say(x: "Hello param" | "Bye") {
  return <p>{x}</p>;
}
function Pick({ label }: { label: "Save" | "Cancel" }) {
  return <button>{label}</button>;
}
const LABELS: Record<string, "Record value"> = { a: "Record value" };
function greet(): "Annotated return" | "Bye" {
  return "Annotated return";
}
function pick(n: number): "Switch return" | "Switch default" {
  switch (n) {
    case 1:
      return "Switch return";
    default:
      return "Switch default";
  }
}
// eslint-disable-next-line @typescript-eslint/prefer-as-const -- the shape under test
const SINGLE: "Single literal" = "Single literal";
const ITEMS: Array<"Array element"> = [];
ITEMS.push("Array element");
const BY_ID = new Map<number, "Map value">([[1, "Map value"]]);
let later: "Later alpha" | "Later beta";
later = "Later alpha";
if (DISTANCES.length > 3) later = "Later beta";
function withDefault(x: "Default alpha" | "Default beta" = "Default alpha") {
  return x;
}
class Box {
  label: "Class alpha" | "Class beta" = "Class alpha";
}
const PAIR: readonly ["Tuple alpha", "Tuple beta"] = [
  "Tuple alpha",
  "Tuple beta",
];

// Generic helpers: a type parameter instantiated from the arguments.
const id = <U,>(x: U) => x;
function same<U>(_a: U, b: U): U {
  return b;
}

function Note({
  text,
  label,
  className,
  variant,
}: {
  text?: string;
  label?: string;
  className?: string;
  /** A string-typed prop of our own component: reported (it may be rendered). */
  variant?: string;
  /** A tag of a listed alias, optional: not text. */
  tone?: Layer;
  /** A union of literals, not listed: reported. */
  mode?: Mode;
}) {
  return (
    <small className={className} aria-label={label} data-variant={variant}>
      {text}
    </small>
  );
}

function fmt(s: string): string {
  return s.toUpperCase();
}

function checkDistance(n: number): void {
  // Must NOT be reported: a developer-facing message.
  if (n < 3) throw new RangeError(`distance ${n} out of range`);
  console.warn("Dev warning");
}

// Must NOT be reported: tags under the function's own return annotation.
function layerOf(flag: boolean): Layer {
  return flag ? "errors" : "defects";
}

export function Fixture({
  n,
  lang,
  t,
  mode,
  layers,
  dispatch,
}: {
  n: number;
  lang: string;
  t: T;
  mode: Mode;
  layers: ReadonlySet<Layer>;
  dispatch: (action: GridAction) => void;
}) {
  const labels: Record<string, string> = {};
  // Must be reported: an initial state and a setter argument are rendered below.
  const [label, setLabel] = useState("Initial label");
  // Must be reported: inside an un-annotated callback the contextual type is
  // inferred from the literal itself, so it is not a declared tag.
  const memo = useMemo(() => ({ label: "Memo label" }), []);
  // Must NOT be reported: a listed alias under an explicit type argument of a
  // generic call, its setter (`SetStateAction<Layer>` wraps the alias) and the
  // return of the setter's callback.
  const [layer, setLayer] = useState<Layer>("errors");
  const flip = () =>
    setLayer((prev) => (prev === "errors" ? "defects" : "errors"));
  // Must be reported (generics): the type parameter is instantiated from the
  // arguments, not declared, even when another argument makes it `Layer`.
  const plain = id("Generic text");
  const deferred = useDeferredValue("Deferred text");
  const frozen = Object.freeze({ title: "Frozen title" });
  const inferred = same(layerOf(n > 0), "errors");
  // Must NOT be reported: the same call with the alias as explicit type argument.
  const explicit = same<Layer>(layerOf(n > 0), "defects");
  // Must NOT be reported: tags under an annotation or assigned to a typed variable.
  const drawn: Layer = n > 0 ? "errors" : layer;
  let next: Layer = drawn;
  if (n > 1) next = "defects";
  const nullable: Layer | null = n > 2 ? "defects" : null;
  // Must NOT be reported: an inline union of listed aliases only.
  const mixed: Layer | StabilizerType = n > 3 ? "errors" : "X";
  // Must be reported: a literal that is no value of the alias, with the
  // compiler's objection silenced.
  // @ts-expect-error -- the shape under test: text annotated as a tag
  const bogus: Layer = "A20 Hello";
  // Must be reported: an inline union that mixes a listed alias with text, or
  // with an alias that is not listed (a mutant `every` → `some` survived once).
  const mixedText: Layer | "Mixed text" = n > 4 ? "Mixed text" : "errors";
  const mixedAlias: Layer | Mode = n > 5 ? "view" : mode;
  void mixedText;
  void mixedAlias;
  // Must be reported: the same under an alias that is not listed.
  const shown: Mode = n > 0 ? "edit" : mode;
  // Must be reported: free text assigned to a string variable.
  let free = "";
  free = n > 2 ? "Assigned text" : free;
  switch (mode) {
    case "edit":
      break;
    default:
      break;
  }
  checkDistance(n);
  return (
    <section title="Tooltip">
      {/* Must be reported */}
      <p>Hello world</p>
      <p>{"Literal child"}</p>
      <p>{n > 0 ? "Ternary branch" : t("key.ok")}</p>
      <p>{`Template ${n} text`}</p>
      <p>{t("key.title") + " concatenated"}</p>
      <input aria-label={n > 0 ? "Attribute ternary" : ""} />
      <svg aria-label={`Qubit ${n}`} />
      <p>{n > 0 ? <b>Nested literal</b> : null}</p>
      <Note
        text="Built in Malaga"
        label={n > 0 ? "Prop ternary" : t("key.label")}
      />
      {BYLINE}
      {META.label}
      <span className={GRID_CLASS} style={{ color: ACCENT }}>
        {BAD}
      </span>
      <p>{DISTANCES.map((d) => `Distance ${d}`).join(", ")}</p>
      <ul>{CODES.map((code) => (code === "es" ? "Spanish" : "English"))}</ul>
      <input type="submit" value="Send feedback" />
      {/* Written by a callback: the attribute's name does not exempt it. */}
      <p
        ref={(el) => {
          if (el) el.textContent = "Ref text";
        }}
      />
      <button
        onClick={(event) => {
          event.currentTarget.title = "Handler title";
        }}
      />
      <div
        ref={(el) => {
          if (el) el.innerHTML = "Inner markup";
        }}
      />
      <button
        onClick={() => {
          document.title = "Document title";
        }}
      />
      <p dangerouslySetInnerHTML={{ __html: "Raw markup" }} />
      <p children={"Children prop"} />
      <input defaultValue={"Default text"} />
      <textarea defaultValue="Default note" />
      <input type={mode} value={"Dynamic type"} />
      {/* Arguments of calls that are not white-listed. */}
      <p>{String("Hold for a Z error")}</p>
      <img alt={String("Surface code")} />
      <button onClick={() => setLabel("Set label")}>{label}</button>
      <p>{memo.label}</p>
      <p data-mode={next}>{free}</p>
      <p>{[lang].concat("Concat item").join(", ")}</p>
      <p>{fmt("Format me")}</p>
      <p
        ref={(el) => {
          if (el) el.setAttribute("data-note", "Attribute value");
          localStorage.setItem("lang", "Spanish stored");
        }}
      />
      <Note variant="Variant prop" />
      <a download="report.csv" href={lang} />
      <p>{"Asserted tag" as Tag}</p>
      {/* Unions of literals that are not a listed alias, rendered. */}
      {Say("Hello param")}
      <Pick label="Save" />
      <p>{Object.values(LABELS).join(", ")}</p>
      <p>{greet()}</p>
      <p>{pick(n)}</p>
      <p>{SINGLE}</p>
      <p>{ITEMS.join(", ")}</p>
      <p>{BY_ID.get(1)}</p>
      <p>{later}</p>
      <p>{withDefault()}</p>
      <p>{new Box().label}</p>
      <p>{PAIR.join(" ")}</p>
      <Note mode="view" />
      <p data-mode={shown}>{[...MODES, ...MODE_ORDER].join(", ")}</p>
      <p data-mixed={mixed}>{bogus}</p>
      {HINT}
      <Banner />
      {/* Generic parameters, rendered. */}
      <p>{plain}</p>
      <p>{deferred}</p>
      <p>{frozen.title}</p>
      <p data-layer={inferred} />

      {/* Must NOT be reported */}
      <input type="hidden" defaultValue="hidden default" />
      <input type="checkbox" value="yes" />
      <select defaultValue="en" />
      <data value="Twelve" />
      <button value="Button value">{t("key.send")}</button>
      <button
        onClick={(event) => {
          event.currentTarget.classList.add("pressed");
          window.addEventListener("resize", checkDistance.bind(null, n));
          window.matchMedia("(prefers-color-scheme: dark)");
          document.querySelector("main.app");
          event.currentTarget.getAttribute("data-qubit");
          localStorage.getItem("lang");
          new Intl.NumberFormat("en-US");
        }}
      />
      <span>·</span>
      <span>{42}</span>
      <span className="not-visible">
        {lang === "es" ? t("key.es") : t("key.other")}
      </span>
      <g
        className={`qubit qubit--${mode}`}
        transform={`translate(${n} 0)`}
        role={n > 0 ? "button" : undefined}
        style={{ touchAction: "pan-x pan-y" }}
      />
      <path d={`M${n},0h${n}Z`} />
      <Note text={t("key.note")} className={n > 0 ? "wide" : "narrow"} />
      <Note tone="defects" />
      <span>{layers.has("errors") ? t("key.errors") : null}</span>
      <span>{layers.has(layerOf(n > 0)) ? t("key.layer") : null}</span>
      <button onClick={() => dispatch({ type: "toggleX", q: n })} />
      <button onClick={() => setLayer("defects")} />
      <button onClick={flip} />
      <span>{LAYERS.has(layer) ? t("key.mode") : null}</span>
      <span>{MIXED.has(mixed) ? t("key.mixed") : null}</span>
      <span data-layers={[...ORDER, explicit, nullable ?? ""].join(" ")} />
      <span>{t("key.count", { count: "3", unit: "ms" })}</span>
      <span>{t(`language.${lang}`)}</span>
      <span>{labels["known key"]}</span>
      <input placeholder={t("key.placeholder")} type="search" name="query" />
      <p>{(0.103).toLocaleString(lang, { style: "percent" })}</p>
      <p>{new Intl.NumberFormat(lang, { style: "percent" }).format(0.103)}</p>
      <Note text={t("key.note")} className="muted" />
      <Fragment key="list">{t("key.list")}</Fragment>
      <option value="en">{t("language.en")}</option>
      <input type="hidden" value="token" />
      <footer>
        {t("key.title")} &middot; {t("key.byline")}
      </footer>
      <ul>
        {CODES.map((code) => (
          <li key={code}>{t(`language.${code}`)}</li>
        ))}
      </ul>
    </section>
  );
}

// DOM plumbing white-listed (EXEMPT_CALLEES): element
// names and namespaces, the canvas context id and the MIME option bags of
// Blob/File are never text. The content of a Blob, the name of a File and a
// textContent assignment are, and stay reported.
export const RECT = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "Rect name",
);
export const CANVAS = document.createElement("Canvas tag");
export const CONTEXT = (CANVAS as HTMLCanvasElement).getContext("Context id");
export const BLOB = new Blob(["Blob content"], { type: "Mime type" });
export const FILE = new File([BLOB], "File name", { type: "Mime type" });
document.body.textContent = "Body text";
(CANVAS as HTMLCanvasElement).toBlob(() => {}, "Mime type");

// A callee is exempt by its
// DECLARATION, not by its name. A `toBlob`, `getContext` or `File` of our own
// is reported whatever it is called; the DOM's own stay exempt, and only at
// the exempt index: the option bag of getContext, the quality of toBlob and
// the options of createElement are checked.
function toBlob(_callback: unknown, text: string): void {
  document.body.textContent = text;
}
toBlob(null, "Local blob text");
function getContext(label: string): string {
  return label;
}
export const LOCAL_CONTEXT = getContext("Local context text");
const Blob2 = { File: (_a: unknown, _b: unknown, name: string) => name };
export const LOCAL_FILE = Blob2.File(null, null, "Local file text");
// Must NOT be reported: the DOM's own, at the exempt index.
export const SVG_RECT = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "rect",
);
export const PNG = new Blob([BYLINE], { type: "image/png" });
export const CONTEXT_2D = (CANVAS as HTMLCanvasElement).getContext("2d");
(CANVAS as HTMLCanvasElement).toBlob(() => {}, "image/png");
// Must be reported: the DOM's own, outside the exempt index.
(CANVAS as HTMLCanvasElement).getContext("2d", { alpha: "Context option" });
// @ts-expect-error -- the shape under test: text where toBlob takes a quality
(CANVAS as HTMLCanvasElement).toBlob(() => {}, "image/png", "Blob quality");
document.createElement("p", { is: "Element option" });
// Must be reported: a symbol that merges a lib declaration with one of ours
// (lib + ours). `mine.toBlob` resolves to BOTH the DOM's toBlob
// and MyCanvas.toBlob; only a callee declared nowhere but in lib is exempt.
interface MyCanvas {
  toBlob(callback: (text: string) => void, text: string): void;
}
const MINE = CANVAS as MyCanvas | HTMLCanvasElement;
MINE.toBlob(() => {}, "Union shown");
