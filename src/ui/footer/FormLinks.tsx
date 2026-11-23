// The two links to the brand site's forms, interest and feedback
// (tasks/plans/analytics.md D6–D8): in the footer and at the end of a
// challenge. Same tab, `rel="noopener"`, no `target`: the tracker reports a
// same-tab click before it navigates (D5). While a form page is not published
// the link is a `mailto:` with a translated subject.
import { useTranslation } from "react-i18next";
import {
  feedbackLinkEvent,
  INTEREST_ROLE,
  interestLinkEvent,
  type FormSource,
} from "../../analytics/events";
import { FORM_PATHS, formHref } from "../../analytics/forms";
import { SUPPORTED_LANGUAGES, type Language } from "../../locales";

export interface FormLinksProps {
  /** Where the links sit; it travels as `from` in the query and in the event. */
  readonly from: FormSource;
  /** Tests inject form paths; the app uses the versioned FORM_PATHS. */
  readonly paths?: typeof FORM_PATHS;
}

export function FormLinks({ from, paths = FORM_PATHS }: FormLinksProps) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? SUPPORTED_LANGUAGES[0]) as Language;
  return (
    <ul className="form-links">
      <li>
        <a
          href={formHref(
            "feedback",
            lang,
            { from },
            t("footer.mailSubject.feedback"),
            paths,
          )}
          rel="noopener"
          {...feedbackLinkEvent(from)}
        >
          {t("footer.feedback")}
        </a>
      </li>
      <li>
        <a
          href={formHref(
            "interest",
            lang,
            { role: INTEREST_ROLE, from },
            t("footer.mailSubject.interest"),
            paths,
          )}
          rel="noopener"
          {...interestLinkEvent(from)}
        >
          {t("footer.interest")}
        </a>
      </li>
    </ul>
  );
}
