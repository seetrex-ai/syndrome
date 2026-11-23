import { describe, expect, it } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME,
  effectiveTheme,
  readStoredTheme,
  storeTheme,
  THEME_STORAGE_KEY,
} from "./theme";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const throwing: Storage = {
  length: 0,
  clear: () => {
    throw new Error("denied");
  },
  getItem: () => {
    throw new Error("denied");
  },
  key: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

class FakeRoot {
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
}

describe("readStoredTheme", () => {
  it("returns the stored light/dark choice", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme(storage)).toBe("dark");
    storage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("falls back to auto when nothing, garbage or no storage", () => {
    expect(readStoredTheme(new MemoryStorage())).toBe(DEFAULT_THEME);
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme(storage)).toBe(DEFAULT_THEME);
    expect(readStoredTheme(null)).toBe(DEFAULT_THEME);
  });

  it("falls back to auto when localStorage throws", () => {
    expect(readStoredTheme(throwing)).toBe(DEFAULT_THEME);
  });
});

describe("storeTheme", () => {
  it("writes light/dark and clears on auto", () => {
    const storage = new MemoryStorage();
    storeTheme("dark", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    storeTheme("auto", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("swallows a throwing storage", () => {
    expect(() => storeTheme("dark", throwing)).not.toThrow();
    expect(() => storeTheme("auto", throwing)).not.toThrow();
    expect(() => storeTheme("light", null)).not.toThrow();
  });
});

class FakeMeta {
  attrs = new Map<string, string>();
  constructor(scheme: string, media: string) {
    this.attrs.set("data-scheme", scheme);
    this.attrs.set("media", media);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
}

describe("applyTheme", () => {
  it("sets data-theme for light and dark and removes it for auto", () => {
    const root = new FakeRoot();
    applyTheme("dark", root, []);
    expect(root.attrs.get("data-theme")).toBe("dark");
    applyTheme("light", root, []);
    expect(root.attrs.get("data-theme")).toBe("light");
    applyTheme("auto", root, []);
    expect(root.attrs.has("data-theme")).toBe(false);
  });

  it("points the theme-color metas at the forced scheme and back to the OS on auto", () => {
    const light = new FakeMeta("light", "(prefers-color-scheme: light)");
    const dark = new FakeMeta("dark", "(prefers-color-scheme: dark)");
    const metas = [light, dark];
    applyTheme("dark", new FakeRoot(), metas);
    expect(dark.getAttribute("media")).toBe("all");
    expect(light.getAttribute("media")).toBe("not all");
    applyTheme("light", new FakeRoot(), metas);
    expect(light.getAttribute("media")).toBe("all");
    expect(dark.getAttribute("media")).toBe("not all");
    applyTheme("auto", new FakeRoot(), metas);
    expect(light.getAttribute("media")).toBe("(prefers-color-scheme: light)");
    expect(dark.getAttribute("media")).toBe("(prefers-color-scheme: dark)");
  });

  it("without light-dark() the page is light whatever is asked: light meta always, dark never, and a stored dark applies as auto", () => {
    const light = new FakeMeta("light", "(prefers-color-scheme: light)");
    const dark = new FakeMeta("dark", "(prefers-color-scheme: dark)");
    const metas = [light, dark];
    for (const theme of ["auto", "light", "dark"] as const) {
      const root = new FakeRoot();
      applyTheme(theme, root, metas, false);
      expect(light.getAttribute("media"), theme).toBe("all");
      expect(dark.getAttribute("media"), theme).toBe("not all");
      expect(root.attrs.get("data-theme"), theme).toBe(
        theme === "light" ? "light" : undefined,
      );
    }
    expect(effectiveTheme("dark", false)).toBe("auto");
    expect(effectiveTheme("dark", true)).toBe("dark");
    expect(effectiveTheme("light", false)).toBe("light");
    expect(effectiveTheme("auto", false)).toBe("auto");
    // With light-dark() the stored dark is itself (the test above).
    const root = new FakeRoot();
    applyTheme("dark", root, metas, true);
    expect(root.attrs.get("data-theme")).toBe("dark");
    expect(dark.getAttribute("media")).toBe("all");
  });
});
