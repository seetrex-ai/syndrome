// The language switch of the brand bar (2026-10-20:
// moved here from Syndrome's own header). It looks like the brand site's
// (seequant.app, seetrex.com style): the two codes side by
// side in a fixed order, English first; the current one is an ink chip and
// not a control (aria-current), the other a control with a 44 × 44 px hit
// area. Each code carries its language's name, visually hidden, so it is
// heard as "ES Español". Unlike the brand site the other code is a <button>,
// not a link: the choice behaves exactly as the old segmented selector did
// (tasks/plans/syndrome-es-url.md D6): one lang_switch, the choice stored,
// the URL moved to that language's page with replaceState, query and
// fragment kept, no reload, so d, p, the chart and a challenge in play stay.
// Activating the other code replaces that button with the chip, so the focus
// would fall to <body>: after a switch made here it moves to the new chip
// (tabIndex -1: focusable by script, not a Tab stop), inside the switch
// (the old radio group kept it on the radio).
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { trackLangSwitch } from "../../analytics/events";
import { BRAND_LANGUAGE_ORDER as ORDER } from "../../brand-links";
import type { Language } from "../../locales";
import { applyLanguageChoice } from "../language-url";

export function LangSwitch({ lang }: { readonly lang: Language }) {
  const { t, i18n } = useTranslation();
  const current = useRef<HTMLSpanElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    current.current?.focus();
  }, [lang]);
  const choose = (code: Language) => {
    switched.current = true;
    trackLangSwitch(code);
    applyLanguageChoice(code);
    void i18n.changeLanguage(code);
  };
  return (
    <div className="lang-switch" role="group" aria-label={t("language.label")}>
      {ORDER.map((code) =>
        code === lang ? (
          <span
            key={code}
            ref={current}
            className="lang-switch__current"
            aria-current="true"
            tabIndex={-1}
            lang={code}
          >
            <span>{t(`language.code.${code}`)}</span>
            <span className="sr-only">{t(`language.${code}`)}</span>
          </span>
        ) : (
          <button
            key={code}
            type="button"
            className="lang-switch__option"
            lang={code}
            onClick={() => choose(code)}
          >
            <span>{t(`language.code.${code}`)}</span>
            <span className="sr-only">{t(`language.${code}`)}</span>
          </button>
        ),
      )}
    </div>
  );
}
