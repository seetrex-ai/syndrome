// Vite plugin: one index.html per language (tasks/plans/syndrome-es-url.md D1).
//
// Build: in generateBundle, once vite:build-html has emitted the final
// index.html (module entry, stylesheet, Umami counter and every other
// transformIndexHtml applied), the asset is rewritten in the base language and
// one copy is emitted per other language directory (es/index.html): all of
// them carry the same counter, manifest link and chunks. Either `enforce:
// "post"` or the hook's `order: "post"` alone puts this hook after
// vite:build-html (measured: removing one keeps the build green;
// removing both fails it with "no index.html asset"). Both are kept, so that
// neither alone is load-bearing. vite-plugin-pwa writes the service worker in
// closeBundle, after the bundle is on disk, so every copy
// is precached (H2, tests/intent/pwa-precache.test.ts).
// Dev: transformIndexHtml writes the head of the language the URL asks for.

import type { Plugin, Rolldown } from "vite";
import { LANGUAGE_DIRS } from "../../edge/paths.ts";
import { LANGUAGES, localizeHtml, pageLanguageOfUrl } from "./locale-pages.ts";

const INDEX = "index.html";

function indexAsset(bundle: Rolldown.OutputBundle): Rolldown.OutputAsset {
  const index = bundle[INDEX];
  if (index === undefined || index.type !== "asset") {
    throw new Error(`syndrome:locale-pages: no ${INDEX} asset in the bundle`);
  }
  return index;
}

export function localePagesPlugin(): Plugin[] {
  return [
    {
      name: "syndrome:locale-pages",
      apply: "build",
      enforce: "post",
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          const index = indexAsset(bundle);
          const html =
            typeof index.source === "string"
              ? index.source
              : new TextDecoder().decode(index.source);
          for (const lang of LANGUAGES) {
            const dir = LANGUAGE_DIRS[lang];
            const localized = localizeHtml(html, lang);
            if (dir === "") index.source = localized;
            else
              this.emitFile({
                type: "asset",
                fileName: `${dir}${INDEX}`,
                source: localized,
              });
          }
        },
      },
    },
    {
      name: "syndrome:locale-pages-dev",
      apply: "serve",
      transformIndexHtml(html, ctx) {
        return localizeHtml(
          html,
          pageLanguageOfUrl(ctx.originalUrl ?? ctx.path),
        );
      },
    },
  ];
}
