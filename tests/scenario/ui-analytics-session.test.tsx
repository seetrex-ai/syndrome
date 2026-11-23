// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetChartEngagementForTests } from "../../src/analytics/engagement";
import {
  APP_LANGUAGE_SESSION_KEY,
  reportAppLanguage,
} from "../../src/analytics/session";
import { taxonomyProblems } from "../../src/analytics/taxonomy";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { fakeWorkerFactory } from "../helpers/fake-worker";

// The chart is a lazy chunk: imported once so the waits below wait for a
// render, not a cold import().
beforeAll(async () => {
  await import("../../src/ui/chart/ChartPanel");
});

/** A controllable IntersectionObserver (SectionNav uses one too). */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly targets: Element[] = [];
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** Puts the chart's figure fully on screen for whichever observer watches it. */
function showChart() {
  const figure = document.querySelector("figure.chart")!;
  for (const observer of FakeObserver.instances) {
    if (!observer.targets.includes(figure)) continue;
    observer.callback(
      [
        {
          target: figure,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      observer as unknown as IntersectionObserver,
    );
  }
}

/** sessionStorage of one tab, in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  FakeObserver.instances = [];
  resetChartEngagementForTests();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetChartEngagementForTests();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

// The other language's button of the brand bar's switch.
const languageRadio = (code: string) =>
  screen.getByRole("button", {
    name: new RegExp(i18n.t(`language.${code}`)),
  });

/**
 * test_scenario_session_without_and_with_tracker
 *
 * Una sesión entera con la App real (tasks/plans/analytics.md T-S2, D5, D11, D12).
 * Sin contador (desarrollo, previews, producción sin cuenta): la App arranca sin
 * errores, no se emite nada, no se marca la sesión y los enlaces del pie llevan a los
 * formularios de la web de marca (publicados el 2026-10-20) en el idioma elegido. Con
 * contador: `app_language` una vez (un segundo arranque en la misma pestaña no lo
 * repite); un cambio de idioma por código (detección) no es `lang_switch`, el gesto en
 * el selector sí, una vez, y no repite `app_language`; la gráfica 15 s en pantalla da
 * un `chart_engaged`. Todo pasa el validador.
 */
describe("test_scenario_session_without_and_with_tracker", () => {
  it("without the tracker: the app runs, nothing is sent or marked, links open the brand forms", async () => {
    vi.stubGlobal("umami", undefined);
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const errors = vi.spyOn(console, "error");
    const storage = memoryStorage();
    reportAppLanguage(i18n, () => storage);
    expect(storage.getItem(APP_LANGUAGE_SESSION_KEY)).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App createWorker={fakeWorkerFactory().create} />);
    await screen.findByRole("radio", {
      name: i18n.t("chart.modelSelect.independent"),
    });
    act(() => showChart());
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    fireEvent.click(languageRadio("es"));
    await act(async () => {});

    expect(errors).not.toHaveBeenCalled();
    const hrefs = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        ".app__footer .form-links a",
      ),
    ].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "https://seequant.app/es/opinion/?lang=es&from=syndrome_footer",
      "https://seequant.app/es/interes/?role=other&lang=es&from=syndrome_footer",
    ]);
  });

  it("with the tracker: app_language once, lang_switch on the gesture only, chart_engaged once", async () => {
    const calls: { name: string; props: Record<string, string> }[] = [];
    vi.stubGlobal("umami", {
      track: (name: string, props: Record<string, string>) => {
        calls.push({ name, props: { ...props } });
      },
    });
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const named = (name: string) => calls.filter((c) => c.name === name);

    // Arranque (src/main.tsx): once per tab session.
    const storage = memoryStorage();
    reportAppLanguage(i18n, () => storage);
    expect(named("app_language")).toEqual([
      { name: "app_language", props: { lang: i18n.resolvedLanguage! } },
    ]);
    reportAppLanguage(i18n, () => storage);
    expect(named("app_language")).toHaveLength(1);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App createWorker={fakeWorkerFactory().create} />);
    await screen.findByRole("radio", {
      name: i18n.t("chart.modelSelect.independent"),
    });

    // A language change that is no gesture (detection, code) is not a switch.
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(named("lang_switch")).toEqual([]);

    // The gesture: one switch. The language already chosen is not a control
    // in the brand bar's switch: nothing to click, no switch.
    await act(async () => {
      fireEvent.click(languageRadio("es"));
    });
    expect(i18n.resolvedLanguage).toBe("es");
    expect(screen.queryByRole("button", { name: /Español/ })).toBeNull();
    expect(
      document.querySelector(".lang-switch [aria-current]")?.textContent,
    ).toBe("ESEspañol");
    expect(named("lang_switch")).toEqual([
      { name: "lang_switch", props: { to: "es" } },
    ]);
    expect(named("app_language")).toHaveLength(1);

    // The chart, 15 s on screen with the tab visible.
    act(() => showChart());
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(named("chart_engaged")).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(named("chart_engaged")).toEqual([
      { name: "chart_engaged", props: { model: "independent" } },
    ]);

    expect(calls).toHaveLength(3);
    for (const { name, props } of calls) {
      expect(taxonomyProblems(name, props)).toEqual([]);
    }
  });
});
