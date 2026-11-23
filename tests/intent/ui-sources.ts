// The UI sources the i18n intent tests inspect (i18n-literal-text.test.ts,
// i18n-keys.test.ts): every `.ts` / `.tsx` under `src/ui/**` except tests and
// declarations.

import { readdirSync } from "node:fs";
import { join } from "node:path";

export const UI_DIR = join(process.cwd(), "src", "ui");

export function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function isUiSource(file: string): boolean {
  return (
    /\.(ts|tsx)$/.test(file) &&
    !/\.test\.(ts|tsx)$/.test(file) &&
    !file.endsWith(".d.ts")
  );
}

export function uiSourceFiles(): string[] {
  return walk(UI_DIR).filter(isUiSource);
}
