import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DebouncedSaver } from "../src/domain/saver.js";

describe("DebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst of events into a single save", async () => {
    const save = vi.fn(async () => {});
    const saver = new DebouncedSaver(save, 1000);
    saver.schedule("w1", "url");
    saver.schedule("w1", "move");
    saver.schedule("w1", "pin");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("w1", "pin");
  });

  it("debounces different workspaces independently", async () => {
    const save = vi.fn(async () => {});
    const saver = new DebouncedSaver(save, 500);
    saver.schedule("w1", "a");
    saver.schedule("w2", "b");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flush saves immediately and cancels the pending timer", async () => {
    const save = vi.fn(async () => {});
    const saver = new DebouncedSaver(save, 1000);
    saver.schedule("w1", "x");
    await saver.flush("w1", "close");
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1); // timer was cancelled
    expect(saver.pendingCount()).toBe(0);
  });

  it("cancel removes a pending save", async () => {
    const save = vi.fn(async () => {});
    const saver = new DebouncedSaver(save, 1000);
    saver.schedule("w1", "x");
    saver.cancel("w1");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
