// Suspense fallback while the viewer chunk loads (tasks/plans/phase2-g.md D9):
// the panel's frame, so the layout does not jump. Imports nothing from this
// directory (tests/intent/deferred-loading keeps it in the initial chunk).
import { useTranslation } from "react-i18next";

export function SpacetimeSkeleton() {
  const { t } = useTranslation();
  return (
    <section
      id="panel-spacetime"
      className="panel panel--spacetime"
      aria-busy="true"
    >
      <h2>{t("spacetime.title")}</h2>
      <p className="spacetime__intro">{t("spacetime.loading")}</p>
    </section>
  );
}
