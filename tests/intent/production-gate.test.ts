import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isScalar, parseDocument, visit } from "yaml";
import { LANGUAGE_DIRS } from "../../edge/paths";
import { UMAMI_READY } from "../../tools/deploy/accounts";
import { evaluateGate, runCli } from "../../tools/deploy/check-prod";
import { websiteIdFrom } from "../../tools/deploy/umami-plugin";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = process.cwd();
const TRACKER = join(ROOT, "vendor", "umami", "script.js");
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-2222-4333-8444-555555555555";
const ENV_VAR = "VITE_UMAMI_WEBSITE_ID";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const counterTag = (id: string, src = "/syndrome/assets/umami-AbC123.js") =>
  `<script defer src="${src}" data-website-id="${id}" data-host-url="https://cloud.umami.is" data-domains="seequant.app" data-exclude-hash="true"></script>`;

type PageLanguage = keyof typeof LANGUAGE_DIRS;

interface FakeDist {
  /** Script tags prepended to <head> of every language's HTML. */
  readonly counters?: readonly string[];
  /** Per language: that page's own script tags instead, or null for no page. */
  readonly pages?: Partial<Record<PageLanguage, readonly string[] | null>>;
  /** Write assets/umami-AbC123.js: the vendored tracker, or these bytes. */
  readonly tracker?: "vendored" | string;
}

/** A staged dist/ (one HTML per language of LANGUAGE_DIRS + assets) shaped as the build leaves it. */
function fakeDist({
  counters = [],
  pages = {},
  tracker,
}: FakeDist = {}): string {
  const dist = mkdtempSync(join(tmpdir(), "syndrome-gate-"));
  temps.push(dist);
  const app = join(dist, "syndrome");
  mkdirSync(join(app, "assets"), { recursive: true });
  for (const [lang, dir] of Object.entries(LANGUAGE_DIRS)) {
    const own = pages[lang as PageLanguage];
    if (own === null) continue;
    mkdirSync(join(app, dir), { recursive: true });
    writeFileSync(
      join(app, dir, "index.html"),
      `<!doctype html><html lang="${lang}"><head>${(own ?? counters).join("")}<meta charset="UTF-8" /><script>/* theme */</script><script type="module" crossorigin src="/syndrome/assets/index-x.js"></script></head><body></body></html>`,
    );
  }
  if (tracker === "vendored")
    copyFileSync(TRACKER, join(app, "assets", "umami-AbC123.js"));
  else if (tracker !== undefined)
    writeFileSync(join(app, "assets", "umami-AbC123.js"), tracker);
  return dist;
}

const MAIN = "github.ref == 'refs/heads/main'";
const NOT_MAIN = "github.ref != 'refs/heads/main'";
const HAS_TOKEN = "env.CLOUDFLARE_API_TOKEN != ''";
const REPO_VAR = "${{ vars.VITE_UMAMI_WEBSITE_ID }}";
const SETUP_NODE = { "node-version-file": ".nvmrc", cache: "npm" };
const BUILD_MAIN = "build (main, with analytics)";
const GATE = "production gate (main)";

/**
 * The `deploy` job of ci.yml, written out literally: exactly what the parsed
 * file must hold, every key of the job and of each step (anything absent
 * here, such as `continue-on-error`, `shell`, `working-directory`, `with`,
 * `strategy` or an extra step, must be absent there too). A legitimate change
 * to the deploy path changes this object, consciously, in the same commit.
 */
const EXPECTED_DEPLOY = {
  name: "deploy to Cloudflare",
  needs: "check",
  if: "github.event_name == 'push'",
  "runs-on": "ubuntu-latest",
  env: {
    CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
  },
  steps: [
    { uses: "actions/checkout@v7" },
    { uses: "actions/setup-node@v7", with: SETUP_NODE },
    { run: "npm ci" },
    {
      name: BUILD_MAIN,
      if: MAIN,
      run: "npm run build",
      env: { [ENV_VAR]: REPO_VAR },
    },
    {
      name: "build (other branches, no analytics)",
      if: NOT_MAIN,
      run: "npm run build",
    },
    {
      name: GATE,
      if: `${HAS_TOKEN} && ${MAIN}`,
      run: "npm run check:prod -- --production",
      env: { [ENV_VAR]: REPO_VAR },
    },
    {
      name: "production (main)",
      if: `${HAS_TOKEN} && ${MAIN}`,
      run: "npx wrangler deploy",
    },
    {
      name: "preview (other branches)",
      if: `${HAS_TOKEN} && ${NOT_MAIN}`,
      run: 'npx wrangler versions upload --tag "${GITHUB_REF_NAME//\\//-}" --message "${GITHUB_SHA::7}"',
    },
    {
      name: "secrets missing",
      if: "env.CLOUDFLARE_API_TOKEN == ''",
      run: "echo \"CLOUDFLARE_API_TOKEN not set; deploy skipped (local 'npm run deploy' still works).\"",
    },
  ],
};

interface CiStep {
  file: string;
  job: string;
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  /** Workflow env, then job env, then step env (later wins), as Actions merges them. */
  effectiveEnv: Map<string, string>;
}

interface Workflow {
  /** The parsed file, as plain data. */
  data: YamlMap;
  /** Every step of every job. */
  steps: CiStep[];
}

const WORKFLOWS = join(ROOT, ".github", "workflows");
const readCi = (): string => readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
/** Every workflow file (`*.yml` and `*.yaml`), by file name, sorted. */
const readWorkflows = (): Map<string, string> =>
  new Map(
    readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort()
      .map((f) => [f, readFileSync(join(WORKFLOWS, f), "utf8")]),
  );
/** Every workflow parsed, with its steps labelled `file/job/name`. */
const parseAll = (): Map<string, Workflow> =>
  new Map(
    [...readWorkflows()].map(([file, text]) => [
      file,
      parseWorkflow(text, file),
    ]),
  );
const allSteps = (): CiStep[] =>
  [...parseAll().values()].flatMap((w) => w.steps);
const label = (s: CiStep) => `${s.file}/${s.job}/${s.name}`;

type YamlMap = Record<string, unknown>;
const isMap = (v: unknown): v is YamlMap =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const scalar = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v).trim();

/** An `env:` mapping (block or flow, quoted keys or not); absent = empty. */
function envOf(node: YamlMap, where: string): Map<string, string> {
  const raw = node.env;
  if (raw === undefined || raw === null) return new Map();
  // `env: ${{ fromJSON(...) }}` or any other non-map would hide what it sets.
  if (!isMap(raw)) throw new Error(`env of ${where} must be a mapping`);
  return new Map(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}

/**
 * A workflow parsed with a real YAML parser (so every spelling of `env:`,
 * block or flow map, quoted keys, is seen as Actions sees it), with every step
 * of every job and its effective environment. A job that calls a reusable
 * workflow (`uses:` at job level, no steps) counts as one step with that
 * `uses`.
 *
 * Anchors, aliases and `<<` keys are rejected outright rather than resolved:
 * the files do not need them, YAML 1.2 (this parser's default) reads `<<` as
 * a literal key while YAML 1.1 tools merge it, and GitHub's own handling of
 * anchors is recent; rejecting them leaves one reading of the file, the
 * literal one, so the parser and Actions cannot disagree about it.
 */
function parseWorkflow(text: string, file = "ci.yml"): Workflow {
  // Any error or warning (an unresolved tag such as `if: !cancelled() && …`,
  // which silently drops the function; a duplicate key) fails rather than
  // parse around it.
  const doc = parseDocument(text);
  const issues = [...doc.errors, ...doc.warnings].map((e) => e.message);
  visit(doc, {
    Alias(_, node) {
      issues.push(`alias *${node.source}`);
    },
    Node(_, node) {
      if (node.anchor) issues.push(`anchor &${node.anchor}`);
    },
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === "<<")
        issues.push("merge key <<");
    },
  });
  if (issues.length > 0) throw new Error(`${file}: ${issues.join("; ")}`);
  const data: unknown = doc.toJS();
  if (!isMap(data)) throw new Error(`${file}: not a mapping`);
  if (!isMap(data.jobs)) throw new Error(`${file}: no jobs`);
  const workflowEnv = envOf(data, `${file}, the workflow`);
  const steps: CiStep[] = [];
  for (const [jobId, job] of Object.entries(data.jobs)) {
    if (!isMap(job)) throw new Error(`${file}: job ${jobId} is not a mapping`);
    const jobEnv = envOf(job, `${file}, job ${jobId}`);
    if (job.steps === undefined && typeof job.uses === "string") {
      steps.push({
        file,
        job: jobId,
        name: scalar(job.name),
        if: scalar(job.if),
        uses: scalar(job.uses),
        effectiveEnv: new Map([...workflowEnv, ...jobEnv]),
      });
      continue;
    }
    if (!Array.isArray(job.steps))
      throw new Error(`${file}: job ${jobId} has no steps`);
    job.steps.forEach((raw: unknown, i) => {
      const where = `${file}, step ${i} of ${jobId}`;
      if (!isMap(raw)) throw new Error(`${where} is not a mapping`);
      steps.push({
        file,
        job: jobId,
        name: scalar(raw.name),
        if: scalar(raw.if),
        run: scalar(raw.run),
        uses: scalar(raw.uses),
        effectiveEnv: new Map([
          ...workflowEnv,
          ...jobEnv,
          ...envOf(raw, where),
        ]),
      });
    });
  }
  return { data, steps };
}

/** Occurrences of `needle` anywhere in the text, comments included, any case
 * (GitHub contexts are case-insensitive: `vars.vite_umami_website_id` works). */
const count = (text: string, needle: string): number =>
  text.toLowerCase().split(needle.toLowerCase()).length - 1;

/**
 * Every place of the parsed data (`jobs.deploy.env.X`, a key path) whose
 * string reads the `secrets` or `vars` context: inside a `${{ … }}` anywhere,
 * or anywhere in an `if:` (an implicit expression). Keys are checked too.
 */
function contextReads(data: unknown, ctx: "secrets" | "vars"): string[] {
  const word = new RegExp(`\\b${ctx}\\b`, "i");
  const reads = (s: string, isIf: boolean) =>
    isIf
      ? word.test(s)
      : [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((m) => word.test(m[1]!));
  const found: string[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === "string") {
      if (reads(v, path.at(-1) === "if")) found.push(path.join("."));
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, String(i)]));
    } else if (isMap(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (reads(k, false)) found.push([...path, `<key ${k}>`].join("."));
        walk(x, [...path, k]);
      }
    }
  };
  walk(data, []);
  return found;
}
const env = (id?: string) => (id === undefined ? {} : { [ENV_VAR]: id });

/**
 * test_intent_production_gate
 *
 * INTENCIÓN: producción sólo recibe un `dist/` coherente con el estado de la analítica
 *   (tasks/plans/analytics.md D9, T-I7). Con `UMAMI_READY = false` (decisión del
 *   2026-10-19, §9.1) se despliega sin analítica avisando; el día que sea
 *   `true`, la falta del ID bloquea. Con ID, CADA HTML de idioma del `dist` (`index.html` y
 *   `es/index.html`, tasks/plans/syndrome-es-url.md D8; uno que falte bloquea) debe llevar
 *   exactamente un contador con ese ID y el sha256 fijado; un `dist` con contador y sin ID
 *   también bloquea. La
 *   puerta corre antes de `wrangler deploy` en `npm run deploy` y en el paso de producción
 *   de CI. La variable del repo llega a todo paso de `main` que la lee (el build de
 *   producción y la puerta: si sólo la viera el build, la puerta bloquearía cada push con
 *   `UMAMI_READY = true`, como llegó a pasar); el build de los previews
 *   (`wrangler versions upload`) no la ve, así que nunca cuentan. En CI esto se fija por
 *   ESTRUCTURA, no regla a regla: el job `deploy` parseado (parser YAML real, `yaml`)
 *   debe ser idéntico a `EXPECTED_DEPLOY`, escrito literal en este test (cada clave del
 *   job y de cada paso: `if`, `run`, `env`, `with`, y la ausencia de `continue-on-error`,
 *   `shell`, `working-directory`, `strategy` o pasos extra), así que una puerta en rojo
 *   detiene el job antes de `wrangler deploy` y nada se cuela entre ambos. Además, en
 *   TODOS los workflows (`.github/workflows/*.yml|*.yaml`), por CAPACIDAD y no por
 *   nombre de comando: desplegar exige la credencial, así que las únicas lecturas de los
 *   contextos `secrets` y `vars` (dentro de `${{ }}` o en un `if:`, en cualquier valor o
 *   clave) son las cuatro de `deploy` en `ci.yml` (el `env` del job con los dos secretos
 *   de Cloudflare y el `env` del build de `main` y de la puerta con el ID), con cuenta
 *   exacta en el texto (`secrets.CLOUDFLARE_` 2 veces y el nombre de la variable 4, sin
 *   distinguir mayúsculas; 0 en los demás ficheros) y sin `secrets: inherit` ni clave
 *   `secrets` en ningún job: un `wrangler` con otro nombre (script npm renombrado, acción
 *   local, una barra intercalada en el nombre) no puede desplegar sin ella. Además, en
 *   todos los workflows: `wrangler deploy`, `wrangler versions upload` y la puerta corren
 *   en un único paso cada uno, todos en `deploy` de `ci.yml` (cinturón: ningún otro paso
 *   nombra `wrangler` ni `npm run deploy`, tampoco con comillas o barras intercaladas, y
 *   no hay acciones ni workflows reutilizables locales, cuyo código el test no lee); el
 *   entorno efectivo (workflow + job + paso) de TODOS los pasos sólo da la variable al
 *   build de `main` y a la puerta; `ci.yml` no lleva `env:` ni `defaults:`; y anclas,
 *   alias, claves `<<` y etiquetas sin resolver se rechazan (una sola lectura del
 *   fichero, la literal, sin que el parser y Actions puedan discrepar).
 *   MODELO DE AMENAZA: protege contra cambios ACCIDENTALES de CI que filtren el ID a un
 *   build que no debe contarlo o desplieguen saltándose la puerta; NO contra una edición
 *   maliciosa de los workflows (quien puede editarlos puede editar también este test),
 *   que es asunto de la revisión de código.
 * CONTEXTO: CI despliega `main` en cada push; bloquear ya congelaría producción hasta abrir
 *   Umami, y no comprobar nada dejaría que una variable borrada por error desplegara sin
 *   analítica sin que nadie lo viera, o que un `dist` viejo subiera con otro ID. Las
 *   reglas ad hoc anteriores (regex de `always()`, `continue-on-error`, orden de pasos)
 *   dejaban en verde otro job con `needs: deploy` que desplegaba,
 *   `(success() || true) &&`, `shell: bash -c 'exit 0' {0}`, un ancla `&umami`
 *   reutilizada en el preview y un `vite build` entre la puerta y el despliegue
 *   (comprobado el 2026-10-19); la forma literal los cierra todos de una vez. Después
 *   aparecieron caminos fuera de `deploy` que la búsqueda de `wrangler`
 *   por texto no veía (acción local, script npm renombrado, nombre con barra intercalada,
 *   la credencial en `check`, `validate.yml`, que no se leía): de ahí la regla por
 *   capacidad.
 * EXPIRA SI: Syndrome deja de usar Umami, o el despliegue deja de pasar por
 *   `npm run deploy` / el job `deploy` de `ci.yml`. Cualquier cambio legítimo del job
 *   `deploy` (versión de una acción, un paso nuevo, otra condición) pone este test en
 *   rojo A PROPÓSITO: se actualiza `EXPECTED_DEPLOY` en el mismo commit, a conciencia,
 *   comprobando que la puerta sigue deteniendo el despliegue.
 */
describe("test_intent_production_gate", () => {
  describe("the D9 table (evaluateGate)", () => {
    it("UMAMI_READY false, no ID, 0 counters: passes with the provisional warning", () => {
      const r = evaluateGate({ ready: false, env: env(), distDir: fakeDist() });
      expect(r.ok).toBe(true);
      expect(r.warnings.join(" ")).toMatch(/without analytics.*2026-10-19/);
    });

    it("an empty or blank ID (an unset CI variable) counts as absent", () => {
      for (const blank of ["", "  "]) {
        const r = evaluateGate({
          ready: false,
          env: env(blank),
          distDir: fakeDist(),
        });
        expect(r.ok, JSON.stringify(blank)).toBe(true);
      }
      expect(
        evaluateGate({ ready: true, env: env(""), distDir: fakeDist() }).ok,
      ).toBe(false);
    });

    it("UMAMI_READY false, a UUID, one counter with it and the pinned tracker: passes, asking to set UMAMI_READY", () => {
      const r = evaluateGate({
        ready: false,
        env: env(ID),
        distDir: fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
      });
      expect(r.blocks).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.warnings.join(" ")).toMatch(/UMAMI_READY = true/);
    });

    it("UMAMI_READY true with the ID and a coherent dist: passes without warnings", () => {
      const r = evaluateGate({
        ready: true,
        env: env(ID),
        distDir: fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
      });
      expect(r).toEqual({ ok: true, blocks: [], warnings: [] });
    });

    it("UMAMI_READY true without the ID: blocks (whatever dist holds)", () => {
      for (const distDir of [
        fakeDist(),
        fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
      ]) {
        const r = evaluateGate({ ready: true, env: env(), distDir });
        expect(r.ok).toBe(false);
        expect(r.blocks.join(" ")).toMatch(/UMAMI_READY is true/);
      }
    });

    it("an ID that is not a UUID blocks, ready or not", () => {
      for (const ready of [false, true]) {
        const r = evaluateGate({
          ready,
          env: env("not-a-uuid"),
          distDir: fakeDist({
            counters: [counterTag("not-a-uuid")],
            tracker: "vendored",
          }),
        });
        expect(r.ok).toBe(false);
        expect(r.blocks.join(" ")).toMatch(/must be a UUID/);
      }
    });

    it("with the ID: 0 counters, 2 counters, another ID, another tracker or a missing file block", () => {
      const cases: Record<string, string> = {
        "0 counters": fakeDist({ tracker: "vendored" }),
        "2 counters": fakeDist({
          counters: [counterTag(ID), counterTag(ID)],
          tracker: "vendored",
        }),
        "another ID": fakeDist({
          counters: [counterTag(OTHER_ID)],
          tracker: "vendored",
        }),
        "another tracker": fakeDist({
          counters: [counterTag(ID)],
          tracker: "console.log('not umami')",
        }),
        "missing file": fakeDist({ counters: [counterTag(ID)] }),
        "src outside the app": fakeDist({
          counters: [counterTag(ID, "https://cloud.umami.is/script.js")],
          tracker: "vendored",
        }),
      };
      for (const [name, distDir] of Object.entries(cases)) {
        for (const ready of [false, true]) {
          const r = evaluateGate({ ready, env: env(ID), distDir });
          expect(r.ok, `${name}, ready ${ready}`).toBe(false);
        }
      }
    });

    it("UMAMI_READY false, no ID, but a counter in dist: blocks (inconsistent dist)", () => {
      for (const counter of [
        counterTag(ID),
        // A counter without the ID attribute is still a counter.
        `<script defer src="/syndrome/assets/umami-AbC123.js"></script>`,
      ]) {
        const r = evaluateGate({
          ready: false,
          env: env(),
          distDir: fakeDist({ counters: [counter], tracker: "vendored" }),
        });
        expect(r.ok).toBe(false);
      }
    });

    it("every language's HTML is checked on its own: a Spanish page without the counter, with another, with two, or missing blocks (tasks/plans/syndrome-es-url.md D8)", () => {
      expect(LANGUAGE_DIRS.es).toBe("es/");
      const right = [counterTag(ID)];
      const cases: Record<string, FakeDist> = {
        "es without the counter": { counters: right, pages: { es: [] } },
        "es with another ID": {
          counters: right,
          pages: { es: [counterTag(OTHER_ID)] },
        },
        "es with two counters": {
          counters: right,
          pages: { es: [counterTag(ID), counterTag(ID)] },
        },
        "es missing": { counters: right, pages: { es: null } },
        "en without the counter, es right": {
          counters: right,
          pages: { en: [] },
        },
      };
      for (const [name, shape] of Object.entries(cases)) {
        for (const ready of [false, true]) {
          const r = evaluateGate({
            ready,
            env: env(ID),
            distDir: fakeDist({ ...shape, tracker: "vendored" }),
          });
          expect(r.ok, `${name}, ready ${ready}`).toBe(false);
          expect(r.blocks.join(" "), name).toMatch(/index\.html/);
        }
      }
      // Control: both pages right pass.
      expect(
        evaluateGate({
          ready: true,
          env: env(ID),
          distDir: fakeDist({ counters: right, tracker: "vendored" }),
        }),
      ).toEqual({ ok: true, blocks: [], warnings: [] });
      // Without the ID: a counter on the Spanish page alone blocks, and so
      // does a missing Spanish page.
      for (const pages of [{ es: right }, { es: null }]) {
        const r = evaluateGate({
          ready: false,
          env: env(),
          distDir: fakeDist({ pages, tracker: "vendored" }),
        });
        expect(r.ok, JSON.stringify(pages)).toBe(false);
      }
    });

    it("no dist/syndrome/index.html: blocks (build first)", () => {
      const empty = mkdtempSync(join(tmpdir(), "syndrome-gate-empty-"));
      temps.push(empty);
      expect(
        evaluateGate({ ready: false, env: env(), distDir: empty }).ok,
      ).toBe(false);
    });
  });

  describe("the CLI (exit codes)", () => {
    const quiet = () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    };
    const withoutIdInProcess = <T>(fn: () => T): T => {
      const previous = process.env[ENV_VAR];
      delete process.env[ENV_VAR];
      try {
        return fn();
      } finally {
        if (previous !== undefined) process.env[ENV_VAR] = previous;
        vi.restoreAllMocks();
      }
    };
    const emptyEnvDir = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "syndrome-gate-env-"));
      temps.push(dir);
      return dir;
    };

    it("a passing dist exits 0 with and without --production", () => {
      withoutIdInProcess(() => {
        quiet();
        const args = ["--dist", fakeDist(), "--env-dir", emptyEnvDir()];
        expect(runCli(args, false)).toBe(0);
        expect(runCli([...args, "--production"], false)).toBe(0);
      });
    });

    it("a blocking state exits 1 only with --production", () => {
      withoutIdInProcess(() => {
        quiet();
        const args = [
          "--dist",
          fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
          "--env-dir",
          emptyEnvDir(),
        ];
        expect(runCli(args, false)).toBe(0);
        expect(runCli([...args, "--production"], false)).toBe(1);
        expect(
          runCli(
            ["--dist", fakeDist(), "--env-dir", emptyEnvDir(), "--production"],
            true,
          ),
        ).toBe(1);
      });
    });

    it("reads the ID as Vite does: from .env.production.local of the env dir", () => {
      withoutIdInProcess(() => {
        quiet();
        const envDir = emptyEnvDir();
        writeFileSync(
          join(envDir, ".env.production.local"),
          `${ENV_VAR}=${ID}\n`,
        );
        const coherent = fakeDist({
          counters: [counterTag(ID)],
          tracker: "vendored",
        });
        expect(
          runCli(
            ["--dist", coherent, "--env-dir", envDir, "--production"],
            true,
          ),
        ).toBe(0);
        // The same env dir against a dist built without the ID.
        expect(
          runCli(
            ["--dist", fakeDist(), "--env-dir", envDir, "--production"],
            true,
          ),
        ).toBe(1);
      });
    });

    // Independent of the versioned UMAMI_READY: a consistent ID + counter passes
    // under either value, a counter without the ID blocks under either value.
    it("the script entry point (npm run check:prod) propagates the exit code", () => {
      const withoutId = { ...process.env };
      delete withoutId[ENV_VAR];
      const run = (
        dist: string,
        extra: string[],
        childEnv: NodeJS.ProcessEnv = withoutId,
      ) =>
        spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            join(ROOT, "tools", "deploy", "check-prod.ts"),
            "--dist",
            dist,
            "--env-dir",
            emptyEnvDir(),
            ...extra,
          ],
          { cwd: ROOT, env: childEnv, encoding: "utf8" },
        );
      const pass = run(
        fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
        ["--production"],
        { ...withoutId, [ENV_VAR]: ID },
      );
      expect(pass.status, pass.stderr).toBe(0);
      const block = run(
        fakeDist({ counters: [counterTag(ID)], tracker: "vendored" }),
        ["--production"],
      );
      expect(block.status).toBe(1);
      expect(block.stderr).toMatch(/BLOCK/);
    });
  });

  describe("wiring", () => {
    it("package.json: check:prod runs the gate, and deploy runs it between build and wrangler deploy", () => {
      const pkg = JSON.parse(
        readFileSync(join(ROOT, "package.json"), "utf8"),
      ) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts["check:prod"]).toBe("tsx tools/deploy/check-prod.ts");
      expect(pkg.scripts.deploy).toBe(
        "npm run build && tsx tools/deploy/check-prod.ts --production && wrangler deploy",
      );
    });

    it("ci.yml: the deploy job is exactly the pinned one, and the workflow sets no env or defaults around it", () => {
      const { data } = parseWorkflow(readCi());
      // No workflow-level env, defaults (a `run.shell` there would reach the
      // gate) or anything else beyond these keys.
      expect(Object.keys(data).sort()).toEqual(
        ["jobs", "name", "on", "permissions"].sort(),
      );
      expect(
        (data.jobs as YamlMap).deploy,
        "job deploy of ci.yml differs from EXPECTED_DEPLOY: if the change to job deploy is intentional, update EXPECTED_DEPLOY in the same commit (and check the gate still stops the deploy)",
      ).toStrictEqual(EXPECTED_DEPLOY);
    });

    it("every workflow: the Cloudflare credentials and the ID are read only where job deploy of ci.yml reads them today, and nothing inherits secrets", () => {
      const texts = readWorkflows();
      expect([...texts.keys()]).toContain("ci.yml");
      const parsed = parseAll();
      const reads = (ctx: "secrets" | "vars") =>
        [...parsed].flatMap(([file, w]) =>
          contextReads(w.data, ctx).map((p) => `${file}:${p}`),
        );
      // By capability: deploying needs the token, so whatever runs wrangler
      // (a renamed npm script, a local action, an escaped command) is harmless
      // without it. The only reads of any secret or variable, in any workflow,
      // are the four pinned in EXPECTED_DEPLOY.
      expect(reads("secrets")).toEqual([
        "ci.yml:jobs.deploy.env.CLOUDFLARE_API_TOKEN",
        "ci.yml:jobs.deploy.env.CLOUDFLARE_ACCOUNT_ID",
      ]);
      expect(reads("vars")).toEqual([
        `ci.yml:jobs.deploy.steps.3.env.${ENV_VAR}`,
        `ci.yml:jobs.deploy.steps.5.env.${ENV_VAR}`,
      ]);
      for (const [file, text] of texts) {
        const ci = file === "ci.yml";
        // Belt over the parser, on the raw text (comments included): exact
        // mentions, so a `>> $GITHUB_ENV`, a comment or another file shows up.
        expect(count(text, "secrets.CLOUDFLARE_"), file).toBe(ci ? 2 : 0);
        expect(count(text, ENV_VAR), file).toBe(ci ? 4 : 0);
        expect(text, file).not.toMatch(/secrets\s*:\s*inherit/i);
        for (const [jobId, job] of Object.entries(
          parsed.get(file)!.data.jobs as YamlMap,
        ))
          expect(
            isMap(job) && "secrets" in job,
            `${file}: job ${jobId} passes secrets`,
          ).toBe(false);
      }
    });

    it("every workflow: wrangler deploy, wrangler versions upload and the gate each run in one step, all in job deploy of ci.yml; no local actions", () => {
      const steps = allSteps();
      // Quotes and backslashes removed, as the shell would: `wr\angler`,
      // `"wr"angler`.
      const plain = (s?: string) => (s ?? "").replace(/[\\'"]/g, "");
      const where = (re: RegExp) =>
        steps
          .filter((s) => re.test(plain(s.run)) || re.test(plain(s.uses)))
          .map(label);
      expect(where(/wrangler\s+deploy/)).toEqual([
        "ci.yml/deploy/production (main)",
      ]);
      expect(where(/wrangler\s+versions\s+upload/)).toEqual([
        "ci.yml/deploy/preview (other branches)",
      ]);
      expect(where(/check:prod|check-prod/)).toEqual([`ci.yml/deploy/${GATE}`]);
      // Belt (the credential rule above already makes these harmless): any
      // other road to Cloudflare by name (`npm run deploy`, a wrangler action,
      // `wrangler publish`, …) outside job deploy (pinned whole), and local
      // actions or reusable workflows, whose code this test does not read.
      expect(
        where(/wrangler|npm\s+run\s+deploy/).filter(
          (s) => !s.startsWith("ci.yml/deploy/"),
        ),
      ).toEqual([]);
      expect(where(/^\.{0,2}\//)).toEqual([]);
    });

    it("every workflow: of all the steps of all the jobs, only main's build and the gate see the ID, as the repo variable", () => {
      const seeing = allSteps().filter((s) => s.effectiveEnv.has(ENV_VAR));
      expect(seeing.map(label)).toEqual([
        `ci.yml/deploy/${BUILD_MAIN}`,
        `ci.yml/deploy/${GATE}`,
      ]);
      for (const s of seeing) {
        expect(s.effectiveEnv.get(ENV_VAR), `env of "${s.name}"`).toBe(
          REPO_VAR,
        );
      }
    });

    it("ci.yml: anchors, aliases, merge keys and unresolved tags are rejected, not parsed around", () => {
      const base = readCi();
      const mutants = {
        anchor: base.replace(
          "        env:\n          VITE_UMAMI",
          "        env: &umami\n          VITE_UMAMI",
        ),
        "merge key": base.replace(
          "        if: github.ref != 'refs/heads/main'\n        run: npm run build\n",
          "        if: github.ref != 'refs/heads/main'\n        run: npm run build\n        env: { <<: { A: b } }\n",
        ),
        tag: base.replace(`if: ${HAS_TOKEN} && ${MAIN}`, `if: !cancelled()`),
      };
      for (const [name, text] of Object.entries(mutants)) {
        expect(text, name).not.toBe(base);
        expect(() => parseWorkflow(text), name).toThrow(/ci\.yml:/);
      }
    });

    it("ci.yml, simulated: main's build with its env, then the gate with its env, passes under the versioned UMAMI_READY; the preview build sees no ID", () => {
      const { steps } = parseWorkflow(readCi());
      const step = (name: string): CiStep => {
        const found = steps.find((s) => s.job === "deploy" && s.name === name);
        expect(found, name).toBeDefined();
        return found!;
      };
      // GitHub expands ${{ vars.VITE_UMAMI_WEBSITE_ID }} to the repo variable
      // (here the test UUID); a variable missing from a step's env is absent.
      const resolved = (s: CiStep) => {
        const value = s.effectiveEnv.get(ENV_VAR);
        return env(value === REPO_VAR ? ID : value);
      };
      // The build injects exactly one counter iff it sees the ID (umamiPlugin
      // through websiteIdFrom); dist/ is modelled accordingly.
      const built = (s: CiStep): string => {
        const id = websiteIdFrom(resolved(s));
        return id === undefined
          ? fakeDist()
          : fakeDist({ counters: [counterTag(id)], tracker: "vendored" });
      };
      const gate = evaluateGate({
        ready: UMAMI_READY,
        env: resolved(step(GATE)),
        distDir: built(step(BUILD_MAIN)),
      });
      expect(gate.blocks).toEqual([]);
      expect(gate.ok).toBe(true);
      expect(
        websiteIdFrom(resolved(step("build (other branches, no analytics)"))),
        "the preview build sees no ID",
      ).toBeUndefined();
    });
  });
});
