import { describe, it, expect } from "vitest";
import { captureWindowState, planRestore, isRestorableUrl } from "../src/domain/capture.js";
import type { TabInfo } from "../src/domain/browser.js";

function tab(p: Partial<TabInfo>): TabInfo {
  return {
    windowId: 1,
    index: p.index ?? 0,
    pinned: p.pinned ?? false,
    active: p.active ?? false,
    url: p.url,
    title: p.title,
    ...p,
  };
}

describe("captureWindowState", () => {
  it("saves tabs in index order with contiguous indices", () => {
    const state = captureWindowState([
      tab({ url: "https://b.com", index: 1 }),
      tab({ url: "https://a.com", index: 0, pinned: true }),
      tab({ url: "https://c.com", index: 2, active: true }),
    ]);
    expect(state.tabs.map((t) => t.url)).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
    expect(state.tabs.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it("preserves pinned state and active tab index", () => {
    const state = captureWindowState([
      tab({ url: "https://a.com", index: 0, pinned: true }),
      tab({ url: "https://b.com", index: 1, active: true }),
    ]);
    expect(state.tabs[0]?.pinned).toBe(true);
    expect(state.activeTabIndex).toBe(1);
  });

  it("uses pendingUrl when url is not yet committed", () => {
    const state = captureWindowState([tab({ pendingUrl: "https://loading.com", index: 0 })]);
    expect(state.tabs[0]?.url).toBe("https://loading.com");
  });

  it("drops tabs without any URL without crashing", () => {
    const state = captureWindowState([tab({ index: 0 }), tab({ url: "https://x.com", index: 1 })]);
    expect(state.tabs).toHaveLength(1);
  });
});

describe("isRestorableUrl", () => {
  it("accepts http/https", () => {
    expect(isRestorableUrl("https://x.com")).toBe(true);
  });
  it("rejects chrome:// and extension pages", () => {
    expect(isRestorableUrl("chrome://settings")).toBe(false);
    expect(isRestorableUrl("chrome-extension://abc/page.html")).toBe(false);
  });
});

describe("planRestore", () => {
  it("skips un-restorable URLs but keeps the rest ordered", () => {
    const plan = planRestore({
      tabs: [
        { url: "https://a.com", pinned: false, index: 0 },
        { url: "chrome://settings", pinned: false, index: 1 },
        { url: "https://c.com", pinned: false, index: 2 },
      ],
      activeTabIndex: 2,
    });
    expect(plan.restorable.map((t) => t.url)).toEqual(["https://a.com", "https://c.com"]);
    expect(plan.skipped).toHaveLength(1);
    // active was index 2 (https://c.com) -> now index 1 in restorable
    expect(plan.activeIndex).toBe(1);
  });

  it("clamps active index when the active tab was skipped", () => {
    const plan = planRestore({
      tabs: [
        { url: "chrome://newtab", pinned: false, index: 0 },
        { url: "https://a.com", pinned: false, index: 1 },
      ],
      activeTabIndex: 0,
    });
    expect(plan.activeIndex).toBe(0);
    expect(plan.restorable).toHaveLength(1);
  });
});
