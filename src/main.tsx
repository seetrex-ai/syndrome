import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reportAppLanguage } from "./analytics/session";
import i18n from "./i18n";
import "./index.css";
import { App } from "./ui/App";

// Keep <html lang> and the title in sync for screen readers, hyphenation,
// search engines and the tab (tasks/plans/syndrome-es-url.md D5: the page's
// head is written per language at build time; a language change in the open
// tab updates both). Never a redirect: /syndrome/ stays /syndrome/ whatever
// the stored or browser language (test_intent_root_never_redirects_by_language).
const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.title = i18n.t("meta.title", { lng: language });
};
syncDocumentLanguage(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", syncDocumentLanguage);

// app_language, once per tab session (tasks/plans/analytics.md D11).
reportAppLanguage(i18n);

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element in index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
