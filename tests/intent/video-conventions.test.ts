import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRng,
  identity,
  independentNoise,
  sampleNoise,
  weight,
} from "../../src/core/index";
import { cardHtml, initScript, STORAGE_KEYS } from "../../tools/video/capture";
import { checkScenes, shotOf } from "../../tools/video/check";
import { parseArgs } from "../../tools/video/cli";
import { expectedFrames, listText } from "../../tools/video/encode";
import { hiddenCss, HOOKS, SHOWN_ATTRIBUTE } from "../../tools/video/hooks";
import { hasKey, t } from "../../tools/video/i18n";
import {
  MAX_SECONDS,
  SCENES,
  statesOf,
  totalSeconds,
  type Scene,
} from "../../tools/video/scenes";
import { APP_DIR } from "../../tools/deploy/stage";
import { fileFor, mimeOf } from "../../tools/video/serve";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const VIDEO = join(ROOT, "tools", "video");
const VALIDATION_JSON = join(ROOT, "docs", "validacion");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const isSource = (file: string): boolean =>
  /\.(ts|tsx)$/.test(file) &&
  !/\.test\.(ts|tsx)$/.test(file) &&
  !file.endsWith(".d.ts");

function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && /\.(ts|tsx|json|css)$/.test(candidate))
      return candidate;
  }
  throw new Error(`${relative(ROOT, from)}: cannot resolve "${specifier}"`);
}

interface Imports {
  /** Resolved files of relative, value-level imports (static and dynamic). */
  readonly files: readonly string[];
  /** Bare specifiers of value-level imports. */
  readonly bare: readonly string[];
}

/** Every import that survives to runtime: `import type` and `export type` are erased. */
function importsOf(file: string): Imports {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const files: string[] = [];
  const bare: string[] = [];
  const take = (specifier: string) => {
    if (specifier.startsWith(".")) files.push(resolveRelative(file, specifier));
    else bare.push(specifier);
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly =
        (ts.isImportDeclaration(node) &&
          node.importClause?.isTypeOnly === true) ||
        (ts.isExportDeclaration(node) && node.isTypeOnly);
      if (!typeOnly) take(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) take(arg.text);
      else
        throw new Error(`${relative(ROOT, file)}: import() of a non-literal`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { files, bare };
}

const within = (file: string, dir: string): boolean =>
  file.startsWith(dir + sep);

/**
 * test_intent_video_ships_nothing
 *
 * INTENCIÓN: cero impacto del vídeo en el bundle. Por inversión (lista blanca): ningún
 *   fichero de `src/**` importa en tiempo de ejecución nada que resuelva fuera de `src/`
 *   salvo los JSON de `docs/validacion/` (la base de la gráfica); y el cierre transitivo de
 *   los imports de `tools/video/**` no contiene ningún `.tsx` ni `.css` ni ningún paquete
 *   que no sea `playwright` o `node:*` (nunca React, nunca un componente, nunca i18next):
 *   el script lee el núcleo, unos módulos puros de `src/ui` y los JSON de `src/locales`.
 *   La cifra de `bundle-budget` queda igual (anotada en docs/decisiones.md).
 * CONTEXTO: `tools/` está en `tsconfig.app.json` y `eslint .` lo recorre; un import
 *   accidental desde `src/` hacia `tools/video` entraría en `dist/` sin que ningún otro
 *   test lo note (tasks/plans/video.md T-I-V2).
 * EXPIRA SI: nunca.
 */
describe("test_intent_video_ships_nothing", () => {
  it("no runtime import of src/** resolves outside src/ (docs/validacion/*.json excepted)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).filter(isSource)) {
      for (const target of importsOf(file).files) {
        const ok =
          within(target, SRC) ||
          (within(target, VALIDATION_JSON) && target.endsWith(".json"));
        if (!ok)
          offenders.push(`${relative(ROOT, file)} → ${relative(ROOT, target)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the runtime closure of tools/video/** has no .tsx, no .css and no package but playwright and node:*", () => {
    const seen = new Set<string>();
    const queue = walk(VIDEO).filter(isSource);
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (/\.(tsx|css)$/.test(file)) {
        offenders.push(relative(ROOT, file));
        continue;
      }
      if (file.endsWith(".json")) continue;
      const { files, bare } = importsOf(file);
      for (const b of bare) {
        if (b !== "playwright" && !b.startsWith("node:")) {
          offenders.push(`${relative(ROOT, file)} imports ${b}`);
        }
      }
      queue.push(...files);
    }
    expect(offenders).toEqual([]);
    // The closure reaches the core and the locales, which is the point.
    const reached = [...seen].map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(reached.some((f) => f.startsWith("src/core/"))).toBe(true);
    expect(reached).toContain("src/locales/en.json");
  });
});

/**
 * test_intent_video_scenes_valid
 *
 * INTENCIÓN: las escenas se validan contra el núcleo sin navegador (tasks/plans/video.md
 *   T-V3): la tirada 2D de la semilla tiene el peso y el veredicto que la escena declara
 *   (lo que el DOM mostrará, porque `Math.random` constante hace que la app muestre
 *   exactamente `sampleNoise(p, createRng(seed2d))`), los presets y enlaces existen, el
 *   gap está en la rejilla del deslizador, cada recorrido termina en su último paso, cada
 *   clave de tarjeta existe en los dos idiomas y el vídeo dura ≤ 60 s (la cifra de H, §1).
 * CONTEXTO: un seed que diese una tirada vacía o un veredicto distinto al contado sería un
 *   vídeo que miente sin que nada lo note hasta verlo.
 * EXPIRA SI: se cambia la duración (cambia `MAX_SECONDS`) o el 2D gana una
 *   entrada determinista propia (`#s=`, §7.6).
 */
describe("test_intent_video_scenes_valid", () => {
  it("checkScenes(SCENES) finds no problem and the video lasts ≤ MAX_SECONDS", () => {
    expect(checkScenes(SCENES)).toEqual([]);
    expect(MAX_SECONDS).toBe(60);
    expect(totalSeconds(SCENES)).toBeLessThanOrEqual(MAX_SECONDS);
    expect(totalSeconds(SCENES)).toBeGreaterThan(30);
  });

  it("the steps scene's shot is what the app samples: non-empty, declared weight, declared verdict", () => {
    const scene = SCENES.find((s) => s.panel === "steps")!;
    if (scene.panel !== "steps") throw new Error("no steps scene");
    const error = sampleNoise(
      independentNoise(scene.p),
      createRng(scene.seed2d),
      identity(scene.d * scene.d),
    );
    expect(weight(error)).toBe(scene.expect.weight);
    expect(weight(error)).toBeGreaterThan(0);
    expect(weight(shotOf(scene))).toBe(scene.expect.weight);
  });

  it("the checker rejects an empty shot, a wrong verdict, a bad key, a gap off the grid and a long video", () => {
    const steps = SCENES.find((s) => s.panel === "steps")!;
    const card = SCENES.find((s) => s.panel === "card")!;
    const viewer = SCENES.find((s) => s.panel === "spacetime")!;
    if (
      steps.panel !== "steps" ||
      card.panel !== "card" ||
      viewer.panel !== "spacetime"
    ) {
      throw new Error("scenes missing");
    }
    const emptySeed = [1, 2, 6, 7, 9].find(
      (seed) => weight(shotOf({ ...steps, seed2d: seed })) === 0,
    );
    expect(emptySeed).toBeDefined();
    expect(checkScenes([{ ...steps, seed2d: emptySeed! }]).join("\n")).toMatch(
      /empty error/,
    );
    expect(
      checkScenes([{ ...steps, expect: { ...steps.expect, verdict: 1 } }]).join(
        "\n",
      ),
    ).toMatch(/verdict/);
    expect(
      checkScenes([{ ...card, lines: ["app.slogan"] }]).join("\n"),
    ).toMatch(/app\.slogan/);
    expect(checkScenes([{ ...viewer, gap: 1.5 }]).join("\n")).toMatch(
      /off the slider/,
    );
    expect(
      checkScenes([{ ...viewer, actions: viewer.actions.slice(0, -2) }]).join(
        "\n",
      ),
    ).toMatch(/"next" actions/);
    const long: Scene = { ...card, seconds: MAX_SECONDS + 1 };
    expect(checkScenes([long]).join("\n")).toMatch(/more than 60/);
  });
});

describe("video: pure helpers (T-V4)", () => {
  it("statesOf counts one state per hold and one per gap; the chart and the cards one each", () => {
    const viewer = SCENES.find((s) => s.id === "spacetime")!;
    const states = statesOf(viewer);
    if (viewer.panel !== "spacetime") throw new Error("no viewer scene");
    const holds = viewer.actions.filter((a) => a.kind !== "next").length;
    expect(states).toHaveLength(holds);
    expect(states[0]!.label).toBe("step 0");
    expect(states[states.length - 1]!.label).toBe("step 5");
    expect(statesOf(SCENES.find((s) => s.id === "title")!)).toHaveLength(1);
    expect(
      statesOf(SCENES.find((s) => s.id === "chartIndependent")!),
    ).toHaveLength(1);
  });

  it("listText repeats the last image without a duration; expectedFrames rounds Σ·fps", () => {
    const frames = [
      { file: "frames/0001.png", seconds: 1.5 },
      { file: "frames/0002.png", seconds: 0.2 },
    ];
    const text = listText(frames);
    expect(text.split("\n").filter(Boolean)).toEqual([
      "file 'frames/0001.png'",
      "duration 1.5",
      "file 'frames/0002.png'",
      "duration 0.2",
      "file 'frames/0002.png'",
    ]);
    expect(expectedFrames(frames, 30)).toBe(51);
    expect(() => listText([])).toThrow(RangeError);
  });

  it("parseArgs: defaults, and rejects a bad lang, fps 0, --dry with --frames-only, an unknown scene", () => {
    const args = parseArgs([]);
    expect(args.langs).toEqual(["en", "es"]);
    expect(args.formats).toEqual(["landscape", "portrait"]);
    expect(args.fps).toBe(30);
    expect(args.allowConsoleErrors).toBe(false);
    expect(parseArgs(["--allow-console-errors"]).allowConsoleErrors).toBe(true);
    expect(
      parseArgs([
        "--lang",
        "es",
        "--format",
        "portrait",
        "--scene",
        "spacetime",
      ]),
    ).toMatchObject({
      langs: ["es"],
      formats: ["portrait"],
      scene: "spacetime",
    });
    expect(() => parseArgs(["--lang", "fr"])).toThrow(/--lang/);
    expect(() => parseArgs(["--fps", "0"])).toThrow(/--fps/);
    expect(() => parseArgs(["--dry", "--frames-only"])).toThrow(/exclude/);
    expect(() => parseArgs(["--scene", "credits"])).toThrow(/--scene/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--loud"])).toThrow(/unknown/);
  });

  it("mimeOf and fileFor: known types, the base stripped, SPA fallback, no traversal", () => {
    expect(mimeOf("a/index.html")).toMatch(/^text\/html/);
    expect(mimeOf("x.js")).toMatch(/^text\/javascript/);
    expect(mimeOf("x.webmanifest")).toMatch(/manifest/);
    expect(mimeOf("x.unknown")).toBe("application/octet-stream");
    const dist = join(ROOT, "public");
    const index = join(dist, "index.html");
    // The build asks for every file under Vite's base (edge/paths.ts).
    expect(fileFor(dist, "/syndrome/favicon.svg")).toBe(
      join(dist, "favicon.svg"),
    );
    expect(fileFor(dist, "/syndrome/fonts/space-grotesk-var.woff2")).toBe(
      join(dist, "fonts", "space-grotesk-var.woff2"),
    );
    expect(fileFor(dist, "/syndrome/")).toBe(index);
    expect(fileFor(dist, "/syndrome/missing/route")).toBe(index);
    expect(fileFor(dist, "/syndrome/../package.json")).toBe(index);
    // Outside the base names no file, even one that exists, and is not the SPA
    // fallback either: null, answered 404 like production (a
    // 200 with index.html would hide a URL that escaped the base).
    expect(fileFor(dist, "/favicon.svg")).toBeNull();
    expect(fileFor(dist, "/")).toBeNull();
    expect(fileFor(dist, "/syndrome")).toBeNull();
    expect(fileFor(dist, "/other/route")).toBeNull();
    // A path outside the base whose tail after slicing the
    // base's length DOES exist ("/xxxxxxxx/" is as long as "/syndrome/"); only
    // the startsWith guard keeps it from being served.
    expect(fileFor(dist, "/xxxxxxxx/favicon.svg")).toBeNull();
    expect(fileFor(dist, "/x/favicon.svg", "/x/")).toBe(
      join(dist, "favicon.svg"),
    );
  });

  it("hiddenCss hides the other panels and the panel's own hidden hooks, under its root", () => {
    const css = hiddenCss("steps");
    expect(css).toContain(`.panel:not([${SHOWN_ATTRIBUTE}])`);
    for (const selector of HOOKS.steps.hidden) {
      expect(css).toContain(`${HOOKS.steps.root} ${selector}`);
    }
    expect(css).toContain(".app__header");
  });

  it("cardHtml substitutes the app's texts, escaped, and leaves no placeholder", () => {
    const outro = SCENES.find((s) => s.id === "outro")!;
    if (outro.panel !== "card") throw new Error("no outro");
    const html = cardHtml(outro, "es");
    expect(html).toContain(t("es", "app.byline"));
    expect(html).toContain("seequant.app/syndrome");
    expect(html).not.toContain("syndrome.seequant.app");
    expect(html).not.toContain("{{");
    expect(
      cardHtml({ ...outro, lines: ["app.tagline"], url: false }, "en"),
    ).toContain(t("en", "app.tagline"));
    expect(hasKey("en", "app.tagline")).toBe(true);
  });

  it("initScript fixes language, model, theme, view, gap, Math.random and removes Worker", () => {
    const script = initScript({
      lang: "es",
      model: "phenomenological",
      seed2d: 16,
      view: 1,
      gap: 2.25,
    });
    for (const key of Object.values(STORAGE_KEYS))
      expect(script).toContain(`"${key}"`);
    expect(script).toContain('"es"');
    expect(script).toContain('"phenomenological"');
    expect(script).toContain('"light"');
    expect(script).toContain("16 / 2 ** 53");
    expect(script).toContain("delete window.Worker");
  });
});

/**
 * Smoke render (T-V5), only with VIDEO_SMOKE=1: the real browser over dist/, the
 * spacetime scene captured twice at 480 × 270, every PNG byte-identical (M6).
 */
describe.skipIf(process.env.VIDEO_SMOKE !== "1")(
  "video: smoke render (VIDEO_SMOKE=1)",
  () => {
    vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
    let distDir = "";
    let built = false;
    let tmp = "";

    beforeAll(async () => {
      // The app's build directory, as the CLI uses it (tools/video/cli.ts):
      // dist/syndrome/ after `npm run build`; otherwise a fresh build to a temp dir.
      distDir = join(ROOT, "dist", APP_DIR);
      if (!existsSync(join(distDir, "index.html"))) {
        const { build } = await import("vite");
        tmp = mkdtempSync(join(tmpdir(), "syndrome-video-"));
        distDir = tmp;
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
          await build({
            root: ROOT,
            mode: "production",
            logLevel: "silent",
            build: { outDir: tmp },
          });
        } finally {
          if (previous === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = previous;
        }
        built = true;
      }
    });

    afterAll(() => {
      if (built) rmSync(tmp, { recursive: true, force: true });
    });

    it("two captures of the spacetime scene give identical frames and end on the last step", async () => {
      const { launchBrowser } = await import("../../tools/video/browser");
      const { captureVariant } = await import("../../tools/video/capture");
      const { assertDist } = await import("../../tools/video/serve");
      const scene = SCENES.find((s) => s.id === "spacetime")!;
      const launched = await launchBrowser();
      const out = mkdtempSync(join(tmpdir(), "syndrome-smoke-"));
      try {
        const hashes: string[][] = [];
        for (const run of [1, 2]) {
          const manifest = await captureVariant(
            launched.browser,
            [scene],
            "es",
            "landscape",
            join(out, `run${run}`),
            {
              fps: 30,
              distDir,
              dist: assertDist(distDir),
              browser: { channel: launched.channel, version: launched.version },
              ffmpeg: null,
              viewport: { width: 480, height: 270 },
              deviceScaleFactor: 1,
            },
          );
          expect(manifest.frames).toHaveLength(statesOf(scene).length);
          expect(manifest.consoleErrors).toEqual([]);
          hashes.push(
            manifest.frames.map((f) =>
              createHash("sha256")
                .update(readFileSync(join(out, `run${run}`, f.file)))
                .digest("hex"),
            ),
          );
          expect(manifest.frames.map((f) => f.sha256)).toEqual(hashes[run - 1]);
        }
        expect(hashes[1]).toEqual(hashes[0]);
      } finally {
        await launched.browser.close();
        rmSync(out, { recursive: true, force: true });
      }
    });
  },
);
