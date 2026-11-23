import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// docs/spec.md §2, rule 2: src/core is pure TypeScript that runs identically in the
// browser, a Web Worker and Node. This override is the fast, in-editor layer; the
// complete boundary (no relative import may leave src/core, no package outside an
// explicit allowlist, no DOM lib) is enforced by tests/intent/core-purity.test.ts.
const CORE_FORBIDDEN_IMPORTS = [
  "react",
  "react/*",
  "react-*",
  "react-*/**",
  "i18next",
  "i18next-*",
  "*.css",
  "*.json",
  "**/ui/**",
  "**/worker/**",
  "**/locales",
  "**/locales/**",
  "**/i18n",
  "**/main",
];

// Every global the browser has and Node does not, plus a few that exist in both
// but have no place in a simulation core.
const CORE_FORBIDDEN_GLOBALS = [
  ...Object.keys(globals.browser).filter((name) => !(name in globals.node)),
  "fetch",
];

export default tseslint.config(
  // Dot-directories hold local tool state, never source.
  // vendor/ and the taxonomy copy are byte-for-byte copies (pinned by sha256).
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      ".*/**",
      "vendor",
      "src/analytics/events.json",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ["src/core/**/*.{ts,mts,cts}"],
    rules: {
      // The core is synchronous and loads nothing lazily: no import() at all.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "src/core does not use dynamic import().",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: CORE_FORBIDDEN_IMPORTS,
              message:
                "src/core is pure TypeScript: no React, DOM, i18n or UI imports.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...CORE_FORBIDDEN_GLOBALS],
    },
  },
  {
    // The Worker (tasks/plans/ui.md D3) has no DOM and no React: it imports
    // only src/core and src/worker. Same prohibitions as the core except
    // **/worker/**; `self` is the Worker's own global (sim.worker.ts).
    // Enforced completely by tests/intent/worker-purity.test.ts.
    files: ["src/worker/**/*.{ts,mts,cts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "src/worker does not use dynamic import().",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: CORE_FORBIDDEN_IMPORTS.filter((g) => g !== "**/worker/**"),
              message:
                "src/worker imports only src/core and src/worker: no React, DOM, i18n or UI.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...CORE_FORBIDDEN_GLOBALS.filter((name) => name !== "self"),
      ],
    },
  },
  prettier,
);
