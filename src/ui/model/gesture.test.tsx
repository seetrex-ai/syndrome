// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, useLongPress, type LongPressOptions } from "./gesture";

function Probe(props: LongPressOptions & { q?: number }) {
  const handlersFor = useLongPress(props);
  return (
    <button data-testid="q" {...handlersFor(props.q ?? 3)}>
      <span data-testid="child" />
    </button>
  );
}

const down = { pointerId: 1, clientX: 10, clientY: 10, button: 0 };

function setup(options: Partial<LongPressOptions> = {}) {
  const onShort = vi.fn();
  const onLong = vi.fn();
  render(<Probe onShort={onShort} onLong={onLong} {...options} />);
  return { onShort, onLong, el: screen.getByTestId("q") };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLongPress", () => {
  it("down + up before the delay is a short press without shift", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledExactlyOnceWith(3, false);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("holding for the delay is a long press and the release does not fire again", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).toHaveBeenCalledExactlyOnceWith(3);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("moving beyond the slop cancels the press (the user is scrolling)", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 20, clientY: 10 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
  });

  it("a small move keeps the press alive", () => {
    const { onShort, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 14, clientY: 13 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledTimes(1);
  });

  it("pointercancel cancels the press: the browser took the gesture", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerCancel(el, { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
  });

  it("a release with Shift is a short press with shift", () => {
    const { onShort, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerUp(el, { pointerId: 1, shiftKey: true });
    expect(onShort).toHaveBeenCalledExactlyOnceWith(3, true);
  });

  it("ignores a release of another pointer and a press with the secondary button", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerUp(el, { pointerId: 2 });
    expect(onShort).not.toHaveBeenCalled();
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(el, { ...down, button: 2 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledTimes(1);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("Enter and Space are short presses, Shift+Enter carries shift, other keys do nothing", () => {
    const { onShort, el } = setup();
    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.keyDown(el, { key: " " });
    fireEvent.keyDown(el, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(el, { key: "a" });
    expect(onShort.mock.calls).toEqual([
      [3, false],
      [3, false],
      [3, true],
    ]);
  });

  it("a release anywhere else (mouse: no implicit capture) ends the press without a long press", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, { ...down, pointerType: "mouse" });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 100 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
    // The window listener left with the press: a later release is not ours.
    fireEvent.pointerDown(el, down);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledTimes(1);
  });

  it("leaving the element or losing the capture cancels the press", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.pointerLeave(el, { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el, { pointerId: 1 });
    fireEvent.pointerDown(el, down);
    fireEvent.lostPointerCapture(el, { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
    // Another pointer leaving does not touch this press.
    fireEvent.pointerDown(el, down);
    fireEvent.pointerLeave(el, { pointerId: 2 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).toHaveBeenCalledTimes(1);
  });

  it("captures the pointer when the element can (jsdom cannot: the call is optional)", () => {
    const { el } = setup();
    expect("setPointerCapture" in el).toBe(false);
    const capture = vi.fn();
    Object.assign(el, { setPointerCapture: capture });
    fireEvent.pointerDown(el, { ...down, pointerId: 7 });
    expect(capture).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("a held Enter auto-repeats keydown but toggles once", () => {
    const { onShort, el } = setup();
    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.keyDown(el, { key: "Enter", repeat: true });
    fireEvent.keyDown(el, { key: " ", repeat: true });
    expect(onShort).toHaveBeenCalledTimes(1);
  });

  it("honours a custom delay", () => {
    const { onLong, el } = setup({ delayMs: 100 });
    fireEvent.pointerDown(el, down);
    vi.advanceTimersByTime(99);
    expect(onLong).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("does not fire a pending long press after unmount", () => {
    const { onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    cleanup();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).not.toHaveBeenCalled();
  });

  it("a pointercancel anywhere else (mouse, no capture: the browser took the gesture) ends the press", () => {
    const { onShort, onLong, el } = setup();
    fireEvent.pointerDown(el, { ...down, pointerType: "mouse" });
    fireEvent.pointerCancel(document.body, { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onShort).not.toHaveBeenCalled();
    expect(onLong).not.toHaveBeenCalled();
  });

  it("a lostpointercapture raised for a child does not cancel; one for the element itself does", () => {
    const { onLong, el } = setup();
    fireEvent.pointerDown(el, down);
    fireEvent.lostPointerCapture(screen.getByTestId("child"), { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(el, { pointerId: 1 });
    fireEvent.pointerDown(el, down);
    fireEvent.lostPointerCapture(el, { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it("a change of resetKey cancels a pending press (the qubit index belongs to another grid); the same key does not", () => {
    const onShort = vi.fn();
    const onLong = vi.fn();
    const probe = (resetKey: number) => (
      <Probe onShort={onShort} onLong={onLong} q={8} resetKey={resetKey} />
    );
    const { rerender } = render(probe(3));
    const el = screen.getByTestId("q");
    fireEvent.pointerDown(el, down);
    rerender(probe(5));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onLong).not.toHaveBeenCalled();
    expect(onShort).not.toHaveBeenCalled();
    fireEvent.pointerDown(el, down);
    rerender(probe(5));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).toHaveBeenCalledExactlyOnceWith(8);
  });
});
