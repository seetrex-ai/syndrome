// Fixture for tests/intent/i18n-keys.test.ts. It is NOT under src/ui on purpose:
// the test proves it reports each key shape it claims to report and accepts
// the shapes whose key is a leaf (or a branch, for a template) of en.json.

type T = (key?: string, options?: Record<string, unknown>) => string;

function Trans({ i18nKey }: { i18nKey?: string | true }) {
  return <span>{i18nKey}</span>;
}

export function Fixture({
  n,
  lang,
  t,
  i18n,
  dynamicKey,
}: {
  n: number;
  lang: string;
  t: T;
  i18n: { t: T };
  dynamicKey: string;
}) {
  return (
    <section>
      {/* Must NOT be reported */}
      <h1>{t("grid.title")}</h1>
      <p>{t(`language.${lang}`)}</p>
      <p>{t("app.shots", { count: n })}</p>
      <p>{i18n.t("grid.hint", { count: n })}</p>
      <p>{t(n > 0 ? "grid.title" : "grid.hint")}</p>
      <Trans i18nKey="grid.title" />
      {/* Must be reported, one per line (the self-check pins the line) */}
      <p>{t("Long press for a Z error")}</p>
      <p>{t("grid.nope")}</p>
      <p>{t("grid.hint", { defaultValue: "Hello" })}</p>
      <p>{t(`nope.${lang}`)}</p>
      <p>{t(`grid.${lang}.title`)}</p>
      <p>{t(dynamicKey)}</p>
      <p>{t()}</p>
      <p>{t("grid")}</p>
      <p>{t(n > 0 ? "grid.title" : "grid.nope")}</p>
      <Trans i18nKey="grid.missing" />
      <Trans i18nKey={dynamicKey} />
      <Trans i18nKey />
    </section>
  );
}
