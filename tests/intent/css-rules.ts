// A small CSS reader for the intent tests of the stylesheets (theme-tokens,
// reduced-motion): comments out, then every rule as {selector, declarations,
// the at-rules it sits in}. Enough for hand-written CSS without nesting of
// style rules; an `@media` / `@supports` / `@keyframes` block recurses.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface Declaration {
  readonly property: string;
  readonly value: string;
}

export interface Rule {
  /** Selector (or keyframe step), whitespace collapsed. */
  readonly selector: string;
  readonly declarations: readonly Declaration[];
  /** Enclosing at-rule preludes, outermost first (`@media (prefers-reduced-motion: reduce)`). */
  readonly ancestors: readonly string[];
}

export const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

const parseDeclarations = (body: string): Declaration[] =>
  body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .map((d) => {
      const colon = d.indexOf(":");
      if (colon < 0) throw new Error(`not a declaration: "${d}"`);
      return {
        property: d.slice(0, colon).trim(),
        value: collapse(d.slice(colon + 1)),
      };
    });

/** Every rule of a stylesheet (comments removed first). Bounded: one pass over the text. */
export function parseRules(css: string): Rule[] {
  const text = stripComments(css);
  const out: Rule[] = [];
  const walk = (from: number, to: number, ancestors: string[]) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= to) break;
      const prelude = collapse(text.slice(i, open));
      // The matching close brace, counting nesting.
      let depth = 1;
      let j = open + 1;
      while (j < to && depth > 0) {
        const ch = text[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      if (depth !== 0) throw new Error(`unbalanced braces after "${prelude}"`);
      const inner = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@") && inner.includes("{")) {
        walk(open + 1, j - 1, [...ancestors, prelude]);
      } else {
        out.push({
          selector: prelude,
          declarations: parseDeclarations(inner),
          ancestors,
        });
      }
      i = j;
    }
  };
  walk(0, text.length, []);
  return out;
}

/** Selector list split on top-level commas (none of our selectors nest commas). */
export const selectorsOf = (selector: string): string[] =>
  selector.split(",").map(collapse);

export const SRC_DIR = join(process.cwd(), "src");

function walkDir(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkDir(full) : [full];
  });
}

/** Every stylesheet under src/, with its text, keyed by the path relative to the repo. */
export function stylesheets(): { file: string; css: string }[] {
  return walkDir(SRC_DIR)
    .filter((f) => f.endsWith(".css"))
    .map((f) => ({
      file: relative(process.cwd(), f).replace(/\\/g, "/"),
      css: readFileSync(f, "utf8"),
    }));
}
