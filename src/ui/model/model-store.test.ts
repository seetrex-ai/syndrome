// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_KEY, readStoredModel, storeModel } from "./model-store";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("model-store", () => {
  it("reads null with nothing stored, the model after storing it, null for junk", () => {
    expect(readStoredModel()).toBeNull();
    storeModel("phenomenological");
    expect(localStorage.getItem(MODEL_KEY)).toBe("phenomenological");
    expect(readStoredModel()).toBe("phenomenological");
    storeModel("independent");
    expect(readStoredModel()).toBe("independent");
    localStorage.setItem(MODEL_KEY, "depolarizing");
    expect(readStoredModel()).toBeNull();
  });

  it("a store that throws on access reads null and swallows writes", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredModel()).toBeNull();
    expect(() => storeModel("phenomenological")).not.toThrow();
  });

  it("a store whose setItem throws (quota) swallows the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => storeModel("phenomenological")).not.toThrow();
    expect(readStoredModel()).toBeNull();
  });
});
