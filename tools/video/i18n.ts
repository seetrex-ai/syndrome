// The texts the video shows are the app's own (tasks/plans/video.md D9; docs/spec.md §2
// hard rule 1 in spirit): the script reads src/locales/<lang>.json and translates
// nothing. A missing key is an error, never an empty card.

import en from "../../src/locales/en.json";
import es from "../../src/locales/es.json";

export type Lang = "en" | "es";
export const LANGS: readonly Lang[] = ["en", "es"];

const LOCALES: Readonly<Record<Lang, unknown>> = { en, es };

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value);
}

function lookup(lang: Lang, key: string): unknown {
  let node: unknown = LOCALES[lang];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Whether `key` names a leaf string of `<lang>.json`. */
export function hasKey(lang: Lang, key: string): boolean {
  return typeof lookup(lang, key) === "string";
}

/** The text of `key` in `lang`; throws when the key is missing or is not a leaf string. */
export function t(lang: Lang, key: string): string {
  const value = lookup(lang, key);
  if (typeof value !== "string") {
    throw new Error(`i18n key "${key}" is missing in src/locales/${lang}.json`);
  }
  return value;
}
